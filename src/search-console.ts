import { base64url, CompactEncrypt, compactDecrypt } from "jose";
import type {
  SearchDays,
  SearchMetrics,
  SearchOverview,
  SearchRange,
  SearchRow,
  SearchSnapshot,
} from "../packages/contracts/search-console";
import { localDay, shiftDay } from "../packages/contracts/jarvis-periods";
import { organicPageEngagement } from "./analytics";
import { readBounded } from "./connectors";
import { first, stmt } from "./db";
import type { Env } from "./env";
import { ApiFault } from "./errors";

export const SEARCH_CONSOLE_CALLBACK =
  "/api/analytics/search-console/oauth/callback";
export const SEARCH_CONSOLE_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";
const cookieName = "lastro_gsc_setup";
const site = "marioserafim.com.br";
const apiRoot = "https://www.googleapis.com/webmasters/v3/sites";
const dayMs = 86400000;
const random = () =>
  base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
const encoder = new TextEncoder();
const hash = async (value: string) =>
  base64url.encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
const formatDate = (clock: number) => new Date(clock).toISOString();
const fault = (code: string, status = 503) =>
  new ApiFault(
    status,
    code,
    {
      gsc_disabled: "Search Console desativado.",
      gsc_config:
        "Cliente OAuth e chave exclusiva do Search Console precisam ser configurados.",
      gsc_state: "Autorização inválida, expirada ou já utilizada.",
      gsc_denied: "A autorização de leitura não foi concedida.",
      gsc_property:
        "A conta Google não tem uma propriedade autorizada para o portfólio.",
      gsc_reauthorization: "Renove a autorização do Search Console.",
      gsc_quota: "A cota do Search Console está temporariamente indisponível.",
    }[code] ?? "Search Console temporariamente indisponível.",
  );

function configuration(env: Env) {
  try {
    const origin = new URL(env.ALLOWED_ORIGIN ?? "");
    const raw = env.SEARCH_CONSOLE_TOKEN_KEY ?? "";
    const key = base64url.decode(raw);
    const client = env.SEARCH_CONSOLE_CLIENT_ID;
    const secret = env.SEARCH_CONSOLE_CLIENT_SECRET;
    if (
      origin.protocol !== "https:" ||
      origin.origin !== env.ALLOWED_ORIGIN ||
      !client ||
      !secret ||
      !/^[A-Za-z0-9_-]{43}$/.test(raw) ||
      key.length !== 32 ||
      client === env.GOOGLE_OAUTH_CLIENT_ID ||
      client === env.BRAIN_DRIVE_CLIENT_ID ||
      raw === env.BRAIN_DRIVE_TOKEN_KEY
    )
      return null;
    return {
      origin: origin.origin,
      redirect: origin.origin + SEARCH_CONSOLE_CALLBACK,
      client,
      secret,
      key,
    };
  } catch {
    return null;
  }
}
type Config = NonNullable<ReturnType<typeof configuration>>;
function requireConfig(env: Env) {
  if (env.SEARCH_CONSOLE_ENABLED !== "true") throw fault("gsc_disabled");
  const config = configuration(env);
  if (!config) throw fault("gsc_config");
  return config;
}
const encrypt = (key: Uint8Array, purpose: string, value: string) =>
  new CompactEncrypt(encoder.encode(value))
    .setProtectedHeader({
      alg: "dir",
      enc: "A256GCM",
      typ: `lastro-gsc-${purpose}`,
    })
    .encrypt(key);
async function decrypt(key: Uint8Array, purpose: string, value: string) {
  const result = await compactDecrypt(value, key, {
    keyManagementAlgorithms: ["dir"],
    contentEncryptionAlgorithms: ["A256GCM"],
  });
  if (result.protectedHeader.typ !== `lastro-gsc-${purpose}`)
    throw fault("gsc_config");
  return new TextDecoder().decode(result.plaintext);
}
const setCookie = (value: string, age: number) =>
  `${cookieName}=${value}; Path=${SEARCH_CONSOLE_CALLBACK}; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

export async function beginSearchOAuth(env: Env, request: Request) {
  const config = requireConfig(env);
  if (
    new URL(request.url).origin !== config.origin ||
    request.headers.get("Origin") !== config.origin
  )
    throw new ApiFault(403, "origin_forbidden", "Origem não autorizada.");
  const state = random(),
    nonce = random(),
    verifier = random(),
    now = Date.now();
  await stmt(
    env.DB,
    `INSERT INTO search_console_oauth VALUES (1,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET state_hash=excluded.state_hash,nonce_hash=excluded.nonce_hash,
      verifier_cipher=excluded.verifier_cipher,created_at=excluded.created_at,expires_at=excluded.expires_at`,
    await hash(state),
    await hash(nonce),
    await encrypt(config.key, "pkce", verifier),
    now,
    now + 600000,
  ).run();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.client,
    redirect_uri: config.redirect,
    response_type: "code",
    scope: SEARCH_CONSOLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: await hash(verifier),
    code_challenge_method: "S256",
  }).toString();
  return { authorizationUrl: url.href, cookie: setCookie(nonce, 600) };
}

async function googleJson(url: string, init: RequestInit, max = 131072) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    if (
      response.status === 400 &&
      url === "https://oauth2.googleapis.com/token"
    ) {
      const body = await readBounded(response, 4096)
        .then((raw) => JSON.parse(raw))
        .catch(() => null);
      if (body?.error === "invalid_grant")
        throw fault("gsc_reauthorization", 401);
      throw fault("gsc_config");
    }
    if (response.status === 403) {
      const body = await readBounded(response, 8192)
        .then((raw) => JSON.parse(raw))
        .catch(() => null);
      if (
        Array.isArray(body?.error?.errors) &&
        body.error.errors.some((entry: { reason?: string }) =>
          [
            "quotaExceeded",
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "dailyLimitExceeded",
          ].includes(entry?.reason ?? ""),
        )
      )
        throw fault("gsc_quota");
      throw fault("gsc_reauthorization", 401);
    }
    await response.body?.cancel();
    if (response.status === 429) throw fault("gsc_quota");
    if (response.status === 401) throw fault("gsc_reauthorization", 401);
    throw fault("gsc_unavailable");
  }
  return JSON.parse(await readBounded(response, max));
}
async function exchange(
  config: Config,
  grant: Record<string, string>,
  initial = false,
) {
  const token = await googleJson(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      body: new URLSearchParams({
        client_id: config.client,
        client_secret: config.secret,
        ...grant,
      }),
    },
    8192,
  );
  if (
    typeof token?.access_token !== "string" ||
    !token.access_token ||
    token.access_token.length > 4096 ||
    ((initial || token.scope !== undefined) &&
      token.scope !== SEARCH_CONSOLE_SCOPE)
  )
    throw fault("gsc_denied", 400);
  return token as { access_token: string; refresh_token?: unknown };
}

export function selectProperty(sites: unknown) {
  if (!Array.isArray(sites)) return null;
  const allowed = new Set(
    sites
      .filter((site) =>
        ["siteOwner", "siteFullUser", "siteRestrictedUser"].includes(
          site?.permissionLevel,
        ),
      )
      .map((site) => site.siteUrl),
  );
  return (
    [`https://${site}/`, `sc-domain:${site}`].find((property) =>
      allowed.has(property),
    ) ?? null
  );
}

export async function finishSearchOAuth(env: Env, request: Request) {
  const config = requireConfig(env);
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const nonce =
    request.headers
      .get("Cookie")
      ?.split(/;\s*/)
      .find((item) => item.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) ?? "";
  if (
    url.origin !== config.origin ||
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(nonce)
  )
    throw fault("gsc_state", 400);
  const generation = await hash(state);
  const record = await stmt(
    env.DB,
    `DELETE FROM search_console_oauth
    WHERE id=1 AND state_hash=? AND nonce_hash=? AND expires_at>=? RETURNING verifier_cipher,created_at`,
    generation,
    await hash(nonce),
    Date.now(),
  ).first<{ verifier_cipher: string; created_at: number }>();
  if (!record) throw fault("gsc_state", 400);
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code || code.length > 4096)
    throw fault("gsc_denied", 400);
  const token = await exchange(
    config,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirect,
      code_verifier: await decrypt(config.key, "pkce", record.verifier_cipher),
    },
    true,
  );
  if (
    typeof token.refresh_token !== "string" ||
    !token.refresh_token ||
    token.refresh_token.length > 4096
  )
    throw fault("gsc_denied", 400);
  const data = await googleJson(apiRoot, {
    headers: { Authorization: "Bearer " + token.access_token },
  });
  const property = selectProperty(data?.siteEntry);
  if (!property) throw fault("gsc_property", 403);
  await env.DB.batch([
    stmt(
      env.DB,
      `INSERT INTO search_console_connection VALUES (1,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET
      generation=excluded.generation, connected_at=excluded.connected_at, property=excluded.property,
      token_cipher=excluded.token_cipher,error=NULL WHERE excluded.connected_at>=search_console_connection.connected_at`,
      generation,
      record.created_at,
      property,
      await encrypt(config.key, "refresh", token.refresh_token),
    ),
    stmt(
      env.DB,
      `DELETE FROM analytics_cache WHERE id IN ('gsc-7','gsc-28','gsc-90')
      AND EXISTS(SELECT 1 FROM search_console_connection WHERE id=1 AND generation=?)`,
      generation,
    ),
  ]);
  return new Response(null, {
    status: 303,
    headers: {
      Location: config.origin + "/analytics#pesquisa-organica",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": setCookie("", 0),
    },
  });
}

type Dimension = "date" | "page" | "query";
function publicPath(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      (url.hostname === site || url.hostname.endsWith("." + site)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.port
    )
      return url.href;
  } catch {
    /* Ignore malformed or private dimensions. */
  }
  return null;
}
const safeText = (value: string) =>
  value.length <= 180 &&
  value.length > 0 &&
  !/[@\u0000-\u001f\u007f]|\b\d[\d(). -]{7,}\d\b|https?:\/\//i.test(value);
const validMetrics = (row: any): row is SearchMetrics =>
  Number.isSafeInteger(row?.clicks) &&
  row.clicks >= 0 &&
  Number.isSafeInteger(row?.impressions) &&
  row.impressions >= row.clicks &&
  typeof row?.ctr === "number" &&
  row.ctr >= 0 &&
  row.ctr <= 1 &&
  Number.isFinite(row?.position) &&
  row.position >= 0;
async function report(
  property: string,
  token: string,
  range: SearchRange,
  dimension?: Dimension,
): Promise<SearchRow[]> {
  const limit = dimension === "date" ? 90 : dimension ? 100 : 1;
  const result = await googleJson(
    `${apiRoot}/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: range.start,
        endDate: range.end,
        dimensions: dimension ? [dimension] : [],
        type: "web",
        dataState: "final",
        aggregationType: "auto",
        rowLimit: limit,
      }),
    },
  );
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    (result.rows !== undefined &&
      (!Array.isArray(result.rows) || result.rows.length > limit))
  )
    throw fault("gsc_invalid_response");
  const output: SearchRow[] = [];
  for (const row of result.rows ?? []) {
    const raw = row?.keys?.[0];
    if (!validMetrics(row)) throw fault("gsc_invalid_response");
    const key = !dimension
      ? "total"
      : typeof raw !== "string"
        ? null
        : dimension === "page"
          ? publicPath(raw)
          : dimension === "date"
            ? /^\d{4}-\d{2}-\d{2}$/.test(raw) &&
              raw >= range.start &&
              raw <= range.end
              ? raw
              : null
            : safeText(raw)
              ? raw
              : null;
    if (key)
      output.push({
        key,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      });
  }
  return output;
}

export async function loadSearchReports(
  env: Env,
  property: string,
  token: string,
  days: SearchDays,
  clock = Date.now(),
): Promise<SearchSnapshot> {
  const end = shiftDay(localDay(clock, "America/Los_Angeles"), -3);
  const range = { start: shiftDay(end, 1 - days), end };
  const previousRange = {
    start: shiftDay(range.start, -days),
    end: shiftDay(range.start, -1),
  };
  const [totals, previous, daily] = await Promise.all([
    report(property, token, range),
    report(property, token, previousRange),
    report(property, token, range, "date"),
  ]);
  const [queries, pages, engagement] = await Promise.all([
    report(property, token, range, "query"),
    report(property, token, range, "page"),
    totals.length ? organicPageEngagement(env, range).catch(() => null) : null,
  ]);
  const candidates = pages
    .filter(
      (page) => page.impressions >= 100 && page.ctr < (totals[0]?.ctr ?? 0),
    )
    .sort((a, b) => b.impressions - a.impressions || a.ctr - b.ctr)
    .slice(0, 10);
  return {
    range,
    previousRange,
    total: totals[0] ?? null,
    previous: previous[0] ?? null,
    daily: daily.sort((a, b) => a.key.localeCompare(b.key)),
    queries,
    pages,
    queryOpportunities: queries
      .filter(
        (query) =>
          query.impressions >= 50 &&
          query.position >= 4 &&
          query.position <= 20,
      )
      .sort((a, b) => b.impressions - a.impressions || a.ctr - b.ctr)
      .slice(0, 10),
    opportunities: candidates.map((page) => {
      const url = new URL(page.key);
      return {
        ...page,
        ga4:
          url.hostname === site
            ? (engagement?.get(url.pathname) ?? null)
            : null,
      };
    }),
    ga4: engagement ? "available" : "unavailable",
  };
}

type Connection = {
  generation: string;
  property: string;
  token_cipher: string;
  error: string | null;
};
type Cache = {
  fetched_at: number;
  next_at: number;
  error: string | null;
  body_json: string | null;
};
const empty = (status: SearchOverview["status"]): SearchOverview => ({
  status,
  property: null,
  fetchedAt: null,
  nextAttemptAt: null,
  stale: false,
  error: null,
  data: null,
});

export async function searchOverview(
  env: Env,
  days: SearchDays,
  refresh = false,
): Promise<SearchOverview> {
  if (env.SEARCH_CONSOLE_ENABLED !== "true") return empty("disabled");
  const config = configuration(env);
  if (!config) return empty("unconfigured");
  const connection = () =>
    first<Connection>(
      env.DB,
      "SELECT generation,property,token_cipher,error FROM search_console_connection WHERE id=1",
    );
  const current = await connection();
  if (!current) return empty("disconnected");
  const id = `gsc-${days}`,
    now = Date.now();
  const cache = () =>
    first<Cache>(
      env.DB,
      "SELECT fetched_at,next_at,error,body_json FROM analytics_cache WHERE id=?",
      id,
    );
  if (refresh && !current.error) {
    await stmt(
      env.DB,
      "INSERT OR IGNORE INTO analytics_cache(id) VALUES (?)",
      id,
    ).run();
    const lease = now + 60000;
    const lock = await stmt(
      env.DB,
      `UPDATE analytics_cache SET lease_until=? WHERE id=? AND lease_until<=? AND next_at<=?
      AND NOT EXISTS(SELECT 1 FROM analytics_cache WHERE id IN ('gsc-7','gsc-28','gsc-90')
        AND (lease_until>? OR (error='gsc_quota' AND next_at>?)))
      AND EXISTS(SELECT 1 FROM search_console_connection WHERE id=1 AND generation=? AND error IS NULL)`,
      lease,
      id,
      now,
      now,
      now,
      now,
      current.generation,
    ).run();
    if (lock.meta.changes) {
      let data: SearchSnapshot | null = null;
      let error: string | null = null;
      try {
        const token = await exchange(config, {
          grant_type: "refresh_token",
          refresh_token: await decrypt(
            config.key,
            "refresh",
            current.token_cipher,
          ),
        });
        data = await loadSearchReports(
          env,
          current.property,
          token.access_token,
          days,
          now,
        );
      } catch (e) {
        error = e instanceof ApiFault ? e.code : "gsc_unavailable";
      }
      const finished = Date.now();
      await env.DB.batch([
        stmt(
          env.DB,
          `UPDATE analytics_cache SET body_json=COALESCE(?,body_json),
          fetched_at=CASE WHEN ? IS NULL THEN ? ELSE fetched_at END, next_at=?, lease_until=0,error=?
          WHERE id=? AND lease_until=? AND EXISTS(SELECT 1 FROM search_console_connection WHERE id=1 AND generation=?)`,
          data ? JSON.stringify(data) : null,
          error,
          finished,
          finished +
            (error === "gsc_quota" ? 4 * 3600000 : error ? 3600000 : dayMs),
          error,
          id,
          lease,
          current.generation,
        ),
        ...(error === "gsc_reauthorization"
          ? [
              stmt(
                env.DB,
                `UPDATE search_console_connection SET error=?
          WHERE id=1 AND generation=?`,
                error,
                current.generation,
              ),
            ]
          : []),
      ]);
    }
  }
  const [latest, row, backoff] = await Promise.all([
    connection(),
    cache(),
    first<{ until: number | null }>(
      env.DB,
      "SELECT MAX(next_at) until FROM analytics_cache WHERE id IN ('gsc-7','gsc-28','gsc-90') AND error='gsc_quota' AND next_at>?",
      now,
    ),
  ]);
  if (latest?.generation !== current.generation)
    return empty(latest ? "pending" : "disconnected");
  const error =
    latest.error ?? (backoff?.until ? "gsc_quota" : row?.error) ?? null;
  const next = Math.max(row?.next_at ?? 0, backoff?.until ?? 0);
  return {
    property: latest.property,
    status: latest.error
      ? "reauthorize"
      : error
        ? "unavailable"
        : row?.body_json
          ? "available"
          : "pending",
    fetchedAt: row?.fetched_at ? formatDate(row.fetched_at) : null,
    nextAttemptAt: next ? formatDate(next) : null,
    stale: !!row?.fetched_at && (now - row.fetched_at >= dayMs || !!error),
    error,
    data: row?.body_json ? JSON.parse(row.body_json) : null,
  };
}
