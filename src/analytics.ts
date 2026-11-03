import type { Env } from "./env";
import { ApiFault } from "./errors";
import { first, stmt } from "./db";
import type {
  AnalyticsData,
  AnalyticsOverview,
} from "../packages/contracts/analytics";

export const ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly";
export const ANALYTICS_CALLBACK = "/api/analytics/oauth/callback";
const TTL = 12 * 60 * 60 * 1000;
const cookieName = "lastro_analytics_setup";
const b64 = (v: Uint8Array) =>
  btoa(String.fromCharCode(...v))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (v: string) =>
  b64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
  );
function config(env: Env) {
  if (env.ANALYTICS_ENABLED !== "true")
    throw new ApiFault(503, "analytics_disabled", "Analytics desativado.");
  if (env.GA4_PROPERTY_ID !== "560757639")
    throw new ApiFault(
      503,
      "analytics_not_configured",
      "Propriedade Analytics não configurada.",
    );
}
function origin(env: Env) {
  const value = env.ALLOWED_ORIGIN;
  if (
    !value ||
    ![
      "https://lastro.marioserafim.com.br",
      "https://lastro-ecosystem-staging.marioserafim-da.workers.dev",
    ].includes(value)
  )
    throw new ApiFault(
      503,
      "analytics_not_configured",
      "Origem Analytics não configurada.",
    );
  return value;
}
export async function beginAnalyticsOAuth(env: Env, request: Request) {
  config(env);
  if (request.headers.get("Origin") !== origin(env))
    throw new ApiFault(403, "origin_forbidden", "Origem não autorizada.");
  if (!env.GOOGLE_OAUTH_CLIENT_ID)
    throw new ApiFault(
      503,
      "analytics_not_configured",
      "Cliente OAuth não configurado.",
    );
  const state = random(),
    nonce = random(),
    verifier = random();
  await stmt(
    env.DB,
    "DELETE FROM analytics_oauth_states WHERE expires_at < ?",
    Date.now(),
  ).run();
  await stmt(
    env.DB,
    "INSERT INTO analytics_oauth_states VALUES (?,?,?,?)",
    state,
    await hash(nonce),
    verifier,
    Date.now() + 600000,
  ).run();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: origin(env) + ANALYTICS_CALLBACK,
    response_type: "code",
    scope: ANALYTICS_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: await hash(verifier),
    code_challenge_method: "S256",
  }).toString();
  return {
    url: url.toString(),
    cookie: `${cookieName}=${nonce}; Path=${ANALYTICS_CALLBACK}; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  };
}
// One-time owner provisioning: only the short-lived authorization code and PKCE
// verifier are downloaded. Access/refresh tokens and client secret never reach
// the browser. scripts/configure-analytics.mjs exchanges them in memory and
// installs them as Worker Secrets through the operator's existing Wrangler login.
export async function finishAnalyticsOAuth(env: Env, request: Request) {
  config(env);
  const url = new URL(request.url),
    state = url.searchParams.get("state");
  const nonce = request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!state || !nonce || state.length > 100 || nonce.length > 100)
    throw new ApiFault(
      400,
      "oauth_state_invalid",
      "Autorização inválida ou expirada.",
    );
  const record = await first<{
    verifier: string;
    nonce_hash: string;
    expires_at: number;
  }>(env.DB, "SELECT * FROM analytics_oauth_states WHERE id=?", state);
  if (
    !record ||
    record.expires_at < Date.now() ||
    record.nonce_hash !== (await hash(nonce))
  )
    throw new ApiFault(
      400,
      "oauth_state_invalid",
      "Autorização inválida ou expirada.",
    );
  const consumed = await stmt(
    env.DB,
    "DELETE FROM analytics_oauth_states WHERE id=? AND expires_at>=?",
    state,
    Date.now(),
  ).run();
  if (consumed.meta.changes !== 1)
    throw new ApiFault(400, "oauth_state_invalid", "Autorização já utilizada.");
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code || code.length > 4096)
    throw new ApiFault(400, "oauth_denied", "Autorização não concedida.");
  return new Response(
    JSON.stringify({
      code,
      verifier: record.verifier,
      redirectUri: origin(env) + ANALYTICS_CALLBACK,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition":
          'attachment; filename="lastro-analytics-authorization.json"',
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Set-Cookie": `${cookieName}=; Path=${ANALYTICS_CALLBACK}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      },
    },
  );
}
async function jsonResponse(response: Response) {
  if (!response.ok) {
    const code =
      response.status === 401
        ? "analytics_unauthorized"
        : response.status === 403
          ? "analytics_forbidden"
          : response.status === 429
            ? "analytics_quota"
            : "analytics_unavailable";
    throw new ApiFault(
      response.status === 401 || response.status === 403
        ? response.status
        : 503,
      code,
      "Analytics indisponível; confira credenciais, permissões ou cota.",
    );
  }
  return (await response.json()) as any;
}
export async function runAnalyticsReports(
  accessToken: string,
  property = "560757639",
): Promise<AnalyticsData> {
  if (property !== "560757639")
    throw new ApiFault(
      400,
      "analytics_property_invalid",
      "Propriedade inválida.",
    );
  const reports: AnalyticsData["reports"] = [];
  for (const dimension of ["date", "pagePath"] as const) {
    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
      {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }],
          dimensions: [{ name: dimension }],
          metrics: [
            { name: "activeUsers" },
            { name: "sessions" },
            { name: "screenPageViews" },
          ],
          limit: dimension === "date" ? 7 : 100,
          orderBys: [
            dimension === "date"
              ? { dimension: { dimensionName: "date" } }
              : { metric: { metricName: "screenPageViews" }, desc: true },
          ],
          returnPropertyQuota: true,
        }),
      },
    );
    const report = await jsonResponse(response);
    if (
      !report ||
      !Array.isArray(report.dimensionHeaders) ||
      !Array.isArray(report.metricHeaders) ||
      report.dimensionHeaders[0]?.name !== dimension ||
      report.metricHeaders.map((m: any) => m.name).join(",") !==
        "activeUsers,sessions,screenPageViews"
    )
      throw new ApiFault(
        503,
        "analytics_invalid_response",
        "Resposta Analytics inválida.",
      );
    const rows = (report.rows ?? [])
      .filter((r: any) =>
        dimension === "date"
          ? /^\d{8}$/.test(r.dimensionValues?.[0]?.value ?? "")
          : /^\/(?:|blog\/?|blog\/[a-z0-9-]+\/?|(?:en|pt)(?:\/|\/blog\/?|\/blog\/[a-z0-9-]+\/?)?)$/.test(
              r.dimensionValues?.[0]?.value ?? "",
            ),
      )
      .map((r: any) => ({
        [dimension]: r.dimensionValues[0].value,
        activeUsers: Number(r.metricValues?.[0]?.value ?? 0),
        sessions: Number(r.metricValues?.[1]?.value ?? 0),
        screenPageViews: Number(r.metricValues?.[2]?.value ?? 0),
      }));
    if (
      rows.some((r: any) =>
        [r.activeUsers, r.sessions, r.screenPageViews].some(
          (n) => !Number.isFinite(n) || n < 0,
        ),
      )
    )
      throw new ApiFault(
        503,
        "analytics_invalid_response",
        "Resposta Analytics inválida.",
      );
    reports.push({
      dimension,
      rows,
      rowCount: report.rowCount ?? 0,
      limited: dimension === "pagePath" && (report.rowCount ?? 0) > 100,
      privacyFiltered:
        dimension === "pagePath" && rows.length !== (report.rows ?? []).length,
    });
  }
  return {
    version: "analytics-1.0",
    propertyId: property,
    range: { start: "7daysAgo", end: "yesterday" },
    reports,
  };
}
export async function analyticsOverview(env: Env): Promise<AnalyticsOverview> {
  config(env);
  await stmt(
    env.DB,
    "INSERT OR IGNORE INTO analytics_cache(id) VALUES ('weekly')",
  ).run();
  const cached = await first<{
    body_json: string | null;
    fetched_at: number;
    next_at: number;
    error: string | null;
  }>(env.DB, "SELECT * FROM analytics_cache WHERE id='weekly'");
  const view = (row: typeof cached): AnalyticsOverview => ({
    version: "analytics-1.0",
    propertyId: env.GA4_PROPERTY_ID!,
    status: row?.error
      ? "unavailable"
      : row?.body_json
        ? "available"
        : "pending",
    freshness: {
      fetchedAt: row?.fetched_at
        ? new Date(row.fetched_at).toISOString()
        : null,
      stale: !row?.fetched_at || Date.now() - row.fetched_at >= TTL,
      nextAttemptAt: row?.next_at ? new Date(row.next_at).toISOString() : null,
    },
    error: row?.error ?? null,
    data: row?.body_json ? JSON.parse(row.body_json) : null,
  });
  if (cached && cached.next_at > Date.now()) return view(cached);
  const lock = await stmt(
    env.DB,
    "UPDATE analytics_cache SET lease_until=? WHERE id='weekly' AND lease_until<? AND next_at<=?",
    Date.now() + 60000,
    Date.now(),
    Date.now(),
  ).run();
  if (lock.meta.changes !== 1) return view(cached);
  try {
    if (
      !env.GOOGLE_OAUTH_CLIENT_ID ||
      !env.GOOGLE_OAUTH_CLIENT_SECRET ||
      !env.GA4_REFRESH_TOKEN
    )
      throw new ApiFault(
        503,
        "analytics_credentials_missing",
        "Credenciais Analytics não configuradas.",
      );
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: env.GA4_REFRESH_TOKEN,
      }),
    });
    if (tokenResponse.status === 400 || tokenResponse.status === 401)
      throw new ApiFault(
        401,
        "analytics_reauthorization_required",
        "Renove a autorização Analytics.",
      );
    const token = await jsonResponse(tokenResponse);
    if (typeof token.access_token !== "string")
      throw new ApiFault(
        503,
        "analytics_invalid_response",
        "Resposta OAuth inválida.",
      );
    const data = await runAnalyticsReports(
      token.access_token,
      env.GA4_PROPERTY_ID,
    );
    await stmt(
      env.DB,
      "UPDATE analytics_cache SET body_json=?,fetched_at=?,next_at=?,lease_until=0,error=NULL WHERE id='weekly'",
      JSON.stringify(data),
      Date.now(),
      Date.now() + TTL,
    ).run();
  } catch (error) {
    const code =
      error instanceof ApiFault ? error.code : "analytics_unavailable";
    await stmt(
      env.DB,
      "UPDATE analytics_cache SET next_at=?,lease_until=0,error=? WHERE id='weekly'",
      Date.now() + 3600000,
      code,
    ).run();
  }
  return view(
    await first(env.DB, "SELECT * FROM analytics_cache WHERE id='weekly'"),
  );
}
