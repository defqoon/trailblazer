import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { summarizeActivities, type StravaActivity } from "../src/integrations/strava";
import { safeReturnPath } from "../src/routes/strava";

const devEnv = { ...env, DEV_BYPASS_AUTH: "true", STRAVA_CLIENT_ID: "123", STRAVA_CLIENT_SECRET: "secret" };

const act = (daysAgo: number, sport_type: string, minutes: number, maxHr?: number): StravaActivity => ({
  id: Math.floor(Math.random() * 1e9),
  name: sport_type,
  sport_type,
  start_date: new Date(Date.UTC(2026, 10, 20) - daysAgo * 86_400_000).toISOString(),
  moving_time: minutes * 60,
  elapsed_time: minutes * 60,
  distance: 0,
  total_elevation_gain: 0,
  max_heartrate: maxHr,
});

describe("summarizeActivities", () => {
  it("derives current training from the last 6 weeks", () => {
    const acts: StravaActivity[] = [];
    for (let w = 0; w < 6; w++) {
      acts.push(act(w * 7 + 1, "TrailRun", 60), act(w * 7 + 3, "TrailRun", 60), act(w * 7 + 5, "Hike", 180, 181));
      acts.push(act(w * 7 + 2, "RockClimbing", 120), act(w * 7 + 4, "RockClimbing", 120));
    }
    acts.push(act(70, "Run", 300, 192)); // outside the window, but counts for max HR
    const s = summarizeActivities(acts, new Date(Date.UTC(2026, 10, 20)));
    expect(s.weeklyHours).toBe(5);
    expect(s.sessionsPerWeek).toBe(3);
    expect(s.longestSessionMin).toBe(180);
    expect(s.sports).toEqual(["trail_run", "hike"]);
    expect(s.regular).toEqual([{ sport: "climbing", perWeek: 2, avgMin: 120 }]);
    expect(s.maxHrObserved).toBe(192);
  });
});

describe("Strava OAuth routes", () => {
  it("reports configuration and connection status", async () => {
    const res = await app.request("/api/strava/status", {}, devEnv);
    expect(await res.json()).toMatchObject({ configured: true, connected: false });
  });

  it("redirects to Strava with a state cookie", async () => {
    const res = await app.request("http://localhost/api/strava/connect?return=/plan/new", {}, devEnv);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.hostname).toBe("www.strava.com");
    expect(loc.searchParams.get("redirect_uri")).toBe("http://localhost/api/strava/callback");
    expect(loc.searchParams.get("scope")).toBe("read,activity:read_all");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects a callback with a mismatched state", async () => {
    const res = await app.request(
      "http://localhost/api/strava/callback?state=evil&code=x",
      { headers: { cookie: `tb_strava_oauth=${encodeURIComponent(JSON.stringify({ state: "good", ret: "/" }))}` } },
      devEnv,
    );
    expect(res.status).toBe(400);
  });

  it("only allows local return paths", () => {
    expect(safeReturnPath("/plan/new")).toBe("/plan/new");
    expect(safeReturnPath("//evil.com")).toBe("/settings");
    expect(safeReturnPath("https://evil.com")).toBe("/settings");
    expect(safeReturnPath("/\\evil.com")).toBe("/settings");
  });
});
