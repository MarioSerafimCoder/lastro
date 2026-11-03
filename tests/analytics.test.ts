import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { migrationStatements } from "./migration-statements";
import {
  analyticsOverview,
  beginAnalyticsOAuth,
  finishAnalyticsOAuth,
  runAnalyticsReports,
  ANALYTICS_SCOPE,
  ANALYTICS_CALLBACK,
} from "../src/analytics";
import { app } from "../src/index";
import type { Env } from "../src/env";
let mf: Miniflare, env: Env;
const realFetch = globalThis.fetch;
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
    }),
  );
  env = {
    DB: (await mf.getD1Database("DB")) as unknown as D1Database,
    ENVIRONMENT: "development",
    DEV_TOKEN: "test-token-".repeat(5),
    ALLOWED_ORIGIN: "https://lastro.marioserafim.com.br",
    ANALYTICS_ENABLED: "true",
    GA4_PROPERTY_ID: "560757639",
    GOOGLE_OAUTH_CLIENT_ID: "client",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret-never-return",
    GA4_REFRESH_TOKEN: "refresh-never-return",
  };
  for (const file of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"),
    ))
      await env.DB.prepare(sql).run();
});
after(async () => mf.dispose());
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM analytics_cache").run();
  await env.DB.prepare("DELETE FROM analytics_oauth_states").run();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
const response = (dim: string, empty = false) =>
  Response.json({
    dimensionHeaders: dim === "total" ? [] : [{ name: dim }],
    metricHeaders: [
      "activeUsers",
      "sessions",
      "screenPageViews",
      "engagementRate",
      "userEngagementDuration",
    ].map((name) => ({ name })),
    rows: empty
      ? []
      : [
          {
            dimensionValues:
              dim === "total"
                ? []
                : [
                    {
                      value:
                        dim === "date"
                          ? "20261101"
                          : dim === "pagePath"
                            ? "/blog/artigo"
                            : "newsletter / email",
                    },
                  ],
            metricValues: [
              { value: "2" },
              { value: "3" },
              { value: "4" },
              { value: "0.5" },
              { value: "120" },
            ],
          },
        ],
    rowCount: empty ? 0 : 1,
  });
test("OAuth requires owner authentication and exact origin", async () => {
  assert.equal(
    (
      await app.request(
        "https://lastro.marioserafim.com.br/api/analytics/oauth/start",
        { method: "POST" },
        {
          ...env,
          ENVIRONMENT: "production",
          OWNER_PASSWORD_SHA256: "0".repeat(64),
          SESSION_SIGNING_KEY: "a".repeat(43),
        },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await app.request(
        "https://lastro.marioserafim.com.br/api/analytics/overview",
        {},
        {
          ...env,
          ENVIRONMENT: "production",
          OWNER_PASSWORD_SHA256: "0".repeat(64),
          SESSION_SIGNING_KEY: "a".repeat(43),
        },
      )
    ).status,
    401,
  );
  await assert.rejects(
    () =>
      beginAnalyticsOAuth(
        env,
        new Request(env.ALLOWED_ORIGIN + "/api/analytics/oauth/start", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        }),
      ),
    { code: "origin_forbidden" },
  );
});
test("OAuth uses readonly, PKCE, nonce, expiration and single use callback", async () => {
  const result = await beginAnalyticsOAuth(
    env,
    new Request(env.ALLOWED_ORIGIN + "/api/analytics/oauth/start", {
      headers: { Origin: env.ALLOWED_ORIGIN! },
    }),
  );
  const url = new URL(result.url);
  assert.equal(url.searchParams.get("scope"), ANALYTICS_SCOPE);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const callback =
    env.ALLOWED_ORIGIN +
    ANALYTICS_CALLBACK +
    "?state=" +
    url.searchParams.get("state") +
    "&code=one-time-code";
  await assert.rejects(() => finishAnalyticsOAuth(env, new Request(callback)), {
    code: "oauth_state_invalid",
  });
  const req = new Request(callback, {
    headers: { Cookie: result.cookie.split(";")[0] },
  });
  const finished = await finishAnalyticsOAuth(env, req);
  const body = (await finished.json()) as any;
  assert.equal(body.code, "one-time-code");
  assert.equal(body.verifier.length, 43);
  assert.ok(!JSON.stringify(body).includes("refresh"));
  await assert.rejects(() => finishAnalyticsOAuth(env, req), {
    code: "oauth_state_invalid",
  });
  const expired = await beginAnalyticsOAuth(
    env,
    new Request(env.ALLOWED_ORIGIN!, {
      headers: { Origin: env.ALLOWED_ORIGIN! },
    }),
  );
  await env.DB.prepare("UPDATE analytics_oauth_states SET expires_at=0").run();
  await assert.rejects(
    () =>
      finishAnalyticsOAuth(
        env,
        new Request(
          env.ALLOWED_ORIGIN +
            ANALYTICS_CALLBACK +
            "?state=" +
            new URL(expired.url).searchParams.get("state") +
            "&code=x",
          { headers: { Cookie: expired.cookie.split(";")[0] } },
        ),
      ),
    { code: "oauth_state_invalid" },
  );
});
test("reports renew access once, persist aggregates only, cache for twelve hours", async () => {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(
      init?.redirect,
      "manual",
      "workerd supports manual redirect only; never forward credentials",
    );
    calls++;
    if (String(input).includes("oauth2"))
      return Response.json({ access_token: "transient-access" });
    const body = JSON.parse(init!.body as string);
    assert.equal(body.dateRanges[0].endDate, "yesterday");
    return response(body.dimensions[0]?.name ?? "total");
  };
  const a = await analyticsOverview(env);
  assert.equal(a.status, "available");
  assert.equal(calls, 6);
  assert.equal((await analyticsOverview(env)).status, "available");
  assert.equal(calls, 6);
  const stored = JSON.stringify(
    await env.DB.prepare("SELECT * FROM analytics_cache").all(),
  );
  for (const value of [
    "transient-access",
    "secret-never-return",
    "refresh-never-return",
  ])
    assert.ok(!stored.includes(value));
});
for (const status of [401, 403, 429])
  test(
    "sanitized " + status + " and one-hour backoff retains prior snapshot",
    async () => {
      await env.DB.prepare(
        "INSERT INTO analytics_cache(id,body_json,fetched_at) VALUES ('analytics-v2-7','{}',1)",
      ).run();
      let calls = 0;
      globalThis.fetch = async (input) => {
        calls++;
        return String(input).includes("oauth2")
          ? Response.json({ access_token: "transient" })
          : new Response("sensitive upstream message", { status });
      };
      const result = await analyticsOverview(env);
      assert.equal(result.status, "unavailable");
      assert.ok(result.data);
      assert.ok(!JSON.stringify(result).includes("sensitive"));
      const count = calls;
      await analyticsOverview(env);
      assert.equal(calls, count);
      assert.equal(
        result.error,
        status === 401
          ? "analytics_unauthorized"
          : status === 403
            ? "analytics_forbidden"
            : "analytics_quota",
      );
    },
  );
test("revoked refresh credential requires reauthorization; disabled does no fetch", async () => {
  globalThis.fetch = async () => new Response("invalid_grant", { status: 400 });
  assert.equal(
    (await analyticsOverview(env)).error,
    "analytics_reauthorization_required",
  );
  globalThis.fetch = async () => {
    throw Error("must not call");
  };
  await assert.rejects(
    () => analyticsOverview({ ...env, ANALYTICS_ENABLED: "false" }),
    { code: "analytics_disabled" },
  );
});
test("empty response succeeds and private paths are excluded", async () => {
  globalThis.fetch = async (_input, init) => {
    const b = JSON.parse(init!.body as string);
    return response(b.dimensions[0]?.name ?? "total", true);
  };
  assert.ok(
    (await runAnalyticsReports("test")).reports.every(
      (r) => r.rows.length === 0,
    ),
  );
  globalThis.fetch = async (_input, init) => {
    const b = JSON.parse(init!.body as string),
      dim = b.dimensions[0]?.name ?? "total";
    const r = (await response(dim).json()) as any;
    if (dim === "pagePath")
      r.rows[0].dimensionValues[0].value = "/people/private@example.com";
    return Response.json(r);
  };
  assert.equal(
    (await runAnalyticsReports("test")).reports.find(
      (r) => r.dimension === "pagePath",
    )!.rows.length,
    0,
  );
});
test("totals accept omitted dimension headers and empty rows for both periods", async () => {
  for (const days of [7, 30] as const) {
    for (const empty of [false, true]) {
      globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(init!.body as string);
        const dimension = body.dimensions[0]?.name ?? "total";
        const report = (await response(dimension, empty).json()) as any;
        if (dimension === "total") {
          delete report.dimensionHeaders;
          if (empty) delete report.rows;
          else delete report.rows[0].dimensionValues;
        }
        return Response.json(report);
      };
      const data = await runAnalyticsReports("test", "560757639", days);
      const total = data.reports.find(
        (report) => report.dimension === "total",
      )!;
      assert.equal(total.rows.length, empty ? 0 : 1);
      if (!empty) assert.equal(total.rows[0].activeUsers, 2);
    }
  }
});

test("dimensioned reports still require matching dimension headers", async () => {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(init!.body as string);
    const report = (await response(
      body.dimensions[0]?.name ?? "total",
    ).json()) as any;
    delete report.dimensionHeaders;
    return Response.json(report);
  };
  await assert.rejects(() => runAnalyticsReports("test"), {
    code: "analytics_invalid_response",
  });
});

test("7/30-day caches are separate; manual refresh is bounded and concurrent refresh uses lease", async () => {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    if (String(input).includes("oauth2"))
      return Response.json({ access_token: "test" });
    const b = JSON.parse(init!.body as string);
    assert.ok(["7daysAgo", "30daysAgo"].includes(b.dateRanges[0].startDate));
    return response(b.dimensions[0]?.name ?? "total");
  };
  await analyticsOverview(env, 7);
  await analyticsOverview(env, 30);
  assert.equal(calls, 12);
  await analyticsOverview(env, 7, true);
  assert.equal(calls, 12);
  await env.DB.prepare("UPDATE analytics_cache SET fetched_at=? WHERE id=?")
    .bind(Date.now() - 3601000, "analytics-v2-7")
    .run();
  await Promise.all([
    analyticsOverview(env, 7, true),
    analyticsOverview(env, 7, true),
  ]);
  assert.equal(calls, 18);
  await assert.rejects(() => analyticsOverview(env, 14 as any), {
    code: "analytics_range_invalid",
  });
});
test("public privacy/info do not expose private reports or credentials", async () => {
  for (const path of ["info", "privacy"]) {
    const r = await app.request(
      "https://lastro.marioserafim.com.br/api/analytics/" + path,
      {},
      env,
    );
    assert.equal(r.status, 200);
    const body = await r.text();
    assert.ok(!body.includes("secret-never-return"));
  }
});
