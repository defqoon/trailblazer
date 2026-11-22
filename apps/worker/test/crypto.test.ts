import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../src/lib/crypto";

describe("token crypto", () => {
  it("round-trips", async () => {
    const { ciphertext, iv } = await encryptJson(env.TOKEN_ENC_KEY, { access: "a", refresh: "r" });
    expect(await decryptJson(env.TOKEN_ENC_KEY, ciphertext, iv)).toEqual({ access: "a", refresh: "r" });
  });
});
