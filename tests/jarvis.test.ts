import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { migrationStatements } from "./migration-statements";
import { app } from "../src/index";
import {
  interpretQuestion,
  resolvePeriod,
  normalizeQuestion,
} from "../packages/contracts/jarvis-intents";
import {
  answerJarvis,
  jarvisState,
  markNotice,
  saveJarvisPreferences,
  resolveAction,
  invalidateJarvis,
} from "../src/jarvis";
import type { Env } from "../src/env";
let mf: Miniflare, env: Env;
const realFetch = globalThis.fetch;
const clock = Date.parse("2026-11-04T01:00:00Z");
test("Portuguese synonyms, entities, accents, ambiguity and periods", () => {
  assert.equal(normalizeQuestion("  ORÇAMENTOS, NOVOS?  "), "orcamentos novos");
  const cases = [
    ["Quais oportunidades estão atrasadas?", "opportunities.overdue"],
    ["Novos pedidos de orçamento hoje", "opportunities.new"],
    ["Quais os artigos mais acessados?", "articles.top"],
    ["Rascunhos parados no Studio", "drafts.pending"],
    ["Artigos sem newsletter", "articles.without_newsletter"],
    ["Desempenho das campanhas", "newsletters.performance"],
    ["Resumo semanal do ecossistema", "ecosystem.weekly"],
    ["Falhas nas integrações", "integrations.failures"],
    ["Referências sem uso", "research.unused"],
    ["Preparar briefing", "editorial.prepare"],
  ];
  for (const [q, intent] of cases)
    assert.equal(interpretQuestion(q, "for-you").intent, intent, q);
  assert.equal(
    interpretQuestion("oportunidades", "oportunidades").intent,
    null,
  );
  assert.equal(
    interpretQuestion("novos pedidos atrasados", "oportunidades").intent,
    null,
  );
  assert.equal(
    interpretQuestion("Artigos mais acessados ontem", "analytics").intent,
    null,
  );
  assert.equal(resolvePeriod("hoje", clock).from, "2026-11-03T03:00:00.000Z");
  assert.equal(resolvePeriod("semana", clock).from, "2026-11-02T03:00:00.000Z");
  assert.equal(
    resolvePeriod("últimos 7 dias", clock).to,
    "2026-11-03T03:00:00.000Z",
  );
  assert.equal(resolvePeriod("30 dias", clock).days, 30);
});
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
    DEV_TOKEN: "jarvis-local-synthetic-token-".repeat(3),
  };
  for (const f of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
    ))
      await env.DB.prepare(sql).run();
});
after(async () => {
  globalThis.fetch = realFetch;
  await mf.dispose();
});
beforeEach(async () => {
  globalThis.fetch = async () => {
    throw Error("External calls forbidden");
  };
  for (const table of [
    "opportunities",
    "jarvis_memory",
    "jarvis_preferences",
    "jarvis_budgets",
    "analytics_cache",
    "integration_tasks",
    "integration_studio_drafts",
    "integration_articles",
  ])
    await env.DB.prepare("DELETE FROM " + table).run();
  await env.DB.prepare(
    "UPDATE integration_control SET last_success=NULL,error=NULL WHERE id='catalogue'",
  ).run();
  invalidateJarvis(env);
});
async function opportunity(
  status = "novo",
  next: string | null = null,
  id = crypto.randomUUID(),
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO opportunities(id,name,email,project_type,description,received_at,source,status,next_contact,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      "NOME PRIVADO",
      "private@example.invalid",
      "Branding",
      "Briefing confidencial nunca enviado ao modelo",
      now,
      "portfolio",
      status,
      next,
      now,
    )
    .run();
  return id;
}
const headers = {
  Authorization: "Bearer " + "jarvis-local-synthetic-token-".repeat(3),
  "Content-Type": "application/json",
};
test("private endpoints reject anonymous, invalid input, oversized and forbidden actions", async () => {
  assert.equal(
    (await app.request("http://localhost/api/jarvis/state", {}, env)).status,
    401,
  );
  for (const body of [
    { text: "x", sql: "DROP TABLE opportunities" },
    { text: "x".repeat(501) },
    { text: "x", choice: "delete" },
  ])
    assert.equal(
      (
        await app.request(
          "http://localhost/api/jarvis/query",
          { method: "POST", headers, body: JSON.stringify(body) },
          env,
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await app.request(
        "http://localhost/api/jarvis/query",
        { method: "POST", headers, body: "x".repeat(5000) },
        env,
      )
    ).status,
    413,
  );
  for (const kind of [
    "publish",
    "email.send",
    "opportunity.delete",
    "historical.approve",
  ])
    await assert.rejects(() => resolveAction(env, { kind }));
  await assert.rejects(() =>
    resolveAction(env, {
      kind: "studio.continue",
      target: "https://evil.invalid",
    }),
  );
});
test("answers use real records, bound periods and no PII; AI remains locked even when requested", async () => {
  await opportunity();
  await opportunity(
    "em_conversa",
    new Date(Date.now() - 86400000).toISOString(),
  );
  const response = await answerJarvis(env, {
    text: "Novos orçamentos hoje",
    area: "oportunidades",
    allowAI: true,
  });
  assert.match(response.text, /1 pedidos/);
  assert.equal(response.ai.enabled, false);
  assert.ok(response.syncedAt);
  assert.equal(response.stale, false);
  assert.ok(!JSON.stringify(response).includes("private@"));
  assert.ok(!JSON.stringify(response).includes("NOME PRIVADO"));
  const overdue = await answerJarvis(env, {
    text: "oportunidades atrasadas",
    area: "oportunidades",
  });
  assert.match(overdue.text, /1 oportunidades/);
  const prefs = await env.DB.prepare(
    "SELECT body_json FROM jarvis_preferences",
  ).first<{ body_json: string }>();
  assert.equal(JSON.parse(prefs!.body_json).area, "oportunidades");
  assert.ok(!prefs!.body_json.includes("orçamentos"));
});
test("ambiguity and missing/stale data are explicit, never fabricated zero", async () => {
  const unclear = await answerJarvis(env, {
    text: "oportunidades",
    area: "oportunidades",
  });
  assert.ok(unclear.choices?.length);
  const empty = await answerJarvis(env, {
    text: "artigos mais acessados",
    area: "analytics",
  });
  assert.equal(empty.syncedAt, null);
  assert.equal(empty.incomplete, true);
  assert.match(empty.text, /indisponível/);
  const draft = await answerJarvis(env, {
    text: "rascunhos pendentes",
    area: "publicacoes",
  });
  assert.match(draft.text, /indisponível/);
  await env.DB.prepare(
    "INSERT INTO analytics_cache(id,body_json,fetched_at) VALUES (?,?,?)",
  )
    .bind(
      "analytics-v2-7",
      JSON.stringify({
        reports: [
          {
            dimension: "pagePath",
            rows: [
              { pagePath: "/blog/teste", screenPageViews: 10, sessions: 3 },
            ],
            limited: false,
            privacyFiltered: false,
          },
        ],
      }),
      Date.now() - 86400000,
    )
    .run();
  const stale = await answerJarvis(env, {
    text: "artigos mais acessados hoje",
    area: "analytics",
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.incomplete, true);
  assert.match(stale.period.label, /7 dias/);
});
test("ranked alerts have stable IDs, no PII and durable dismiss/snooze with two-per-day atomic claims", async () => {
  await opportunity();
  await opportunity(
    "em_conversa",
    new Date(Date.now() - 86400000).toISOString(),
  );
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO integration_tasks(id,kind,source_id,version,state,error,created_at,updated_at) VALUES ('broken','article','test','v1','error','service_unavailable',?,?)",
  )
    .bind(now, now)
    .run();
  const s = await jarvisState(env);
  assert.deepEqual(
    s.notices.map((n) => n.priority),
    [100, 95, 90],
  );
  assert.ok(!JSON.stringify(s).includes("private@"));
  assert.deepEqual(
    (await jarvisState(env)).notices.map((n) => n.id),
    s.notices.map((n) => n.id),
  );
  const claims = await Promise.all([
    markNotice(env, s.notices[0].id, "shown"),
    markNotice(env, s.notices[0].id, "shown"),
  ]);
  assert.equal(claims.filter((c) => c.allowed).length, 1);
  await markNotice(env, s.notices[0].id, "dismiss");
  invalidateJarvis(env);
  assert.ok(
    !(await jarvisState(env)).notices.some((n) => n.id === s.notices[0].id),
  );
  await markNotice(env, s.notices[1].id, "snooze");
  assert.ok(
    !(await jarvisState(env)).notices.some((n) => n.id === s.notices[1].id),
  );
  await env.DB.prepare("UPDATE jarvis_budgets SET count=2,last_shown=0").run();
  assert.equal(
    (await markNotice(env, s.notices[2].id, "shown")).allowed,
    false,
  );
});
test("preferences, action audit, retention and snapshot dedup survive module cache invalidation", async () => {
  await saveJarvisPreferences(env, {
    enabled: true,
    proactive: false,
    communication: "formal",
    area: "analytics",
  });
  invalidateJarvis(env);
  assert.equal((await jarvisState(env)).preferences.proactive, false);
  const id = await opportunity();
  invalidateJarvis(env);
  const result = await resolveAction(env, {
    kind: "opportunity.open",
    target: id,
  });
  assert.equal(result.navigation, "opportunities");
  await env.DB.prepare(
    "INSERT INTO jarvis_memory VALUES ('expired','action','analytics.open',0,0,0)",
  ).run();
  await jarvisState(env);
  assert.equal(
    await env.DB.prepare(
      "SELECT id FROM jarvis_memory WHERE id='expired'",
    ).first(),
    null,
  );
  assert.equal(
    (await env.DB.prepare(
      "SELECT count(*) n FROM jarvis_memory WHERE kind='action'",
    ).first<{ n: number }>())!.n,
    1,
  );
});
test("insufficient audience volume does not trigger a trend balloon", async () => {
  const daily = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 9, 1 + i))
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", ""),
    sessions: i < 7 ? 1 : 10,
  }));
  await env.DB.prepare(
    "INSERT INTO analytics_cache(id,body_json,fetched_at) VALUES (?,?,?)",
  )
    .bind(
      "analytics-v2-30",
      JSON.stringify({ reports: [{ dimension: "date", rows: daily }] }),
      Date.now(),
    )
    .run();
  assert.ok(!(await jarvisState(env)).notices.some((n) => n.priority === 45));
});

test("audience alerts require complete comparable days and sufficient samples", async () => {
  const end = Date.parse(resolvePeriod("hoje").from!) - 86400000;
  const daily = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(end - (13 - i) * 86400000)
      .toISOString()
      .slice(0, 10)
      .replaceAll("-", ""),
    sessions: i < 7 ? 100 : 200,
    activeUsers: 60,
  }));
  await env.DB.prepare(
    "INSERT INTO analytics_cache(id,body_json,fetched_at) VALUES (?,?,?)",
  )
    .bind(
      "analytics-v2-30",
      JSON.stringify({ reports: [{ dimension: "date", rows: daily }] }),
      Date.now(),
    )
    .run();
  assert.equal(
    (await jarvisState(env)).notices.find((n) => n.priority === 45)?.text,
    "As sessões variaram 100% entre duas janelas completas de sete dias.",
  );
  daily.splice(4, 1);
  await env.DB.prepare("UPDATE analytics_cache SET body_json=?")
    .bind(JSON.stringify({ reports: [{ dimension: "date", rows: daily }] }))
    .run();
  invalidateJarvis(env);
  assert.ok(!(await jarvisState(env)).notices.some((n) => n.priority === 45));
});
test("dismissal survives rereads; materially changed status/date generates another event", async () => {
  const id = await opportunity();
  const first = (await jarvisState(env)).notices[0];
  await markNotice(env, first.id, "dismiss");
  invalidateJarvis(env);
  assert.equal((await jarvisState(env)).notices.length, 0);
  await env.DB.prepare(
    "UPDATE opportunities SET status='em_conversa',next_contact=?,updated_at=? WHERE id=?",
  )
    .bind(
      new Date(Date.now() - 10000).toISOString(),
      new Date().toISOString(),
      id,
    )
    .run();
  invalidateJarvis(env);
  const next = (await jarvisState(env)).notices[0];
  assert.notEqual(first.id, next.id);
  assert.equal(next.priority, 95);
});

test("empty Studio catalogue never offers a continuation action without a target", async () => {
  await env.DB.prepare(
    "UPDATE integration_control SET last_success=? WHERE id='catalogue'",
  )
    .bind(new Date().toISOString())
    .run();
  invalidateJarvis(env);
  const answer = await answerJarvis(env, {
    text: "Rascunhos pendentes",
    area: "publicacoes",
  });
  assert.match(answer.text, /0 rascunhos/);
  assert.equal(answer.action, undefined);
});
