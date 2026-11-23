import { healthSyncSchema } from "@trailblazer/shared";
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
