import { migrationStatements } from "./migration-statements";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { cycleKey, nextCycle } from "../src/schedule";
import {
  ingestSource,
  processCandidate,
  scheduledIngest,
} from "../src/ingestion";
import { collect, parseRss } from "../src/connectors";
import { first, stmt, id } from "../src/db";
import { radarStatus } from "../src/radar";
import { app } from "../src/index";
import { matchedTopics } from "../src/quality";
import { rank } from "../src/ranking";
import { defaultPolicy } from "../packages/contracts/index";
import { contentFixture } from "./fixtures";
import { fixtureSource, fixtureCandidate, academic, atom } from "./fixtures";
import type { Env } from "../src/env";
let mf: Miniflare, env: Env;
const at = Date.parse("2026-10-21T10:00:00Z");
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
    DEV_TOKEN: "test-radar-fixture-not-a-secret-123456",
    ALLOWED_FETCH_HOSTS: "fixtures.example.test,api.openalex.org",
  };
  for (const f of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      await readFile(`migrations/${f}`, "utf8"),
    ))
      await env.DB.prepare(sql).run();
});
after(async () => {
  await mf.dispose();
});
test("ranking mantém repertório antigo e diversidade com 2,12,24,100 itens", () => {
  for (const n of [2, 12, 24, 100]) {
    const items = Array.from({ length: n }, (_, i) =>
      contentFixture({
        id: `test-${String(i).padStart(3, "0")}`,
        sourceId: `source-${i % 8}`,
        topics: [["branding", "typography", "visual", "design"][i % 4]],
        publishedAt: i % 2 ? "2018-01-01" : "2026-10-01",
        evergreen: i % 2 === 1,
      }),
    );
    const ranked = rank(
      items,
      { interests: [], languages: [] },
      defaultPolicy,
      at,
    );
    assert.equal(ranked.length, n);
    assert.ok(ranked.some((r) => r.content.publishedAt === "2018-01-01"));
    if (n >= 12)
      assert.ok(
        new Set(ranked.slice(0, 12).map((r) => r.content.sourceId)).size >= 4,
      );
  }
});
test("migração aditiva preserva acervo, favoritos e decisões existentes", async () => {
  const isolated = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
    }),
  );
  try {
    const db = (await isolated.getD1Database("DB")) as unknown as D1Database;
    const apply = async (f: string) => {
      for (const sql of migrationStatements(
        await readFile(`migrations/${f}`, "utf8"),
      ))
        await db.prepare(sql).run();
    };
    for (const f of (await readdir("migrations"))
      .filter((f) => f.endsWith(".sql") && !f.startsWith("0004"))
      .sort())
      await apply(f);
    await db
      .prepare(
        `INSERT INTO sources(id,name,connector,url,status,config_json,created_at) VALUES ('test-source','TEST','rss','https://fixtures.example.test/migration','approved','{}','2026-01-01')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO contents(id,source_id,canonical_url,title,metadata_json,collected_at,kind,editorial_status,quality_score,quality_json) VALUES ('test-content','test-source','https://fixtures.example.test/old','TEST','{}','2026-01-01','article','approved',80,'{}')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO favorites VALUES ('owner','test-content','2026-01-01')`,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO editorial_decisions(id,content_id,decision,reason,created_at) VALUES ('test-decision','test-content','approved','TEST review','2026-01-01')`,
      )
      .run();
    await apply("0004_radar_cycles.sql");
    assert.equal(
      (await first<any>(db, "SELECT COUNT(*) n FROM favorites")).n,
      1,
    );
    assert.equal(
      (await first<any>(db, "SELECT COUNT(*) n FROM editorial_decisions")).n,
      1,
    );
    assert.equal(
      (await first<any>(db, "SELECT editorial_status FROM contents"))
        .editorial_status,
      "approved",
    );
    assert.equal(
      (await first<any>(db, "SELECT last_cycle_key FROM sources"))
        .last_cycle_key,
      null,
    );
  } finally {
    await isolated.dispose();
  }
});
async function source(connector: "rss" | "openalex" = "rss") {
  const s = {
    ...fixtureSource,
    id: id(),
    connector,
    autoApprove: false,
    url:
      connector === "rss"
        ? `https://fixtures.example.test/${id()}`
        : `https://api.openalex.org/works?search=${id()}`,
  };
  await stmt(
    env.DB,
    "INSERT INTO sources(id,name,connector,url,status,config_json,created_at) VALUES (?,?,?,?,?,?,?)",
    s.id,
    s.name,
    s.connector,
    s.url,
    s.status,
    JSON.stringify(s),
    new Date(at).toISOString(),
  ).run();
  return s;
}
const xml = (n: number) =>
  `<rss><channel><language>en</language>${Array.from({ length: n }, (_, i) => `<item><title>TEST design ${i}</title><link>https://fixtures.example.test/${id()}</link><author>TEST</author><pubDate>2026-10-01</pubDate></item>`).join("")}</channel></rss>`;
test("calendário UTC: rodadas científicas bimestrais e virada de ano", () => {
  for (const [from, to] of [
    ["2025-02-28", "2025-03-01"],
    ["2024-02-29", "2024-03-01"],
    ["2026-04-30", "2026-05-01"],
    ["2026-10-31", "2026-11-01"],
    ["2026-12-31", "2027-01-01"],
  ])
    assert.equal(
      nextCycle(
        { ...fixtureSource, connector: "openalex" },
        Date.parse(from + "T23:59:59Z"),
      ),
      to + "T00:00:00.000Z",
    );
  assert.equal(
    cycleKey(
      { connector: "openalex" },
      Date.parse("2026-10-31T22:00:00-03:00"),
    ),
    "2026-11",
  );
  assert.equal(
    cycleKey({ connector: "openalex" }, Date.parse("2026-10-23T00:00:00Z")),
    "2026-09",
  );
  assert.equal(
    nextCycle(
      { ...fixtureSource, connector: "openalex" },
      Date.parse("2026-09-01T00:00:00Z"),
    ),
    "2026-11-01T00:00:00.000Z",
  );
  assert.equal(nextCycle(fixtureSource, at), "2026-10-22T10:00:00.000Z");
});
test("diário, 304, intervalo mínimo e próximo dia", async () => {
  const s = await source();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response(null, { status: 304 });
  };
  assert.equal(
    (await ingestSource(env, s.id, fetcher, at)).status,
    "not_modified",
  );
  await assert.rejects(
    () => ingestSource(env, s.id, fetcher, at + 3600000),
    /intervalo/,
  );
  await ingestSource(env, s.id, fetcher, at + 86400000);
  assert.equal(calls, 2);
});
test("bimestral: fila continua sem segunda descoberta; bimestre seguinte abre rodada", async () => {
  const s = await source("openalex");
  let calls = 0;
  const payload = {
    results: Array.from({ length: 5 }, (_, i) => ({
      ...academic.results[0],
      id: `https://openalex.org/W${900000000 + i}`,
      doi: `https://doi.org/10.9999/month-${i}`,
      primary_location: {
        ...academic.results[0].primary_location,
        landing_page_url: `https://fixtures.example.test/month-${i}`,
      },
    })),
  };
  const fetcher = async () => {
    calls++;
    return Response.json(payload);
  };
  assert.equal((await ingestSource(env, s.id, fetcher, at)).queuedRemaining, 3);
  assert.equal(
    (await ingestSource(env, s.id, fetcher, at + 900000)).queuedRemaining,
    1,
  );
  assert.equal(
    (await ingestSource(env, s.id, fetcher, at + 1800000)).accepted,
    0,
  );
  await assert.rejects(
    () => ingestSource(env, s.id, fetcher, at + 86400000),
    /intervalo/,
  );
  assert.equal(calls, 1);
  await ingestSource(env, s.id, fetcher, Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(calls, 2);
});
test("aprovação automática registra decisão e reavalia pendente sem tocar aprovados", async () => {
  const s = await source();
  const runId = id();
  await stmt(
    env.DB,
    "INSERT INTO ingestion_runs(id,source_id,started_at,status) VALUES (?,?,?,'running')",
    runId,
    s.id,
    new Date(at).toISOString(),
  ).run();
  const item = {
    ...fixtureCandidate,
    url: `https://fixtures.example.test/${id()}`,
    title: `TEST design ${id()}`,
    identifiers: [],
    language: "en",
    description: null,
  };
  const firstPass = await processCandidate(env.DB, item, s, runId, at);
  assert.equal(firstPass.outcome, "pending");
  const enabled = { ...s, autoApprove: true, languages: ["en"] };
  await stmt(
    env.DB,
    "UPDATE sources SET config_json=? WHERE id=?",
    JSON.stringify(enabled),
    s.id,
  ).run();
  const secondPass = await processCandidate(env.DB, item, enabled, runId, at);
  assert.equal(secondPass.outcome, "approved");
  assert.equal(secondPass.contentId, firstPass.contentId);
  assert.equal(
    (
      await first<any>(
        env.DB,
        "SELECT editorial_status FROM contents WHERE id=?",
        firstPass.contentId,
      )
    ).editorial_status,
    "approved",
  );
  assert.equal(
    (
      await first<any>(
        env.DB,
        "SELECT COUNT(*) n FROM editorial_decisions WHERE content_id=? AND decision='approved'",
        firstPass.contentId,
      )
    ).n,
    1,
  );
  const collision = await processCandidate(
    env.DB,
    { ...item, url: `https://fixtures.example.test/${id()}` },
    enabled,
    runId,
    at,
  );
  assert.equal(collision.outcome, "pending");
  assert.ok(
    (
      await first<any>(
        env.DB,
        "SELECT reasons_json FROM ingestion_candidates WHERE id=?",
        collision.candidateId,
      )
    ).reasons_json.includes("possible_title_duplicate"),
  );
});
test("cron processa dois itens aprováveis abaixo do limite de 50 consultas D1", async () => {
  const s = await source();
  const enabled = { ...s, autoApprove: true, languages: ["en"] };
  await stmt(
    env.DB,
    "UPDATE sources SET config_json=? WHERE id=?",
    JSON.stringify(enabled),
    s.id,
  ).run();
  let queries = 0;
  const wrap = (prepared: any): any =>
    new Proxy(prepared, {
      get(target, key) {
        if (key === "bind")
          return (...args: unknown[]) => wrap(target.bind(...args));
        if (["run", "all", "first", "raw"].includes(String(key)))
          return (...args: unknown[]) => {
            queries++;
            return target[key](...args);
          };
        return typeof target[key] === "function"
          ? target[key].bind(target)
          : target[key];
      },
    });
  const tracked = new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (key === "batch")
        return (statements: D1PreparedStatement[]) => {
          queries += statements.length;
          return target.batch(statements);
        };
      return typeof (target as any)[key] === "function"
        ? (target as any)[key].bind(target)
        : (target as any)[key];
    },
  });
  const result = await ingestSource(
    { ...env, DB: tracked },
    s.id,
    async () => new Response(xml(2)),
    at,
  );
  assert.equal(result.accepted, 2);
  console.log(`Cron: ${queries} consultas na ingestão + 3 no agendamento`);
  assert.ok(queries + 3 <= 50, `Cron usaria ${queries + 3} consultas D1`);
});
test("403 e 429 preservam Retry-After, backoff e observabilidade", async () => {
  for (const code of [403, 429]) {
    const s = await source();
    let calls = 0;
    const real = Date.now();
    const fetcher = async () => {
      calls++;
      return new Response("", {
        status: code,
        headers: { "Retry-After": "7200" },
      });
    };
    const r = await ingestSource(env, s.id, fetcher, real);
    assert.equal(r.error, `upstream_${code}`);
    await assert.rejects(
      () => ingestSource(env, s.id, fetcher, real + 60000),
      /intervalo/,
    );
    const row = await first<any>(
      env.DB,
      "SELECT * FROM sources WHERE id=?",
      s.id,
    );
    assert.equal(row.last_cycle_key, null);
    assert.equal(row.consecutive_failures, 1);
    if (code === 429) assert.ok(Date.parse(row.retry_at) >= real + 7200000);
    assert.equal(calls, 1);
    const status = await radarStatus(env);
    assert.equal(status.sources.find((v) => v.id === s.id)?.state, "failed");
  }
});
test("concorrência e recuperação de lease expirado mantêm fila", async () => {
  const s = await source();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 25));
    return new Response(xml(5));
  };
  const result = await Promise.allSettled([
    ingestSource(env, s.id, fetcher, at),
    ingestSource(env, s.id, fetcher, at),
  ]);
  assert.equal(result.filter((v) => v.status === "fulfilled").length, 1);
  assert.equal(calls, 1);
  await stmt(
    env.DB,
    "INSERT INTO ingestion_runs(id,source_id,started_at,status) VALUES (?,?,?,'running')",
    id(),
    s.id,
    new Date(at).toISOString(),
  ).run();
  await stmt(
    env.DB,
    "UPDATE sources SET lease_until=?,lease_token=? WHERE id=?",
    new Date(at + 300000).toISOString(),
    "expired-test",
    s.id,
  ).run();
  const resumed = await ingestSource(
    env,
    s.id,
    async () => {
      throw Error("must not fetch");
    },
    at + 900000,
  );
  assert.equal(resumed.queuedRemaining, 1);
  assert.ok(
    await first(
      env.DB,
      "SELECT id FROM ingestion_runs WHERE source_id=? AND error='interrupted_run'",
      s.id,
    ),
  );
});
test("justiça entre fontes e coleta desativada", async () => {
  await stmt(env.DB, "UPDATE sources SET status='paused'").run();
  const a = await source(),
    b = await source();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response(xml(5));
  };
  await scheduledIngest({ ...env, INGEST_ENABLED: "false" }, fetcher, at);
  assert.equal(calls, 0);
  await scheduledIngest({ ...env, INGEST_ENABLED: "true" }, fetcher, at);
  await scheduledIngest(
    { ...env, INGEST_ENABLED: "true" },
    fetcher,
    at + 900000,
  );
  assert.equal(calls, 2);
  for (const s of [a, b])
    assert.equal(
      (
        await first<any>(
          env.DB,
          "SELECT COUNT(*) n FROM ingestion_queue WHERE source_id=?",
          s.id,
        )
      ).n,
      3,
    );
});
test("interrupção após salvar conteúdo mantém fila e retoma sem duplicar", async () => {
  const s = await source();
  let calls = 0,
    failed = false;
  const db = new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          const wrap = (p: any): any =>
            new Proxy(p, {
              get(obj, k) {
                if (k === "bind")
                  return (...args: unknown[]) => wrap(obj.bind(...args));
                if (
                  k === "run" &&
                  sql.startsWith("INSERT INTO ingestion_candidates")
                )
                  return async () => {
                    if (!failed) {
                      failed = true;
                      throw Error("simulated interruption");
                    }
                    return obj.run();
                  };
                return typeof obj[k] === "function" ? obj[k].bind(obj) : obj[k];
              },
            });
          return wrap(target.prepare(sql));
        };
      const value = (target as any)[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const payload = xml(2);
  const fetcher = async () => {
    calls++;
    return new Response(payload);
  };
  const broken = await ingestSource({ ...env, DB: db }, s.id, fetcher, at);
  assert.equal(broken.status, "failed");
  assert.equal(broken.queuedRemaining, 2);
  const resumed = await ingestSource(env, s.id, fetcher, at + 900000);
  assert.equal(resumed.duplicates, 1);
  assert.equal(resumed.queuedRemaining, 0);
  assert.equal(calls, 1);
  assert.equal(
    (
      await first<any>(
        env.DB,
        "SELECT COUNT(*) n FROM contents WHERE source_id=?",
        s.id,
      )
    ).n,
    2,
  );
});
test("relevância por palavras e sinônimos; atualização Atom não é publicação", () => {
  const s = { ...fixtureSource, topics: ["type", "brand", "typography"] };
  assert.deepEqual(
    matchedTopics(
      {
        ...fixtureCandidate,
        title: "TEST stereotype brandishing",
        topics: [],
        description: "design type",
      },
      s,
    ),
    [],
  );
  assert.ok(
    matchedTopics(
      { ...fixtureCandidate, title: "TEST new typefaces", topics: [] },
      s,
    ).includes("typography"),
  );
  assert.equal(
    parseRss(atom.replaceAll("published", "updated"), fixtureSource)[0]
      .publishedAt,
    null,
  );
});
test("estado exige autenticação e datas válidas; nenhuma contagem de visita inventada", async () => {
  assert.equal(
    (await app.fetch(new Request("http://localhost/api/radar/status"), env))
      .status,
    401,
  );
  const headers = { Authorization: `Bearer ${env.DEV_TOKEN}` };
  assert.equal(
    (
      await app.fetch(
        new Request("http://localhost/api/radar/status?since=invalid", {
          headers,
        }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await app.fetch(
        new Request("http://localhost/api/radar/status", { headers }),
        env,
      )
    ).status,
    200,
  );
  const status = await radarStatus(env);
  assert.equal(status.newApprovals, null);
  assert.equal(status.ingestEnabled, false);
  assert.ok(status.sources.every((s) => s.nextDiscoveryAt === null));
});
