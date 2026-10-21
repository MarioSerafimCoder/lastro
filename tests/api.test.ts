import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { app } from "../src/index";
import { stmt, first, rows, now, id } from "../src/db";
import {
  processCandidate,
  ingestSource,
  duplicate,
  scheduledIngest,
} from "../src/ingestion";
import { normalizeCandidate } from "../src/normalize";
import {
  fixtureSource as fixture,
  fixtureCandidate,
  rss,
  academic,
} from "./fixtures";
import { parseOpenAlex } from "../src/connectors";
import type { Env } from "../src/env";
import type { Source } from "../packages/contracts/index";
let mf: Miniflare, env: Env, source: Source;
const token = "lastro-test-token-not-a-real-secret-123456";
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
    }),
  );
  const db = await mf.getD1Database("DB");
  env = {
    DB: db as unknown as D1Database,
    ENVIRONMENT: "development",
    DEV_TOKEN: token,
    ALLOWED_FETCH_HOSTS: "fixtures.example.test,api.openalex.org",
    ALLOWED_ORIGIN: "http://localhost:5173",
  };
  for (const file of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(
      new URL(`../migrations/${file}`, import.meta.url),
      "utf8",
    );
    for (const command of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await env.DB.prepare(command).run();
  }
});
after(async () => {
  await mf?.dispose();
});
async function req(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env,
  );
}
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  expected = 200,
) {
  const response = await req(path, method, body);
  const data = (await response.json()) as any;
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function runId() {
  const value = id();
  await stmt(
    env.DB,
    "INSERT INTO ingestion_runs (id,source_id,started_at,status) VALUES (?,?,?,?)",
    value,
    source.id,
    now(),
    "running",
  ).run();
  return value;
}
test("autenticação privada, CORS, configuração fechada e validação de entrada", async () => {
  assert.equal(
    (await app.fetch(new Request("http://localhost/api/feed"), env)).status,
    401,
  );
  assert.equal(
    (
      await app.fetch(
        new Request("https://public.example/api/feed", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        env,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await app.fetch(
        new Request("https://public.example/api/feed", {
          headers: {
            "Cf-Access-Authenticated-User-Email": "owner@example.test",
          },
        }),
        { ...env, ENVIRONMENT: "production" },
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await req(
        "/api/preferences",
        "PUT",
        { interests: [] },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  const options = await req("/api/feed", "OPTIONS", undefined, {
    Origin: "http://localhost:5173",
  });
  assert.equal(options.status, 204);
  await api("/api/search?limit=-1", "GET", undefined, 400);
  await api("/api/contents/not-uuid", "GET", undefined, 400);
  await api("/api/preferences", "PUT", { interests: "wrong" }, 400);
  const oversized = await req("/api/preferences", "PUT", {
    interests: ["x".repeat(66000)],
  });
  assert.equal(oversized.status, 413);
});
test("cadastro não aprova fonte; rejeição e pausa bloqueiam ingestão; decisões persistem", async () => {
  const { id: _, status, createdAt, nextFetchAt, ...input } = fixture;
  source = await api("/api/admin/sources", "POST", input, 201);
  assert.equal(source.status, "pending");
  await api(`/api/admin/sources/${source.id}/ingest`, "POST", undefined, 409);
  await api(`/api/admin/sources/${source.id}/status`, "PATCH", {
    status: "rejected",
    reason: "TESTE — direitos ainda não verificados",
  });
  await assert.rejects(
    ingestSource(env, source.id, async () => new Response(rss)),
    /aprovada/,
  );
  source = await api(`/api/admin/sources/${source.id}/status`, "PATCH", {
    status: "approved",
    reason: "TESTE — feed sintético autorizado",
  });
  const result = await ingestSource(
    env,
    source.id,
    async () => new Response(rss),
  );
  assert.equal(result.status, "completed");
  assert.equal(result.accepted, 1);
  await assert.rejects(
    ingestSource(env, source.id, async () => new Response(rss)),
    /intervalo/,
  );
  assert.equal(
    (
      await rows(
        env.DB,
        "SELECT * FROM source_decisions WHERE source_id=?",
        source.id,
      )
    ).length,
    2,
  );
});
let contentId: string, candidateId: string;
test("deduplicação real por URL/DOI/GUID, transação e índice único", async () => {
  const run = await runId();
  const firstResult = await processCandidate(
    env.DB,
    fixtureCandidate,
    source,
    run,
  );
  assert.equal(firstResult.outcome, "approved");
  contentId = firstResult.contentId!;
  candidateId = firstResult.candidateId;
  const urlDuplicate = await processCandidate(
    env.DB,
    {
      ...fixtureCandidate,
      identifiers: [],
      url: "https://fixtures.example.test/design?utm_medium=another",
    },
    source,
    run,
  );
  assert.equal(urlDuplicate.outcome, "duplicate");
  assert.equal(urlDuplicate.contentId, contentId);
  const doiDuplicate = await processCandidate(
    env.DB,
    {
      ...fixtureCandidate,
      url: "https://fixtures.example.test/other",
      identifiers: [{ scheme: "doi", value: "10.9999/lastro-test-001" }],
    },
    source,
    run,
  );
  assert.equal(doiDuplicate.contentId, contentId);
  const guid = {
    ...fixtureCandidate,
    url: "https://fixtures.example.test/guid",
    identifiers: [{ scheme: "source_guid" as const, value: "unique-guid" }],
  };
  const a = await processCandidate(env.DB, guid, source, run);
  assert.equal(
    await duplicate(
      env.DB,
      normalizeCandidate({
        ...guid,
        url: "https://fixtures.example.test/guid2",
      }),
      source,
    ),
    a.contentId,
  );
  await assert.rejects(
    stmt(
      env.DB,
      "INSERT INTO content_identifiers VALUES (?,'doi','10.9999/lastro-test-001')",
      a.contentId,
    ).run(),
    /UNIQUE/,
  );
  assert.ok(
    await first(
      env.DB,
      "SELECT * FROM authors WHERE name=?",
      "Autora Fictícia",
    ),
  );
});
test("incompletos, inacessíveis e papers deixam histórico e admitem correção manual", async () => {
  const run = await runId();
  const incomplete = await processCandidate(
    env.DB,
    { ...fixtureCandidate, title: "", url: "", identifiers: [] },
    source,
    run,
  );
  assert.equal(incomplete.outcome, "rejected");
  const inaccessible = await processCandidate(
    env.DB,
    {
      ...fixtureCandidate,
      url: "https://fixtures.example.test/broken",
      identifiers: [],
      access: "unavailable",
    },
    source,
    run,
  );
  assert.equal(inaccessible.outcome, "rejected");
  const paper = await processCandidate(
    env.DB,
    parseOpenAlex(academic, source)[0],
    source,
    run,
  );
  assert.equal(paper.outcome, "pending");
  await api(`/api/admin/candidates/${paper.candidateId}/review`, "POST", {
    decision: "approved",
    reason: "TESTE — revisão humana sintética de método e limites",
    materialScore: 75,
  });
  const repaired = await api(
    `/api/admin/candidates/${incomplete.candidateId}/review`,
    "POST",
    {
      decision: "approved",
      reason: "TESTE — título e URL corrigidos",
      correction: {
        title: "TESTE — Design corrigido",
        url: "https://fixtures.example.test/corrected",
      },
    },
  );
  assert.ok(repaired.contentId);
  assert.equal(
    (
      await first<{ reviewer: string }>(
        env.DB,
        "SELECT reviewer FROM quality_evaluations WHERE content_id=?",
        repaired.contentId,
      )
    )?.reviewer,
    "owner",
  );
  await api(
    `/api/admin/candidates/${inaccessible.candidateId}/review`,
    "POST",
    { decision: "approved", reason: "TESTE — não deve ultrapassar restrição" },
    422,
  );
  await api(
    `/api/admin/contents/${paper.contentId}/annotations`,
    "POST",
    { classification: "scientific_evidence" },
    422,
  );
  await api(
    `/api/admin/contents/${paper.contentId}/annotations`,
    "POST",
    {
      classification: "scientific_evidence",
      statement: "Afirmação sintética de teste",
      referenceUrl: "https://fixtures.example.test/paper",
      limitations: "Fixture de teste; nenhuma inferência real.",
    },
    201,
  );
  await api(
    `/api/admin/contents/${paper.contentId}/annotations`,
    "POST",
    {
      classification: "application_hypothesis",
      statement: "TESTE — hipótese ainda não validada",
    },
    201,
  );
  const details = await api(`/api/contents/${paper.contentId}`);
  assert.equal(details.annotations.length, 2);
});
test("favoritos, leitura, notas, coleções e seleção mantêm estados independentes e persistentes", async () => {
  await api(`/api/contents/${contentId}/favorite`, "PUT");
  await api("/api/workshop/selection", "PUT", { contentIds: [contentId] });
  await api(`/api/contents/${contentId}/interactions`, "POST", {
    type: "read",
  });
  await api(`/api/contents/${contentId}/note`, "PUT", {
    text: "Nota pessoal de teste",
  });
  assert.equal(
    (await req(`/api/contents/${contentId}/favorite`, "DELETE")).status,
    204,
  );
  let data = await api(`/api/contents/${contentId}`);
  assert.equal(data.state.favorite, false);
  assert.equal(data.state.selected, true);
  assert.equal(data.state.read, true);
  assert.equal(data.state.note, "Nota pessoal de teste");
  assert.equal(
    (
      await first<{ active: number }>(
        env.DB,
        "SELECT active FROM interactions WHERE content_id=? AND type='read'",
        contentId,
      )
    )?.active,
    1,
  );
  await api(`/api/contents/${contentId}/favorite`, "PUT");
  await api("/api/workshop/selection", "PUT", { contentIds: [] });
  data = await api(`/api/contents/${contentId}`);
  assert.equal(data.state.favorite, true);
  assert.equal(data.state.selected, false);
  await api("/api/workshop/selection", "PUT", { contentIds: [contentId] });
  const col = await api(
    "/api/collections",
    "POST",
    { name: "TESTE — Branding" },
    201,
  );
  assert.equal(
    (await req(`/api/collections/${col.id}/items/${contentId}`, "PUT")).status,
    204,
  );
  assert.equal((await api(`/api/collections/${col.id}/items`)).items.length, 1);
});
test("feed paginado preserva sequência e revalida descarte, aprovação e expiração", async () => {
  const one = await api("/api/feed?limit=1");
  assert.equal(one.items.length, 1);
  assert.ok(one.items[0].explanation.algorithmVersion);
  assert.ok(one.nextCursor);
  const two = await api(
    `/api/feed?limit=1&cursor=${encodeURIComponent(one.nextCursor)}`,
  );
  assert.notEqual(one.items[0].content.id, two.items[0].content.id);
  assert.equal(one.snapshotId, two.snapshotId);
  const target = two.items[0].content.id;
  await api(`/api/contents/${target}/interactions`, "POST", {
    type: "dismissed",
  });
  const after = await api(
    `/api/feed?limit=50&cursor=${encodeURIComponent(one.nextCursor)}`,
  );
  assert.ok(!after.items.some((i: any) => i.content.id === target));
  await api(`/api/contents/${target}/interactions`, "POST", {
    type: "dismissed",
    active: false,
  });
  await api(`/api/admin/sources/${source.id}/status`, "PATCH", {
    status: "paused",
    reason: "TESTE — suspensão editorial",
  });
  assert.equal((await api("/api/feed")).items.length, 0);
  await api(`/api/admin/sources/${source.id}/status`, "PATCH", {
    status: "approved",
    reason: "TESTE — revisão concluída",
  });
  await stmt(
    env.DB,
    "UPDATE feed_snapshots SET expires_at='2000-01-01' WHERE id=?",
    one.snapshotId,
  ).run();
  await api(
    `/api/feed?cursor=${encodeURIComponent(one.nextCursor)}`,
    "GET",
    undefined,
    410,
  );
});
test("busca/filtros, favoritos e pacote exportável geram prompt idempotente", async () => {
  assert.ok(
    (await api("/api/search?q=Design&topic=design&language=pt")).items.length >
      0,
  );
  assert.equal(
    (await api("/api/search?classification=scientific_evidence")).items.length,
    1,
  );
  assert.ok(
    (await api("/api/favorites")).items.some((i: any) => i.id === contentId),
  );
  const pack = await api(
    "/api/research-packages",
    "POST",
    { format: "carousel", slides: 5, objective: "TESTE — comparar design" },
    201,
  );
  assert.equal(pack.sources[0].state.note, "Nota pessoal de teste");
  assert.equal(pack.sources[0].access, "restricted");
  const prompt = await api(`/api/research-packages/${pack.id}/prompt`, "POST");
  assert.match(prompt.text, /Nota pessoal de teste/);
  assert.match(prompt.text, /10\.9999\/lastro-test-001/);
  assert.deepEqual(
    await api(`/api/research-packages/${pack.id}/prompt`, "POST"),
    prompt,
  );
  assert.equal((await api(`/api/research-packages/${pack.id}`)).id, pack.id);
  await api("/api/workshop/selection", "PUT", { contentIds: [] });
  await api(
    "/api/research-packages",
    "POST",
    { format: "post", objective: "Teste vazio" },
    409,
  );
});
test("falhas externas persistem sem vazamento de segredo; cron desativado não coleta", async () => {
  await stmt(
    env.DB,
    "UPDATE sources SET next_fetch_at=NULL,last_cycle_key=NULL,retry_at=NULL WHERE id=?",
    source.id,
  ).run();
  const failed = await ingestSource(
    env,
    source.id,
    async () => new Response("", { status: 403 }),
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "upstream_403");
  assert.equal(
    (
      await first<any>(
        env.DB,
        "SELECT lease_until FROM sources WHERE id=?",
        source.id,
      )
    ).lease_until,
    null,
  );
  await scheduledIngest({ ...env, INGEST_ENABLED: "false" });
  const runs = await api("/api/admin/ingestion-runs");
  assert.ok(runs.items.some((i: any) => i.error === "upstream_403"));
  const rejects = await api("/api/admin/candidates?outcome=rejected");
  assert.ok(rejects.items.some((i: any) => i.reasons.includes("unavailable")));
});
test("fila retoma lotes sem nova coleta e respeita orçamento de 50 consultas D1", async () => {
  await stmt(
    env.DB,
    "UPDATE sources SET next_fetch_at=NULL,last_cycle_key=NULL,retry_at=NULL WHERE id=?",
    source.id,
  ).run();
  const items = Array.from(
    { length: 5 },
    (_, i) =>
      `<item><title>TESTE design lote ${i}</title><link>https://fixtures.example.test/queue-${i}</link><author>Autor Teste</author><pubDate>2026-10-19</pubDate></item>`,
  ).join("");
  const xml = `<rss><channel><language>pt</language>${items}</channel></rss>`;
  let fetches = 0,
    queries = 0;
  // Count each statement, including those in batches, to guard the Free-plan budget.
  const db = new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare")
        return (sql: string) => {
          const track = (statement: any): any =>
            new Proxy(statement, {
              get(obj, k) {
                if (k === "bind")
                  return (...args: unknown[]) => track(obj.bind(...args));
                if (["run", "all", "first", "raw"].includes(String(k)))
                  return (...args: unknown[]) => {
                    queries++;
                    return obj[k](...args);
                  };
                return typeof obj[k] === "function" ? obj[k].bind(obj) : obj[k];
              },
            });
          return track(target.prepare(sql));
        };
      if (key === "batch")
        return (statements: D1PreparedStatement[]) => {
          queries += statements.length;
          return target.batch(statements);
        };
      const val = (target as any)[key];
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
  const counted = { ...env, DB: db };
  const fetcher = async () => {
    fetches++;
    return new Response(xml);
  };
  const one = await ingestSource(counted, source.id, fetcher);
  assert.equal(one.queuedRemaining, 3);
  assert.equal(one.received, 5);
  assert.equal(one.status, "partial");
  assert.ok(queries <= 47, `${queries} queries plus 3 scheduler queries`);
  console.info(`D1 ingestion statements: ${queries}`);
  queries = 0;
  const two = await ingestSource(counted, source.id, fetcher);
  assert.equal(two.queuedRemaining, 1);
  assert.equal(two.received, 0);
  assert.ok(queries <= 47, `${queries} queries plus 3 scheduler queries`);
  console.info(`D1 ingestion statements: ${queries}`);
  const three = await ingestSource(env, source.id, fetcher);
  assert.equal(three.status, "completed");
  assert.equal(three.queuedRemaining, 0);
  assert.equal(fetches, 1);
});

test("retratação posterior retira o original do índice sem apagar favoritos", async () => {
  const result = await processCandidate(
    env.DB,
    { ...fixtureCandidate, retracted: true },
    source,
    await runId(),
  );
  assert.equal(result.outcome, "rejected");
  assert.equal(result.contentId, contentId);
  const detail = await api(`/api/contents/${contentId}`);
  assert.equal(detail.editorialStatus, "rejected");
  assert.equal(detail.retracted, true);
  assert.equal(detail.state.favorite, true);
  const feed = await api("/api/feed");
  assert.ok(!feed.items.some((item: any) => item.content.id === contentId));
});

test("Curadoria exige autenticação e expõe estado, avaliação e histórico paginado", async () => {
  for (const path of [
    "overview",
    "decisions",
    "sources",
    "candidates",
    "ingestion-runs",
  ]) {
    assert.equal(
      (await app.fetch(new Request(`http://localhost/api/admin/${path}`), env))
        .status,
      401,
    );
  }
  const overview = await api("/api/admin/overview");
  assert.equal(overview.ingestEnabled, false);
  assert.ok(overview.sources > 0);
  assert.ok(overview.allowedHosts.includes("fixtures.example.test"));
  const listing = await api("/api/admin/sources?limit=1");
  assert.ok("lastRun" in listing.items[0]);
  const queue = await api("/api/admin/candidates?limit=1");
  assert.equal(typeof queue.items[0].quality.score, "number");
  assert.ok(Array.isArray(queue.items[0].quality.limitations));
  const decisions = await api("/api/admin/decisions?limit=1");
  assert.equal(decisions.items.length, 1);
  assert.ok(decisions.items[0].reason);
  assert.equal(decisions.nextCursor, "1");
  const second = await api("/api/admin/decisions?limit=1&offset=1");
  assert.notEqual(decisions.items[0].id, second.items[0].id);
});
