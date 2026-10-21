import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { authenticate, verifyPassword, issueSession } from "../src/auth";
import type { Env } from "../src/env";
import { app } from "../src/index";
test("senha privada, cookie assinado e adulteração", async () => {
  const password = "test-password-with-enough-entropy-123";
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
  );
  const env = {
    ENVIRONMENT: "production",
    OWNER_PASSWORD_SHA256: Array.from(digest, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
    SESSION_SIGNING_KEY: Buffer.alloc(32, 7).toString("base64url"),
  } as Env;
  assert.equal(await verifyPassword(password, env), true);
  assert.equal(await verifyPassword("wrong", env), false);
  const cookie = (await issueSession(env)).split(";")[0];
  const request = (value?: string) =>
    new Request("https://lastro.example/api/feed", {
      headers: value ? { Cookie: value } : {},
    });
  await authenticate(request(cookie), env);
  await assert.rejects(authenticate(request(), env), /Entre com sua senha/);
  await assert.rejects(
    authenticate(request(`${cookie}x`), env),
    /Entre com sua senha/,
  );
  await assert.rejects(
    authenticate(request(cookie.replace("v1.", "v2.")), env),
    /Entre com sua senha/,
  );
  await assert.rejects(
    authenticate(request(cookie), {
      ...env,
      SESSION_SIGNING_KEY: Buffer.alloc(32, 8).toString("base64url"),
    }),
    /Entre com sua senha/,
  );
  let attempts = 0;
  env.DB = {
    prepare: () => ({
      bind: () => ({ first: async () => ({ count: ++attempts }) }),
    }),
  } as unknown as D1Database;
  const login = (input: string, origin = "https://lastro.example") =>
    app.fetch(
      new Request("https://lastro.example/api/auth/login", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ password: input }),
      }),
      env,
    );
  assert.equal((await login(password, "https://other.example")).status, 403);
  assert.equal((await login("wrong")).status, 401);
  const success = await login(password);
  assert.equal(success.status, 200);
  assert.match(
    success.headers.get("Set-Cookie") ?? "",
    /HttpOnly; Secure; SameSite=Strict/,
  );
  const session = await app.fetch(
    new Request("https://lastro.example/api/auth/session", {
      headers: { Cookie: success.headers.get("Set-Cookie")!.split(";")[0] },
    }),
    env,
  );
  assert.deepEqual(await session.json(), { authenticated: true });
  await login("wrong");
  await login("wrong");
  await login("wrong");
  assert.equal((await login(password)).status, 429);
});
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
