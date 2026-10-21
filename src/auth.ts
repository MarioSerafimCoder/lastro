import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";
import { ApiFault } from "./errors";
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
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
