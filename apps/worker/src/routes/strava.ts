import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import {
  deauthorize,
  exchangeCode,
  listActivities,
  loadTokens,
  saveTokens,
  storeActivities,
  STRAVA_AUTHORIZE_URL,
  stravaConfigured,
  summarizeActivities,
} from "../integrations/strava";

export const stravaRoutes = new Hono<AppEnv>();

const STATE_COOKIE = "tb_strava_oauth";
const SCOPE = "read,activity:read_all";

/** Only allow same-origin relative paths as post-login destinations. */
export const safeReturnPath = (p: string | undefined) => (p && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") ? p : "/settings");

const withParam = (path: string, key: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

stravaRoutes.get("/strava/status", async (c) => {
  const configured = stravaConfigured(c.env);
  const tokens = configured ? await loadTokens(c.env).catch(() => null) : null;
  return c.json({
    configured,
    connected: Boolean(tokens),
    athlete: tokens ? { firstname: tokens.athlete.firstname ?? null } : null,
    scopeOk: tokens ? tokens.scope.includes("activity:read") : null,
  });
});

stravaRoutes.get("/strava/connect", (c) => {
  if (!stravaConfigured(c.env)) return c.json({ error: "Strava is not configured: set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET." }, 503);
  const state = crypto.randomUUID();
  const ret = safeReturnPath(c.req.query("return"));
  const url = new URL(c.req.url);
  setCookie(c, STATE_COOKIE, JSON.stringify({ state, ret }), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "Lax",
    path: "/api/strava",
    maxAge: 600,
  });
  const auth = new URL(STRAVA_AUTHORIZE_URL);
  auth.search = new URLSearchParams({
    client_id: c.env.STRAVA_CLIENT_ID!,
    redirect_uri: `${url.origin}/api/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: SCOPE,
    state,
  }).toString();
  return c.redirect(auth.toString(), 302);
});

stravaRoutes.get("/strava/callback", async (c) => {
  let saved: { state: string; ret: string } | null = null;
  try {
    saved = JSON.parse(getCookie(c, STATE_COOKIE) ?? "null");
  } catch {
    saved = null;
  }
  deleteCookie(c, STATE_COOKIE, { path: "/api/strava" });
  const state = c.req.query("state");
  if (!saved || !state || saved.state !== state) return c.json({ error: "Invalid or expired OAuth state. Try connecting again." }, 400);
  const ret = safeReturnPath(saved.ret);

  const error = c.req.query("error");
  const code = c.req.query("code");
  if (error || !code) return c.redirect(withParam(ret, "strava", "denied"), 302);

  const scope = c.req.query("scope") ?? "";
  if (!scope.includes("activity:read")) return c.redirect(withParam(ret, "strava", "missing_scope"), 302);

  const tokens = await exchangeCode(c.env, code, scope);
  await saveTokens(c.env, tokens);
  return c.redirect(withParam(ret, "strava", "connected"), 302);
});

stravaRoutes.post("/strava/disconnect", async (c) => {
  await deauthorize(c.env);
  return c.json({ ok: true });
});

/** Pull the last 90 days, store them, and summarise the last 6 weeks for the plan wizard. */
stravaRoutes.get("/strava/summary", async (c) => {
  if (!(await loadTokens(c.env))) return c.json({ error: "Strava is not connected" }, 409);
  const after = Math.floor(Date.now() / 1000) - 90 * 86_400;
  try {
    const activities = await listActivities(c.env, after);
    await storeActivities(c.env, activities);
    return c.json(summarizeActivities(activities));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Strava sync failed" }, 502);
  }
});
