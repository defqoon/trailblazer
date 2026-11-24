import { healthSyncSchema, manualWeightSchema, renphoCsvImportSchema } from "@trailblazer/shared";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { parseBody } from "../lib/validate";

export const healthRoutes = new Hono<AppEnv>();

/**
 * Upsert daily metrics and weigh-ins sent by the Android app. Fields the phone didn't report
 * (null) never overwrite values that came from elsewhere (e.g. Garmin later).
 */
healthRoutes.post("/health/sync", async (c) => {
  const body = await parseBody(c, healthSyncSchema);
  if (!body.ok) return body.res;
  const { days, body: weighIns, source } = body.data;
  const now = new Date().toISOString();

  const statements: D1PreparedStatement[] = [];
  if (days.length) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO daily_metrics (date, steps, resting_hr, hrv, vo2max_run, updated_at)
         SELECT j.value->>'date', j.value->>'steps', j.value->>'restingHr', j.value->>'hrv', j.value->>'vo2max', ?2
         FROM json_each(?1) j
         WHERE true
         ON CONFLICT (date) DO UPDATE SET
           steps = COALESCE(excluded.steps, daily_metrics.steps),
           resting_hr = COALESCE(excluded.resting_hr, daily_metrics.resting_hr),
           hrv = COALESCE(excluded.hrv, daily_metrics.hrv),
           vo2max_run = COALESCE(excluded.vo2max_run, daily_metrics.vo2max_run),
           updated_at = excluded.updated_at`,
      ).bind(JSON.stringify(days), now),
    );
  }
  if (weighIns.length) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO body_measurements (source, external_id, measured_at, weight_kg, fat_pct)
         SELECT ?2, j.value->>'externalId', j.value->>'measuredAt', j.value->>'weightKg', j.value->>'fatPct'
         FROM json_each(?1) j
         WHERE true
         ON CONFLICT (source, external_id) DO UPDATE SET
           measured_at = excluded.measured_at,
           weight_kg = excluded.weight_kg,
           fat_pct = COALESCE(excluded.fat_pct, body_measurements.fat_pct)`,
      ).bind(JSON.stringify(weighIns), source),
    );
  }
  if (statements.length) await c.env.DB.batch(statements);
  return c.json({ ok: true, days: days.length, weighIns: weighIns.length, syncedAt: now });
});

/** Latest values, for the Settings card and quick checks. */
healthRoutes.get("/health/latest", async (c) => {
  const [metrics, weight] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT date, steps, resting_hr AS restingHr, hrv, vo2max_run AS vo2max, updated_at AS updatedAt
       FROM daily_metrics ORDER BY date DESC LIMIT 7`,
    ),
    c.env.DB.prepare(
      `SELECT measured_at AS measuredAt, weight_kg AS weightKg, fat_pct AS fatPct, source
       FROM body_measurements ORDER BY measured_at DESC LIMIT 1`,
    ),
  ]);
  return c.json({ days: metrics?.results ?? [], latestWeight: weight?.results?.[0] ?? null });
});

/** Log a single manual weigh-in. */
healthRoutes.post("/health/weight", async (c) => {
  const body = await parseBody(c, manualWeightSchema);
  if (!body.ok) return body.res;
  const measuredAt = body.data.measuredAt ?? new Date().toISOString();
  const externalId = `manual:${measuredAt}`;
  await c.env.DB.prepare(
    `INSERT INTO body_measurements (source, external_id, measured_at, weight_kg, fat_pct, bmr_kcal)
     VALUES ('manual', ?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (source, external_id) DO UPDATE SET
       weight_kg = excluded.weight_kg,
       fat_pct = COALESCE(excluded.fat_pct, body_measurements.fat_pct),
       bmr_kcal = COALESCE(excluded.bmr_kcal, body_measurements.bmr_kcal)`,
  )
    .bind(
      externalId,
      measuredAt,
      Math.round(body.data.weightKg * 10) / 10,
      body.data.fatPct ?? null,
      body.data.bmrKcal ?? null,
    )
    .run();
  return c.json({ ok: true, measuredAt }, 201);
});

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseNumericCell(val: string | undefined): number | null {
  if (!val) return null;
  const m = val.replace(",", ".").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Import weight/body-fat/BMR rows from a Renpho CSV export.
 * Handles both kg and lb weight columns and deduplicates on (source='renpho_csv', external_id=measuredAt).
 */
healthRoutes.post("/health/weight/import-csv", async (c) => {
  const body = await parseBody(c, renphoCsvImportSchema);
  if (!body.ok) return body.res;

  const lines = body.data.csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return c.json({ error: "CSV must include a header row and at least one measurement." }, 400);

  const headers = parseCsvLine(lines[0] ?? "").map((h) => h.toLowerCase());
  const timeIdx = headers.findIndex((h) => h.includes("time") || h.includes("date"));
  const weightIdx = headers.findIndex((h) => h.startsWith("weight") || h === "weight");
  const fatIdx = headers.findIndex((h) => h.includes("body fat") || h === "fat" || h.includes("fat(%)"));
  const bmrIdx = headers.findIndex((h) => h.includes("bmr"));
  const muscleIdx = headers.findIndex((h) => h.includes("muscle mass"));
  const waterIdx = headers.findIndex((h) => h.includes("body water"));

  if (timeIdx === -1 || weightIdx === -1) {
    return c.json({ error: "Could not find Time/Date and Weight columns in CSV header." }, 400);
  }
  const weightIsLb = (headers[weightIdx] ?? "").includes("lb");

  const rows: Array<{
    externalId: string;
    measuredAt: string;
    weightKg: number;
    fatPct: number | null;
    muscleKg: number | null;
    waterPct: number | null;
    bmrKcal: number | null;
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i] ?? "");
    const rawTime = cols[timeIdx];
    const rawWeight = parseNumericCell(cols[weightIdx]);
    if (!rawTime || rawWeight == null || rawWeight <= 0) continue;

    const dt = new Date(rawTime);
    if (Number.isNaN(dt.getTime())) continue;
    const measuredAt = dt.toISOString();
    const isLbCell = weightIsLb || /lb/i.test(cols[weightIdx] ?? "");
    const weightKg = Math.round((isLbCell ? rawWeight * 0.45359237 : rawWeight) * 10) / 10;
    if (weightKg < 20 || weightKg > 300) continue;

    const fatPct = fatIdx >= 0 ? parseNumericCell(cols[fatIdx]) : null;
    const bmrKcal = bmrIdx >= 0 ? parseNumericCell(cols[bmrIdx]) : null;
    const rawMuscle = muscleIdx >= 0 ? parseNumericCell(cols[muscleIdx]) : null;
    const muscleKg =
      rawMuscle != null ? Math.round((isLbCell ? rawMuscle * 0.45359237 : rawMuscle) * 10) / 10 : null;
    const waterPct = waterIdx >= 0 ? parseNumericCell(cols[waterIdx]) : null;

    rows.push({
      externalId: measuredAt,
      measuredAt,
      weightKg,
      fatPct,
      muscleKg,
      waterPct,
      bmrKcal,
    });
  }

  if (rows.length === 0) {
    return c.json({ error: "No valid weight rows found in CSV." }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO body_measurements (source, external_id, measured_at, weight_kg, fat_pct, muscle_kg, water_pct, bmr_kcal)
     SELECT 'renpho_csv', j.value->>'externalId', j.value->>'measuredAt', j.value->>'weightKg',
            j.value->>'fatPct', j.value->>'muscleKg', j.value->>'waterPct', j.value->>'bmrKcal'
     FROM json_each(?1) j
     WHERE true
     ON CONFLICT (source, external_id) DO UPDATE SET
       weight_kg = excluded.weight_kg,
       fat_pct = COALESCE(excluded.fat_pct, body_measurements.fat_pct),
       muscle_kg = COALESCE(excluded.muscle_kg, body_measurements.muscle_kg),
       water_pct = COALESCE(excluded.water_pct, body_measurements.water_pct),
       bmr_kcal = COALESCE(excluded.bmr_kcal, body_measurements.bmr_kcal)`,
  )
    .bind(JSON.stringify(rows))
    .run();

  return c.json({ ok: true, imported: rows.length });
});
