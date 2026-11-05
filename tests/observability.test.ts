import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { migrationStatements } from "./migration-statements";
import { ecosystemHealth } from "../src/health";
import { quotaLevel } from "../src/health-metrics";
import {
  beginSearchOAuth,
  searchOverview,
  selectProperty,
  SEARCH_CONSOLE_CALLBACK,
  SEARCH_CONSOLE_SCOPE,
} from "../src/search-console";
import { app } from "../src/index";
import {
  advanceDialogue,
  dialogueScope,
  loadDialogue,
} from "../src/jarvis-dialogue";
import type { Env } from "../src/env";

const origin = "https://lastro.example.test";
const fetcher = globalThis.fetch;
let mf: Miniflare;
let env: Env;
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response()}}",
      d1Databases: ["DB"],
      compatibilityDate: "2026-10-01",
    }),
  );
  env = {
    DB: (await mf.getD1Database("DB")) as unknown as D1Database,
    ALLOWED_ORIGIN: origin,
    ENVIRONMENT: "development",
    DEV_TOKEN: "test-token-".repeat(4),
    ECOSYSTEM_HEALTH_ENABLED: "true",
    INTEGRATION_ENABLED: "true",
    INGEST_ENABLED: "true",
    ANALYTICS_ENABLED: "true",
    GA4_PROPERTY_ID: "560757639",
    GOOGLE_OAUTH_CLIENT_ID: "ga4-test",
    GOOGLE_OAUTH_CLIENT_SECRET: "ga4-secret",
    GA4_REFRESH_TOKEN: "ga4-test-token",
    SEARCH_CONSOLE_ENABLED: "true",
    SEARCH_CONSOLE_CLIENT_ID: "gsc-test",
    SEARCH_CONSOLE_CLIENT_SECRET: "gsc-secret",
    SEARCH_CONSOLE_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64url"),
  };
  const files = (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files)
    for (const sql of migrationStatements(
      await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    ))
      await env.DB.prepare(sql).run();
});
after(() => mf.dispose());
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM analytics_cache"),
    env.DB.prepare("DELETE FROM search_console_connection"),
    env.DB.prepare("DELETE FROM search_console_oauth"),
    env.DB.prepare(
      "UPDATE ecosystem_health SET snapshot_json=NULL,lease=NULL,lease_until=0,next_at=0 WHERE id=1",
    ),
  ]);
  globalThis.fetch = async () => {
    throw Error("unexpected external request");
  };
});
afterEach(() => {
  globalThis.fetch = fetcher;
});

test("health keeps one bounded snapshot, preserves unknown states, and records quota transitions", async () => {
  const clock = Date.parse("2026-11-05T14:00:00Z");
  let probes = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://marioserafim.com.br/");
    assert.equal(options?.method, "HEAD");
    probes++;
    return new Response(null, { status: 200 });
  };
  const saveQuota = (consumed: number) =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO analytics_cache(id,body_json,fetched_at) VALUES ('analytics-v2-7',?,?)",
    )
      .bind(
        JSON.stringify({
          quota: { daily: { consumed, remaining: 100 - consumed } },
        }),
        clock,
      )
      .run();
  await saveQuota(91);
  assert.equal((await ecosystemHealth(env, false, clock)).snapshot, null);
  assert.equal(probes, 0);
  await Promise.all([
    ecosystemHealth(env, true, clock),
    ecosystemHealth(env, true, clock),
  ]);
  const { snapshot } = await ecosystemHealth(env, false, clock);
  assert.ok(snapshot);
  assert.equal(probes, 1);
  assert.equal(
    snapshot.items.find((x) => x.id === "portfolio")?.state,
    "unknown",
  );
  assert.equal(snapshot.items.find((x) => x.id === "rss")?.state, "unknown");
  assert.equal(snapshot.items.find((x) => x.id === "lastro")?.state, "healthy");
  assert.equal(
    snapshot.metrics.find((x) => x.id === "workers-account")?.value,
    null,
  );
  assert.equal(
    snapshot.events.filter((x) => x.id === "quota-ga4-quota").length,
    1,
  );
  const quota = snapshot.metrics.find((x) => x.id === "ga4-quota")!;
  assert.equal(quotaLevel(quota), 2);
  assert.equal(quotaLevel(quota, "50,60,90"), 3);
  await ecosystemHealth(env, true, clock + 31 * 60000);
  await saveQuota(20);
  const recovered = await ecosystemHealth(env, true, clock + 62 * 60000);
  assert.equal(
    recovered.snapshot?.events.filter((x) => x.id === "quota-ga4-quota").length,
    2,
  );
  assert.equal(recovered.snapshot?.events[0].state, "healthy");
  assert.equal(
    (await app.request("http://localhost/api/ecosystem/health", {}, env))
      .status,
    401,
  );
  const response = await app.request(
    "http://localhost/api/ecosystem/health/refresh",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + env.DEV_TOKEN, Origin: origin },
    },
    env,
  );
  assert.equal(response.status, 403);
});

test("Search Console authorizes an allowed property, encrypts credentials, caches and distinguishes revoked access", async () => {
  const property = "sc-domain:marioserafim.com.br";
  assert.equal(
    selectProperty([
      { siteUrl: "https://unrelated.test/", permissionLevel: "siteOwner" },
    ]),
    null,
  );
  assert.equal(
    selectProperty([
      { siteUrl: property, permissionLevel: "siteOwner" },
      {
        siteUrl: "https://marioserafim.com.br/",
        permissionLevel: "siteFullUser",
      },
    ]),
    "https://marioserafim.com.br/",
  );
  assert.equal((await searchOverview(env, 28)).status, "disconnected");
  const request = new Request(
    origin + "/api/analytics/search-console/oauth/start",
    { method: "POST", headers: { Origin: origin } },
  );
  await assert.rejects(
    beginSearchOAuth(
      { ...env, SEARCH_CONSOLE_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID },
      request,
    ),
  );
  const started = await beginSearchOAuth(env, request);
  const consent = new URL(started.authorizationUrl);
  assert.equal(consent.searchParams.get("scope"), SEARCH_CONSOLE_SCOPE);
  assert.equal(consent.searchParams.get("code_challenge_method"), "S256");
  assert.match(started.cookie, /HttpOnly; Secure; SameSite=Lax/);
  const callback =
    origin +
    SEARCH_CONSOLE_CALLBACK +
    "?code=test-code&state=" +
    consent.searchParams.get("state");
  assert.equal((await app.request(callback, {}, env)).status, 400);
  let googleCalls = 0;
  let revoked = false;
  let quota = false;
  const windows: Record<string, string>[] = [];
  globalThis.fetch = async (input, init) => {
    googleCalls++;
    assert.equal(
      init?.redirect,
      String(input).includes("oauth2.googleapis.com") &&
        String(init?.body).includes("client_id=ga4-test")
        ? "manual"
        : "error",
    );
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      const grant = new URLSearchParams(String(init?.body));
      if (grant.get("client_id") === "ga4-test") {
        assert.equal(grant.get("refresh_token"), "ga4-test-token");
        return Response.json({ access_token: "ga4-access" });
      }
      assert.equal(grant.get("client_id"), "gsc-test");
      if (grant.get("grant_type") === "authorization_code") {
        assert.match(grant.get("code_verifier")!, /^[A-Za-z0-9_-]{43}$/);
        return Response.json({
          access_token: "gsc-access",
          refresh_token: "gsc-private-test-token",
          scope: SEARCH_CONSOLE_SCOPE,
        });
      }
      assert.equal(grant.get("refresh_token"), "gsc-private-test-token");
      return revoked
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json({ access_token: "gsc-access" });
    }
    if (url === "https://www.googleapis.com/webmasters/v3/sites")
      return Response.json({
        siteEntry: [{ siteUrl: property, permissionLevel: "siteOwner" }],
      });
    const body = JSON.parse(String(init?.body));
    if (url.includes("analyticsdata.googleapis.com")) {
      assert.deepEqual(body.dateRanges[0], {
        startDate: windows[0].startDate,
        endDate: windows[0].endDate,
      });
      return Response.json({
        dimensionHeaders: [{ name: "pagePath" }],
        metricHeaders: [{ name: "sessions" }, { name: "engagementRate" }],
        rows: [
          {
            dimensionValues: [{ value: "/blog/artigo" }],
            metricValues: [{ value: "17" }, { value: "0.6" }],
          },
        ],
      });
    }
    assert.ok(url.includes(encodeURIComponent(property)));
    assert.equal(body.dataState, "final");
    if (quota)
      return Response.json(
        { error: { errors: [{ reason: "rateLimitExceeded" }] } },
        { status: 403 },
      );
    windows.push(body);
    const row = { clicks: 20, impressions: 500, ctr: 0.04, position: 9 };
    const dim = body.dimensions[0];
    if (dim === "page")
      return Response.json({
        rows: [{ ...row, keys: ["https://marioserafim.com.br/blog/artigo"] }],
      });
    if (dim === "query")
      return Response.json({
        rows: [
          { ...row, keys: ["design brasileiro"] },
          { ...row, keys: ["name@example.test"] },
        ],
      });
    if (dim === "date")
      return Response.json({ rows: [{ ...row, keys: [body.startDate] }] });
    return Response.json({
      rows: [{ ...row, clicks: 50, ctr: 0.1, position: 7 }],
    });
  };
  const authorized = await app.request(
    callback,
    { headers: { Cookie: started.cookie.split(";")[0] } },
    env,
  );
  assert.equal(authorized.status, 303);
  assert.match(
    authorized.headers.get("Location")!,
    /\/analytics#pesquisa-organica$/,
  );
  assert.match(authorized.headers.get("Set-Cookie")!, /Max-Age=0/);
  assert.equal(
    (
      await app.request(
        callback,
        { headers: { Cookie: started.cookie.split(";")[0] } },
        env,
      )
    ).status,
    400,
  );
  const cipher = await env.DB.prepare(
    "SELECT token_cipher FROM search_console_connection",
  ).first<string>("token_cipher");
  assert.ok(cipher && !cipher.includes("gsc-private-test-token"));
  assert.equal((await searchOverview(env, 28)).status, "pending");
  assert.equal(googleCalls, 2);
  await Promise.all([
    searchOverview(env, 28, true),
    searchOverview(env, 28, true),
  ]);
  const result = await searchOverview(env, 28);
  assert.equal(result.status, "available");
  assert.equal(result.property, property);
  assert.equal(result.data?.total?.ctr, 0.1);
  assert.equal(result.data?.daily.length, 1);
  assert.equal(result.data?.queries.length, 1);
  assert.deepEqual(result.data?.opportunities[0].ga4, {
    sessions: 17,
    engagementRate: 0.6,
  });
  assert.equal(googleCalls, 10);
  await searchOverview(env, 28, true);
  assert.equal(googleCalls, 10);
  const scope = await dialogueScope(
    new Request("http://localhost", {
      headers: { Authorization: "Bearer " + env.DEV_TOKEN },
    }),
  );
  assert.ok(scope);
  const { conversation } = await loadDialogue(env, scope);
  const reply = await advanceDialogue(env, scope, {
    text: "Como está a pesquisa orgânica nos últimos 28 dias?",
    area: "analytics",
    conversationId: conversation.id,
    revision: conversation.revision,
  });
  assert.match(reply.text, /50 cliques, 500 impressões/);
  assert.equal(googleCalls, 10);
  quota = true;
  assert.equal((await searchOverview(env, 90, true)).error, "gsc_quota");
  const afterQuota = googleCalls;
  assert.equal((await searchOverview(env, 7, true)).error, "gsc_quota");
  assert.equal(googleCalls, afterQuota);
  await env.DB.prepare(
    "UPDATE analytics_cache SET next_at=0 WHERE id='gsc-90'",
  ).run();
  revoked = true;
  assert.equal((await searchOverview(env, 7, true)).status, "reauthorize");
  const stale = await searchOverview(env, 28);
  assert.equal(stale.status, "reauthorize");
  assert.equal(stale.stale, true);
  assert.equal(stale.data?.total?.clicks, 50);
});
