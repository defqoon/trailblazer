import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";

const devEnv = { ...env, DEV_BYPASS_AUTH: "true" };
const call = (path: string, init?: RequestInit) =>
  app.request(`/api${path}`, { headers: { "content-type": "application/json" }, ...init }, devEnv);

describe("health sync", () => {
  it("upserts days and weigh-ins without clobbering unknown fields", async () => {
    const first = await call("/health/sync", {
      method: "POST",
      body: JSON.stringify({
        source: "health_connect",
        days: [{ date: "2026-11-20", steps: 12000, restingHr: 48, hrv: 62, vo2max: null }],
        body: [{ externalId: "hc-1", measuredAt: "2026-11-20T07:12:00+01:00", weightKg: 72.4, fatPct: 14.1 }],
      }),
    });
    expect(first.status).toBe(200);

    // Second sync: same day, steps updated, HRV unknown → must keep 62. Same weigh-in re-sent → no duplicate.
    await call("/health/sync", {
      method: "POST",
      body: JSON.stringify({
        source: "health_connect",
        days: [{ date: "2026-11-20", steps: 13500, restingHr: null, hrv: null, vo2max: 51 }],
        body: [{ externalId: "hc-1", measuredAt: "2026-11-20T07:12:00+01:00", weightKg: 72.3, fatPct: null }],
      }),
    });

    const latest = (await (await call("/health/latest")).json()) as {
      days: { date: string; steps: number; restingHr: number; hrv: number; vo2max: number }[];
      latestWeight: { weightKg: number; fatPct: number };
    };
    expect(latest.days[0]).toMatchObject({ date: "2026-11-20", steps: 13500, restingHr: 48, hrv: 62, vo2max: 51 });
    expect(latest.latestWeight).toMatchObject({ weightKg: 72.3, fatPct: 14.1 });
    const count = await env.DB.prepare("select count(*) as n from body_measurements").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("rejects malformed payloads", async () => {
    const res = await call("/health/sync", { method: "POST", body: JSON.stringify({ source: "health_connect", days: [{ date: "nope" }], body: [] }) });
    expect(res.status).toBe(400);
  });
});
