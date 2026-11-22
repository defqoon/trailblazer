import { ENDURANCE_SPORTS, sportFromStrava, type Sport } from "@trailblazer/shared";
import { eq } from "drizzle-orm";
import { integrationTokens } from "../db/schema";
import type { Env } from "../env";
import { decryptJson, encryptJson } from "../lib/crypto";
import { getDb } from "../lib/db";

export const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const DEAUTH_URL = "https://www.strava.com/oauth/deauthorize";
const API = "https://www.strava.com/api/v3";

export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  /** epoch seconds */
  expiresAt: number;
  athlete: { id: number; firstname?: string; lastname?: string };
  scope: string;
}

/** Subset of Strava's SummaryActivity that we use. */
export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  kilojoules?: number;
  map?: { summary_polyline?: string | null };
}

export const stravaConfigured = (env: Env) => Boolean(env.STRAVA_CLIENT_ID && env.STRAVA_CLIENT_SECRET);

export async function saveTokens(env: Env, tokens: StravaTokens) {
  const { ciphertext, iv } = await encryptJson(env.TOKEN_ENC_KEY, tokens);
  const now = new Date().toISOString();
  await getDb(env.DB)
    .insert(integrationTokens)
    .values({ provider: "strava", ciphertext, iv, status: "ok", lastError: null, updatedAt: now })
    .onConflictDoUpdate({ target: integrationTokens.provider, set: { ciphertext, iv, status: "ok", lastError: null, updatedAt: now } });
}

export async function loadTokens(env: Env): Promise<StravaTokens | null> {
  const row = await getDb(env.DB).select().from(integrationTokens).where(eq(integrationTokens.provider, "strava")).get();
  if (!row) return null;
  return decryptJson<StravaTokens>(env.TOKEN_ENC_KEY, row.ciphertext, row.iv);
}

export async function deleteTokens(env: Env) {
  await getDb(env.DB).delete(integrationTokens).where(eq(integrationTokens.provider, "strava"));
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: StravaTokens["athlete"];
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID!, client_secret: env.STRAVA_CLIENT_SECRET!, ...params }),
  });
  if (!res.ok) throw new Error(`Strava token request failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function exchangeCode(env: Env, code: string, scope: string): Promise<StravaTokens> {
  const t = await tokenRequest(env, { code, grant_type: "authorization_code" });
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at, athlete: t.athlete ?? { id: 0 }, scope };
}

/** Returns a valid access token, refreshing (and persisting) it when it's about to expire. */
export async function getAccessToken(env: Env): Promise<string | null> {
  const tokens = await loadTokens(env);
  if (!tokens) return null;
  if (tokens.expiresAt - 300 > Date.now() / 1000) return tokens.accessToken;
  const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  const next = { ...tokens, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at };
  await saveTokens(env, next);
  return next.accessToken;
}

export async function deauthorize(env: Env) {
  const tokens = await loadTokens(env);
  if (tokens) {
    // Best effort: revoke at Strava, then forget locally regardless.
    await fetch(DEAUTH_URL, { method: "POST", body: new URLSearchParams({ access_token: tokens.accessToken }) }).catch(() => undefined);
  }
  await deleteTokens(env);
}

/** All activities after `afterEpoch` (seconds), newest pages first, capped at `maxPages` × 200. */
export async function listActivities(env: Env, afterEpoch: number, maxPages = 5): Promise<StravaActivity[]> {
  const token = await getAccessToken(env);
  if (!token) throw new Error("Strava is not connected");
  const out: StravaActivity[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${API}/athlete/activities?after=${afterEpoch}&per_page=200&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) throw new Error("Strava rate limit reached. Try again in 15 minutes.");
    if (!res.ok) throw new Error(`Strava API error ${res.status}`);
    const batch = (await res.json()) as StravaActivity[];
    out.push(...batch);
    if (batch.length < 200) break;
  }
  return out;
}

/** Upsert activities into D1 with a single statement. */
export async function storeActivities(env: Env, activities: StravaActivity[]) {
  if (!activities.length) return;
  const rows = activities.map((a) => ({
    externalId: String(a.id),
    startTime: a.start_date,
    sport: sportFromStrava(a.sport_type),
    name: a.name,
    movingTimeS: a.moving_time,
    elapsedTimeS: a.elapsed_time,
    distanceM: a.distance,
    elevationGainM: a.total_elevation_gain,
    avgHr: a.average_heartrate ?? null,
    maxHr: a.max_heartrate ?? null,
    kcal: a.kilojoules ? Math.round(a.kilojoules / 4.184 / 0.24) : null, // ~24% gross efficiency
    polyline: a.map?.summary_polyline ?? null,
  }));
  await env.DB.prepare(
    `INSERT INTO activities (source, external_id, start_time, sport, name, moving_time_s, elapsed_time_s, distance_m, elevation_gain_m, avg_hr, max_hr, kcal, polyline)
     SELECT 'strava', j.value->>'externalId', j.value->>'startTime', j.value->>'sport', j.value->>'name', j.value->>'movingTimeS',
            j.value->>'elapsedTimeS', j.value->>'distanceM', j.value->>'elevationGainM', j.value->>'avgHr', j.value->>'maxHr',
            j.value->>'kcal', j.value->>'polyline'
     FROM json_each(?1) j
     WHERE true
     ON CONFLICT (source, external_id) DO UPDATE SET
       start_time = excluded.start_time, sport = excluded.sport, name = excluded.name, moving_time_s = excluded.moving_time_s,
       elapsed_time_s = excluded.elapsed_time_s, distance_m = excluded.distance_m, elevation_gain_m = excluded.elevation_gain_m,
       avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, kcal = excluded.kcal, polyline = excluded.polyline`,
  )
    .bind(JSON.stringify(rows))
    .run();
}

export interface TrainingSummary {
  /** Days the averages are computed over. */
  windowDays: number;
  activityCount: number;
  weeklyHours: number;
  sessionsPerWeek: number;
  longestSessionMin: number;
  /** Endurance sports you actually train in, most frequent first. */
  sports: Sport[];
  /** Non-endurance sports you do regularly (e.g. climbing), with sessions per week. */
  regular: { sport: Sport; perWeek: number; avgMin: number }[];
  /** Highest heart rate recorded in any activity in the last 90 days. */
  maxHrObserved: number | null;
}

const isEndurance = (s: Sport) => (ENDURANCE_SPORTS as readonly string[]).includes(s);

/** Turn recent activities into the wizard's "current training" values. */
export function summarizeActivities(activities: StravaActivity[], now = new Date(), windowDays = 42): TrainingSummary {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const recent = activities.filter((a) => new Date(a.start_date).getTime() >= cutoff);
  const weeks = windowDays / 7;
  const endurance = recent.filter((a) => isEndurance(sportFromStrava(a.sport_type)));

  const counts = new Map<Sport, { n: number; sec: number }>();
  for (const a of recent) {
    const s = sportFromStrava(a.sport_type);
    const c = counts.get(s) ?? { n: 0, sec: 0 };
    counts.set(s, { n: c.n + 1, sec: c.sec + a.moving_time });
  }
  const byCount = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);

  const last4w = now.getTime() - 28 * 86_400_000;
  const longest = endurance.filter((a) => new Date(a.start_date).getTime() >= last4w).reduce((m, a) => Math.max(m, a.moving_time), 0);
  const maxHr = activities.reduce((m, a) => Math.max(m, a.max_heartrate ?? 0), 0);
  const round = (x: number, step: number) => Math.round(x / step) * step;

  return {
    windowDays,
    activityCount: recent.length,
    weeklyHours: round(endurance.reduce((a, x) => a + x.moving_time, 0) / 3600 / weeks, 0.5),
    sessionsPerWeek: Math.round(endurance.length / weeks),
    longestSessionMin: round(longest / 60, 5),
    sports: byCount.filter(([s, c]) => isEndurance(s) && c.n >= 2).map(([s]) => s),
    regular: byCount
      .filter(([s, c]) => !isEndurance(s) && s !== "other" && c.n / weeks >= 0.75)
      .map(([sport, c]) => ({ sport, perWeek: Math.max(1, Math.round(c.n / weeks)), avgMin: round(c.sec / c.n / 60, 15) })),
    maxHrObserved: maxHr > 0 ? Math.round(maxHr) : null,
  };
}
