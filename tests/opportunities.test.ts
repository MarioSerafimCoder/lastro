import {
  newsletterSummary,
  commercialRecommendations,
} from "../src/newsletters";
import { contextualSuggestion } from "../apps/web/src/experience";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { app } from "../src/index";
import { receiveOpportunity, purgeOpportunities } from "../src/opportunities";
import { runAnalyticsReports } from "../src/analytics";
import type { Env } from "../src/env";
let mf: Miniflare, env: Env;
const origin = "http://localhost";
const input = {
  id: "12345678-1234-4234-8234-123456789012",
  name: "Contato sintético",
  email: "synthetic@example.invalid",
  project_type: "Branding",
  description: "Descrição sintética para teste isolado.",
  received_at: new Date().toISOString(),
  source: "portfolio",
};
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
    PORTFOLIO_INTEGRATION_SECRET: "s".repeat(40),
  };
  for (const sql of (
    await readFile(
      new URL("../migrations/0010_opportunities.sql", import.meta.url),
      "utf8",
    )
  )
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await env.DB.prepare(sql).run();
  await env.DB.exec(
    "CREATE TABLE request_budgets(key TEXT PRIMARY KEY,count INTEGER,expires_at INTEGER);",
  );
});
after(async () => mf.dispose());
async function signed(value: unknown = input, time = String(Date.now())) {
  const raw = JSON.stringify(value);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.PORTFOLIO_INTEGRATION_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(
          time + "\nPOST\n/integration/v1/opportunities\n" + raw,
        ),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  return new Request(origin + "/integration/v1/opportunities", {
    method: "POST",
    headers: { "X-Portfolio-Time": time, "X-Portfolio-Signature": sig },
    body: raw,
  });
}
const owner = {
  Authorization: "Bearer " + "test-token-".repeat(5),
  "Content-Type": "application/json",
};
test("signed input, concurrent duplicate, owner updates, deletion and replay tombstone", async () => {
  await Promise.all([
    receiveOpportunity(await signed(), env),
    receiveOpportunity(await signed(), env),
  ]);
  assert.equal(
    (await env.DB.prepare("SELECT COUNT(*) n FROM opportunities").first<{
      n: number;
    }>())!.n,
    1,
  );
  assert.equal(
    (await app.request(origin + "/api/opportunities", {}, env)).status,
    401,
  );
  const response = await app.request(
    origin + "/api/opportunities/" + input.id,
    {
      method: "PATCH",
      headers: owner,
      body: JSON.stringify({
        status: "em_conversa",
        notes: "Observação privada",
        next_contact: "2026-11-01T00:00:00.000Z",
      }),
    },
    env,
  );
  assert.equal(response.status, 200);
  const saved = await env.DB.prepare(
    "SELECT * FROM opportunities",
  ).first<any>();
  assert.equal(saved.notes, "Observação privada");
  assert.equal(saved.status, "em_conversa");
  assert.equal(
    (
      await app.request(
        origin + "/api/opportunities/" + input.id,
        {
          method: "PATCH",
          headers: owner,
          body: JSON.stringify({
            status: "invalid",
            notes: "",
            next_contact: null,
          }),
        },
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await app.request(
        origin + "/api/opportunities/" + input.id,
        { method: "DELETE", headers: owner },
        env,
      )
    ).status,
    200,
  );
  await receiveOpportunity(await signed(), env);
  assert.equal(
    (await env.DB.prepare("SELECT COUNT(*) n FROM opportunities").first<{
      n: number;
    }>())!.n,
    0,
  );
});
test("rejects expired signature, forged signature and excess personal fields", async () => {
  await assert.rejects(() =>
    receiveOpportunity(
      new Request(origin, { method: "POST", body: "{}" }),
      env,
    ),
  );
  await assert.rejects(async () =>
    receiveOpportunity(await signed(input, String(Date.now() - 600000)), env),
  );
  const forged = await signed();
  forged.headers.set("X-Portfolio-Signature", "0".repeat(64));
  await assert.rejects(() => receiveOpportunity(forged, env));
  await assert.rejects(async () =>
    receiveOpportunity(
      await signed({ ...input, unexpected: "not accepted" }),
      env,
    ),
  );
});
test("newsletter reports filter exact source/medium and retain campaign with pages and dates", async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(
        body.dimensionFilter.andGroup.expressions[0].filter.stringFilter.value,
        "mais_um_cafezinho",
      );
      assert.equal(
        body.dimensionFilter.andGroup.expressions[1].filter.stringFilter.value,
        "email",
      );
      return Response.json({
        dimensionHeaders: body.dimensions,
        metricHeaders: body.metrics,
        rows: [],
        rowCount: 0,
      });
    };
    const data = await runAnalyticsReports("synthetic", "560757639", 7, true);
    assert.equal(data.reports.length, 5);
    assert.ok(data.reports.every((r) => r.rows.length === 0));
  } finally {
    globalThis.fetch = real;
  }
});

test("retention removes expired personal records while keeping recent contacts", async () => {
  const created = { ...input, id: crypto.randomUUID() };
  await receiveOpportunity(await signed(created), env);
  await env.DB.prepare("UPDATE opportunities SET received_at=? WHERE id=?")
    .bind("2000-01-01T00:00:00Z", created.id)
    .run();
  await purgeOpportunities({ ...env, OPPORTUNITIES_RETENTION_DAYS: "30" });
  assert.equal(
    await env.DB.prepare("SELECT id FROM opportunities WHERE id=?")
      .bind(created.id)
      .first(),
    null,
  );
  assert.equal(
    (
      await app.request(
        origin + "/api/opportunities/" + created.id,
        { method: "DELETE" },
        env,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await app.request(
        origin + "/api/opportunities/" + created.id,
        {
          method: "PATCH",
          headers: { ...owner, Origin: "https://external.invalid" },
          body: "{}",
        },
        env,
      )
    ).status,
    403,
  );
});

test("Jarvis recommendations use real counts and navigation only", () => {
  const context = {
    area: "oportunidades" as const,
    selected: 0,
    available: 0,
    saved: 0,
    pending: null,
  };
  const commercial = {
    newCount: 1,
    overdue: 0,
    newsletterVisits: false,
    campaignAvailable: false,
  };
  assert.equal(
    contextualSuggestion({ ...context, commercial }).action,
    "opportunities",
  );
  assert.match(
    contextualSuggestion({
      ...context,
      commercial: { ...commercial, overdue: 2 },
    }).body,
    /2 oportunidades/,
  );
  assert.equal(
    contextualSuggestion({
      ...context,
      commercial: { ...commercial, newCount: 0, newsletterVisits: true },
    }).action,
    "newsletters",
  );
  assert.notEqual(
    contextualSuggestion({
      ...context,
      commercial: { ...commercial, newCount: 0, campaignAvailable: true },
    }).action,
    "newsletters",
  );
});

test("private recommendations read real rows and CRM backoff never represents stale data as current", async () => {
  await env.DB.prepare(
    "CREATE TABLE analytics_cache(id TEXT PRIMARY KEY,body_json TEXT,fetched_at INTEGER DEFAULT 0,next_at INTEGER DEFAULT 0,lease_until INTEGER DEFAULT 0,error TEXT)",
  ).run();
  await receiveOpportunity(
    await signed({ ...input, id: crypto.randomUUID() }),
    env,
  );
  const recommendations = await commercialRecommendations(env);
  assert.equal(recommendations.newCount, 1);
  assert.equal(recommendations.newsletterVisits, false);
  assert.equal(await newsletterSummary(env), null);
  await env.DB.prepare(
    "UPDATE analytics_cache SET body_json=? WHERE id='newsletter-crm-v1'",
  )
    .bind(JSON.stringify({ campaigns: [{ id: "old" }] }))
    .run();
  assert.equal(await newsletterSummary(env), null);
});
