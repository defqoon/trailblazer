import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import { requireAccess } from "../src/lib/access";

const ISS = "https://test.cloudflareaccess.com";

let privateKey: CryptoKey;
let testApp: Hono<AppEnv>;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" };
  testApp = new Hono<AppEnv>();
  testApp.use("*", requireAccess(createLocalJWKSet({ keys: [jwk] })));
  testApp.get("/me", (c) => c.json({ email: c.get("userEmail") }));
});

const sign = (claims: Record<string, unknown>, aud = "test-aud") =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(ISS)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

describe("Access auth", () => {
  it("rejects requests without a token", async () => {
    const res = await app.request("/api/me", {}, env);
    expect(res.status).toBe(401);
  });

  it("accepts a valid token", async () => {
    const token = await sign({ email: "me@example.com" });
    const res = await testApp.request("/me", { headers: { "Cf-Access-Jwt-Assertion": token } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "me@example.com" });
  });

  it("rejects a token for another audience", async () => {
    const token = await sign({ email: "me@example.com" }, "other-aud");
    const res = await testApp.request("/me", { headers: { "Cf-Access-Jwt-Assertion": token } }, env);
    expect(res.status).toBe(401);
  });

  it("allows dev bypass only when explicitly set", async () => {
    const res = await app.request("/api/me", {}, { ...env, DEV_BYPASS_AUTH: "true" });
    expect(res.status).toBe(200);
  });
});
