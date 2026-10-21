import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { authenticate } from "../src/auth";
import type { Env } from "../src/env";
test("JWT de produção verifica assinatura, expiração, emissor, audience e proprietário", async () => {
  const pair = await generateKeyPair("RS256"),
    jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test";
  jwk.alg = "RS256";
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { "Content-Type": "application/json" },
    });
  const issuer = "https://lastro-test.cloudflareaccess.com";
  const env = {
    ENVIRONMENT: "production",
    ACCESS_TEAM_DOMAIN: "lastro-test.cloudflareaccess.com",
    ACCESS_AUD: "lastro-test-aud",
    OWNER_EMAIL: "owner@example.test",
  } as Env;
  const sign = async (values: Record<string, unknown> = {}) =>
    new SignJWT({ email: "owner@example.test", ...values })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("test-owner")
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience("lastro-test-aud")
      .setExpirationTime("5m")
      .sign(pair.privateKey);
  const request = (token: string) =>
    new Request("https://lastro.example/api/feed", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
  try {
    const valid = await sign();
    await authenticate(request(valid), env);
    await assert.rejects(
      authenticate(request(await sign({ email: "other@example.test" })), env),
      /Sessão inválida/,
    );
    await assert.rejects(
      authenticate(request(valid), { ...env, ACCESS_AUD: "wrong-audience" }),
      /Sessão inválida/,
    );
    await assert.rejects(
      authenticate(request(valid), {
        ...env,
        ACCESS_TEAM_DOMAIN: "another-test.cloudflareaccess.com",
      }),
      /Sessão inválida/,
    );
    const expired = await new SignJWT({ email: "owner@example.test" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("test")
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience("lastro-test-aud")
      .setExpirationTime(1)
      .sign(pair.privateKey);
    await assert.rejects(
      authenticate(request(expired), env),
      /Sessão inválida/,
    );
    const parts = valid.split(".");
    parts[1] = Buffer.from(
      JSON.stringify({
        email: "owner@example.test",
        aud: "lastro-test-aud",
        iss: issuer,
      }),
    ).toString("base64url");
    await assert.rejects(
      authenticate(request(parts.join(".")), env),
      /Sessão inválida/,
    );
    await assert.rejects(
      authenticate(
        new Request("https://lastro.example/api/feed", {
          headers: {
            "Cf-Access-Authenticated-User-Email": "owner@example.test",
          },
        }),
        env,
      ),
      /necessária/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
