import { localDay, shiftDay } from "../packages/contracts/jarvis-periods";
import type { Env } from "./env";
import { ApiFault } from "./errors";
import { first, stmt } from "./db";
import { readBounded } from "./connectors";
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
async function analyticsAccessToken(env: Env): Promise<string> {
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
  const response = await fetch("https://oauth2.googleapis.com/token", {
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
  if (response.status === 400 || response.status === 401)
    throw new ApiFault(
      401,
      "analytics_reauthorization_required",
      "Renove a autorização Analytics.",
    );
  const token = await jsonResponse(response);
  if (typeof token.access_token !== "string")
    throw new ApiFault(
      503,
      "analytics_invalid_response",
      "Resposta OAuth inválida.",
    );
  return token.access_token;
}

export async function organicPageEngagement(
  env: Env,
  range: { start: string; end: string },
) {
  config(env);
  const accessToken = await analyticsAccessToken(env);
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(6000),
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: range.start, endDate: range.end }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "sessions" }, { name: "engagementRate" }],
        limit: 100,
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        dimensionFilter: {
          andGroup: {
            expressions: Object.entries({
              hostName: "marioserafim.com.br",
              sessionSource: "google",
              sessionMedium: "organic",
            }).map(([fieldName, value]) => ({
              filter: {
                fieldName,
                stringFilter: { matchType: "EXACT", value },
              },
            })),
          },
        },
      }),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw Error("analytics_unavailable");
  }
  const report = JSON.parse(await readBounded(response, 65_536));
  if (
    report.metadata?.subjectToThresholding ||
    report.metadata?.dataLossFromOtherRow ||
    report.metadata?.samplingMetadatas?.length
  )
    throw Error("analytics_limited");
  if (
    !report.rows &&
    report.kind === "analyticsData#runReport" &&
    !report.rowCount
  )
    return new Map<string, { sessions: number; engagementRate: number }>();
  if (
    report.dimensionHeaders?.[0]?.name !== "pagePath" ||
    report.metricHeaders
      ?.map((value: { name: string }) => value.name)
      .join(",") !== "sessions,engagementRate" ||
    !Array.isArray(report.rows) ||
    report.rows.length > 100
  )
    throw Error("analytics_invalid_response");
  const pages = new Map<string, { sessions: number; engagementRate: number }>();
  for (const row of report.rows) {
    const path = row.dimensionValues?.[0]?.value;
    const sessions = Number(row.metricValues?.[0]?.value);
    const engagementRate = Number(row.metricValues?.[1]?.value);
    if (
      typeof path === "string" &&
      path.startsWith("/") &&
      Number.isSafeInteger(sessions) &&
      sessions >= 0 &&
      Number.isFinite(engagementRate) &&
      engagementRate >= 0 &&
      engagementRate <= 1
    )
      pages.set(path, { sessions, engagementRate });
  }
  return pages;
}
export async function runAnalyticsReports(
  accessToken: string,
  property = "560757639",
  days: 7 | 30 = 7,
  newsletter = false,
): Promise<AnalyticsData> {
  if (property !== "560757639")
    throw new ApiFault(
      400,
      "analytics_property_invalid",
      "Propriedade inválida.",
    );
  const metrics = [
    "activeUsers",
    "sessions",
    "screenPageViews",
    "engagementRate",
    "userEngagementDuration",
  ];
  const reports: AnalyticsData["reports"] = [];
  const started = Date.now();
  const zones = new Set<string>();
  let completeZones = true;
  let quota: AnalyticsData["quota"];
  for (const dimension of [
    "total",
    "date",
    "pagePath",
    "sessionSourceMedium",
    "sessionCampaignName",
  ] as const) {
    const dimensions = dimension === "total" ? [] : [{ name: dimension }];
    if (newsletter && (dimension === "date" || dimension === "pagePath"))
      dimensions.push({ name: "sessionCampaignName" });
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
          ...(newsletter
            ? {
                dimensionFilter: {
                  andGroup: {
                    expressions: [
                      {
                        filter: {
                          fieldName: "sessionSource",
                          stringFilter: {
                            matchType: "EXACT",
                            value: "mais_um_cafezinho",
                          },
                        },
                      },
                      {
                        filter: {
                          fieldName: "sessionMedium",
                          stringFilter: { matchType: "EXACT", value: "email" },
                        },
                      },
                    ],
                  },
                },
              }
            : {}),
          dateRanges: [{ startDate: `${days}daysAgo`, endDate: "yesterday" }],
          dimensions,
          metrics: metrics.map((name) => ({ name })),
          limit:
            dimension === "total"
              ? 1
              : dimension === "date" && !newsletter
                ? days
                : 100,
          orderBys:
            dimension === "total"
              ? []
              : dimension === "date"
                ? [{ dimension: { dimensionName: "date" } }]
                : [{ metric: { metricName: "screenPageViews" }, desc: true }],
          returnPropertyQuota: true,
        }),
      },
    );
    const report = await jsonResponse(response);
    const dailyQuota = report.propertyQuota?.tokensPerDay;
    if (
      Number.isSafeInteger(dailyQuota?.consumed) &&
      dailyQuota.consumed >= 0 &&
      Number.isSafeInteger(dailyQuota?.remaining) &&
      dailyQuota.remaining >= 0
    )
      quota = {
        daily: {
          consumed: dailyQuota.consumed,
          remaining: dailyQuota.remaining,
        },
      };
    try {
      const zone = report.metadata?.timeZone;
      if (typeof zone !== "string") completeZones = false;
      else {
        localDay(started, zone);
        zones.add(zone);
      }
    } catch {
      completeZones = false;
    }
    // GA4 may omit repeated header fields for a metadata-only empty report.
    // Keep it empty, rather than manufacturing zero-valued metric rows.
    if (
      newsletter &&
      report.kind === "analyticsData#runReport" &&
      report.metadata &&
      typeof report.metadata === "object" &&
      (report.rows === undefined ||
        (Array.isArray(report.rows) && report.rows.length === 0)) &&
      (report.rowCount === undefined || report.rowCount === 0) &&
      report.metricHeaders === undefined &&
      report.dimensionHeaders === undefined
    ) {
      reports.push({
        dimension,
        rows: [],
        rowCount: 0,
        limited: false,
        privacyFiltered: false,
      });
      continue;
    }
    if (
      !Array.isArray(report.dimensionHeaders ?? []) ||
      !Array.isArray(report.metricHeaders) ||
      (report.dimensionHeaders ?? []).map((d: any) => d.name).join(",") !==
        dimensions.map((d) => d.name).join(",") ||
      report.metricHeaders.map((m: any) => m.name).join(",") !==
        metrics.join(",")
    )
      throw new ApiFault(
        503,
        "analytics_invalid_response",
        "Resposta Analytics inválida.",
      );
    const raw = report.rows ?? [];
    if (!Array.isArray(raw))
      throw new ApiFault(
        503,
        "analytics_invalid_response",
        "Resposta Analytics inválida.",
      );
    const rows = raw
      .filter((r: any) => {
        const v = r.dimensionValues?.[0]?.value ?? "";
        if (
          dimensions.length > 1 &&
          !/^[a-z0-9-]{1,100}$/.test(r.dimensionValues?.[1]?.value ?? "")
        )
          return false;
        return dimension === "total" || dimension === "date"
          ? dimension === "total" || /^\d{8}$/.test(v)
          : dimension === "pagePath"
            ? /^\/(?:|blog\/?|blog\/[a-z0-9-]+\/?|(?:en|pt)(?:\/|\/blog\/?|\/blog\/[a-z0-9-]+\/?)?)$/.test(
                v,
              )
            : typeof v === "string" &&
              v.length <= 160 &&
              !/[@?=#\\]|https?:/i.test(v);
      })
      .map((r: any) => ({
        ...(dimension === "total"
          ? {}
          : { [dimension]: r.dimensionValues[0].value }),
        ...(dimensions.length > 1
          ? { sessionCampaignName: r.dimensionValues[1].value }
          : {}),
        ...Object.fromEntries(
          metrics.map((m, i) => [m, Number(r.metricValues?.[i]?.value ?? 0)]),
        ),
      }));
    if (
      rows.some(
        (r: any) =>
          metrics.some((m) => !Number.isFinite(r[m]) || r[m] < 0) ||
          r.engagementRate > 1,
      )
    )
      throw new ApiFault(
        503,
        "analytics_invalid_response",
        "Resposta Analytics inválida.",
      );
    reports.push({
      dimension,
      rows: rows as AnalyticsData["reports"][number]["rows"],
      rowCount: report.rowCount ?? 0,
      limited:
        (report.rowCount ?? 0) >
        (dimension === "total"
          ? 1
          : dimension === "date" && !newsletter
            ? days
            : 100),
      privacyFiltered:
        rows.length !== raw.length ||
        !!report.metadata?.subjectToThresholding ||
        !!report.metadata?.dataLossFromOtherRow ||
        !!report.metadata?.samplingMetadatas?.length ||
        !!report.metadata?.dataTruncationReasons?.length,
    });
  }
  return {
    version: "analytics-1.0",
    propertyId: property,
    range: { start: `${days}daysAgo`, end: "yesterday" },
    ...(quota ? { quota } : {}),
    ...(completeZones &&
    zones.size === 1 &&
    localDay(started, [...zones][0]) === localDay(Date.now(), [...zones][0])
      ? {
          timeZone: [...zones][0],
          effectiveRange: {
            start: shiftDay(localDay(started, [...zones][0]), -days),
            end: shiftDay(localDay(started, [...zones][0]), -1),
          },
        }
      : {}),
    reports,
  };
}
export async function analyticsOverview(
  env: Env,
  days: 7 | 30 = 7,
  refresh = false,
  newsletter = false,
): Promise<AnalyticsOverview> {
  config(env);
  if (days !== 7 && days !== 30)
    throw new ApiFault(400, "analytics_range_invalid", "Périodo inválido.");
  const cacheId = `${newsletter ? "newsletter-v2" : "analytics-v2"}-${days}`;
  await stmt(
    env.DB,
    "INSERT OR IGNORE INTO analytics_cache(id) VALUES (?)",
    cacheId,
  ).run();
  const cached = await first<{
    body_json: string | null;
    fetched_at: number;
    next_at: number;
    error: string | null;
  }>(env.DB, "SELECT * FROM analytics_cache WHERE id=?", cacheId);
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
  if (
    cached &&
    cached.next_at > Date.now() &&
    (!refresh || cached.error || Date.now() - cached.fetched_at < 3600000)
  )
    return view(cached);
  const lock = await stmt(
    env.DB,
    "UPDATE analytics_cache SET lease_until=? WHERE id=? AND lease_until<? AND (next_at<=? OR (?=1 AND error IS NULL AND fetched_at<=?))",
    Date.now() + 90000,
    cacheId,
    Date.now(),
    Date.now(),
    refresh ? 1 : 0,
    Date.now() - 3600000,
  ).run();
  if (lock.meta.changes !== 1) return view(cached);
  try {
    const data = await runAnalyticsReports(
      await analyticsAccessToken(env),
      env.GA4_PROPERTY_ID,
      days,
      newsletter,
    );
    await stmt(
      env.DB,
      "UPDATE analytics_cache SET body_json=?,fetched_at=?,next_at=?,lease_until=0,error=NULL WHERE id=?",
      JSON.stringify(data),
      Date.now(),
      Date.now() + TTL,
      cacheId,
    ).run();
  } catch (error) {
    const code =
      error instanceof ApiFault ? error.code : "analytics_unavailable";
    await stmt(
      env.DB,
      "UPDATE analytics_cache SET next_at=?,lease_until=0,error=? WHERE id=?",
      Date.now() + 3600000,
      code,
      cacheId,
    ).run();
  }
  return view(
    await first(env.DB, "SELECT * FROM analytics_cache WHERE id=?", cacheId),
  );
}
