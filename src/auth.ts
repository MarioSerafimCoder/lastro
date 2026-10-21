import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";
import { ApiFault } from "./errors";
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const sessionName = "lastro_session";
const sessionLifetime = 7 * 24 * 60 * 60;
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const decode = (value: string) => {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};
const keyFor = async (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    decode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
const cookieValue = (request: Request) =>
  request.headers
    .get("Cookie")
    ?.split("; ")
    .find((part) => part.startsWith(`${sessionName}=`))
    ?.slice(sessionName.length + 1);
export const passwordMode = (env: Env) =>
  env.ENVIRONMENT === "production" &&
  !!env.OWNER_PASSWORD_SHA256 &&
  !!env.SESSION_SIGNING_KEY;
export async function verifyPassword(
  password: string,
  env: Env,
): Promise<boolean> {
  if (!passwordMode(env) || !/^[a-f0-9]{64}$/.test(env.OWNER_PASSWORD_SHA256!))
    return false;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
  );
  const expected = env
    .OWNER_PASSWORD_SHA256!.match(/../g)!
    .map((v) => parseInt(v, 16));
  let diff = 0;
  for (let i = 0; i < digest.length; i++) diff |= digest[i] ^ expected[i];
  return diff === 0;
}
export async function issueSession(env: Env): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + sessionLifetime;
  const nonce = encode(crypto.getRandomValues(new Uint8Array(16)));
  const body = `v1.${expires}.${nonce}`;
  const signature = encode(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await keyFor(env.SESSION_SIGNING_KEY!),
        new TextEncoder().encode(body),
      ),
    ),
  );
  return `${sessionName}=${body}.${signature}; Path=/; Max-Age=${sessionLifetime}; HttpOnly; Secure; SameSite=Strict`;
}
export const clearSession = () =>
  `${sessionName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
async function verifySession(request: Request, env: Env): Promise<boolean> {
  const value = cookieValue(request);
  if (!value || value.length > 256) return false;
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts[0] !== "v1" ||
    !/^\d{10}$/.test(parts[1]) ||
    !/^[A-Za-z0-9_-]{22}$/.test(parts[2]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[3])
  )
    return false;
  const expires = Number(parts[1]);
  if (
    expires <= Date.now() / 1000 ||
    expires > Date.now() / 1000 + sessionLifetime
  )
    return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await keyFor(env.SESSION_SIGNING_KEY!),
      decode(parts[3]),
      new TextEncoder().encode(parts.slice(0, 3).join(".")),
    );
  } catch {
    return false;
  }
}
async function sameSecret(a: string, b: string): Promise<boolean> {
  const digest = async (v: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    );
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
export async function authenticate(request: Request, env: Env): Promise<void> {
  const url = new URL(request.url);
  if (
    env.ENVIRONMENT === "development" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    if (!env.DEV_TOKEN || env.DEV_TOKEN.length < 32)
      throw new ApiFault(
        503,
        "auth_not_configured",
        "Execute npm run setup para configurar autenticação local.",
      );
    const auth = request.headers.get("authorization") ?? "";
    if (
      !auth.startsWith("Bearer ") ||
      !(await sameSecret(auth.slice(7), env.DEV_TOKEN))
    )
      throw new ApiFault(
        401,
        "unauthorized",
        "Token local ausente ou inválido.",
      );
    return;
  }
  if (passwordMode(env)) {
    if (!(await verifySession(request, env)))
      throw new ApiFault(
        401,
        "unauthorized",
        "Entre com sua senha para continuar.",
      );
    return;
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_EMAIL)
    throw new ApiFault(
      503,
      "auth_not_configured",
      "Autenticação de produção não configurada.",
    );
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN))
    throw new ApiFault(
      503,
      "auth_not_configured",
      "Emissor de autenticação inválido.",
    );
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token)
    throw new ApiFault(401, "unauthorized", "Autenticação necessária.");
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  if (!keys.has(issuer))
    keys.set(
      issuer,
      createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
        timeoutDuration: 5000,
      }),
    );
  try {
    const { payload } = await jwtVerify(token, keys.get(issuer)!, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "email"],
    });
    if (payload.email !== env.OWNER_EMAIL) throw new Error("wrong_owner");
  } catch {
    throw new ApiFault(
      401,
      "unauthorized",
      "Sessão inválida ou sem autorização.",
    );
  }
}
