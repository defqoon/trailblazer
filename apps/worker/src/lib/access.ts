import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AppEnv } from "../env";

const jwksCache = new Map<string, JWTVerifyGetKey>();

function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Verifies the Cloudflare Access JWT so the API is unusable even if the Worker
 * were somehow reached without going through Access.
 */
export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; aud: string; getKey?: JWTVerifyGetKey },
): Promise<string> {
  const { payload } = await jwtVerify(token, opts.getKey ?? remoteJwks(opts.teamDomain), {
    issuer: opts.teamDomain,
    audience: opts.aud,
  });
  const email = payload.email;
  if (typeof email !== "string") throw new Error("Access token has no email claim");
  return email;
}

export const requireAccess = (getKey?: JWTVerifyGetKey) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.env.DEV_BYPASS_AUTH === "true") {
      c.set("userEmail", "dev@localhost");
      return next();
    }
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token || !c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD) {
      return c.json({ error: "unauthorized" }, 401);
    }
    try {
      const email = await verifyAccessJwt(token, {
        teamDomain: c.env.ACCESS_TEAM_DOMAIN,
        aud: c.env.ACCESS_AUD,
        getKey,
      });
      c.set("userEmail", email);
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });
