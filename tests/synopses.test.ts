import { migrationStatements } from "./migration-statements";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { app } from "../src/index";
import { stmt, first, id, now, policy } from "../src/db";
import { saveContent } from "../src/ingestion";
import { content } from "../src/content";
import { contentFixture, fixtureSource, fixtureCandidate } from "./fixtures";
import {
  processSynopsis,
  enqueueSynopses,
  reserveBudget,
  validateSynopsis,
  sufficientEvidence,
  checkSynopsis,
  synopsisGate,
  MODEL,
  AUTOMATIC_RESERVATION,
} from "../src/synopses";
import type { Env } from "../src/env";
import {
  VERIFIER,
  supportedReport,
  splitSentences,
  neuronUsage,
  decodeVerification,
  LEGACY_VERIFIER,
  VERIFICATION_OUTPUT_TOKENS,
} from "../src/synopsis-verification";
import { scheduledSynopses } from "../src/synopses";
import { captureEvidence, captureStatement } from "../src/synopsis-evidence";
import { balanceLanguages, rank } from "../src/ranking";
import { defaultPolicy } from "../packages/contracts";
import { sourceView, type SourceRow } from "../src/db";
let mf: Miniflare,
  env: Env,
  calls = 0;
const evidenceText =
  "Material sintético autorizado para teste. O texto discute escolhas de tipografia em interfaces bancárias, relacionando legibilidade e confiança. A autora apresenta exemplos de caracteres que podem ser confundidos e comenta espaçamento, tamanho e distinção entre letras. A publicação aborda decisões de projeto para facilitar a leitura de informações financeiras, sem avaliar retornos de investimento.";
const synopsis =
  "O artigo examina como decisões tipográficas participam da experiência em aplicativos financeiros. Com foco na leitura clara das informações, aborda diferenças entre caracteres, organização dos espaços e dimensões das letras. O leitor encontra exemplos de escolhas de design relacionadas à legibilidade e à confiança na interface.";
const evidence = {
  text: evidenceText,
  url: "https://fixtures.example.test/evidence",
  rightsNote:
    "Fixture original do LASTRO, autorizada exclusivamente para testes.",
  retrievedAt: now(),
  kind: "editorial_evidence",
};
const token = "synopsis-test-token-not-a-real-secret-123456";
const reportFor = (text = synopsis) => ({
  portuguese: true,
  informative: true,
  uncertain: false,
  sentences: splitSentences(text).map((_, index) => ({
    index,
    supported: true,
    quotes: [evidenceText],
  })),
});
async function automaticSource() {
  await stmt(
    env.DB,
    "UPDATE sources SET config_json=? WHERE id=?",
    JSON.stringify(fixtureSource),
    fixtureSource.id,
  ).run();
}
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
    DEV_TOKEN: token,
    SYNOPSIS_ENABLED: "true",
    SYNOPSIS_REQUIRED: "true",
    AI: {
      run: async (model) => {
        assert.equal(model, MODEL);
        calls++;
        return { response: synopsis };
      },
    },
  };
  for (const f of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      await readFile(`migrations/${f}`, "utf8"),
    ))
      await env.DB.prepare(sql).run();
  await policy(env.DB);
  await stmt(
    env.DB,
    "INSERT INTO sources(id,name,connector,url,status,config_json,created_at) VALUES (?,?,?,?,?,?,?)",
    fixtureSource.id,
    fixtureSource.name,
    fixtureSource.connector,
    fixtureSource.url,
    "approved",
    JSON.stringify({ ...fixtureSource, autoApprove: false }),
    now(),
  ).run();
});
after(async () => mf.dispose());
test("publicação automática exige verificador independente, cobertura integral e evidência exata", async () => {
  await automaticSource();
  const cid = await add();
  const ai = env.AI;
  env.AI = {
    run: async (model) => {
      calls++;
      return {
        response: model === MODEL ? synopsis : JSON.stringify(reportFor()),
        usage: { prompt_tokens: 600, completion_tokens: 100, neurons: 7.25 },
      };
    },
  };
  assert.equal((await processSynopsis(env)).status, "validated");
  assert.equal(await visible(cid), true);
  assert.equal(calls, 2);
  const row: any = await first(
    env.DB,
    "SELECT * FROM content_synopses WHERE content_id=?",
    cid,
  );
  assert.equal(row.validation_mode, "automatic");
  assert.ok(row.validated_at);
  assert.ok(JSON.parse(row.validation_json).passed);
  const usage: any = await first(env.DB, "SELECT * FROM synopsis_usage");
  assert.equal(usage.reserved_neurons, AUTOMATIC_RESERVATION);
  const measured: any = await first(
    env.DB,
    "SELECT COUNT(*) n,SUM(calculated_neurons) neurons FROM synopsis_inferences WHERE content_id=?",
    cid,
  );
  assert.equal(measured.n, 2);
  assert.ok(measured.neurons > 0);
  assert.equal((await processSynopsis(env)).status, "idle");
  assert.equal(calls, 2);
  env.AI = ai;
});
test("parecer parcial, incerto, malformado ou com trecho inexistente nunca publica", async () => {
  const valid = reportFor();
  assert.equal(supportedReport(valid, synopsis, evidenceText), true);
  assert.equal(
    supportedReport({ ...valid, uncertain: true }, synopsis, evidenceText),
    false,
  );
  assert.equal(
    supportedReport(
      { ...valid, sentences: valid.sentences.slice(1) },
      synopsis,
      evidenceText,
    ),
    false,
  );
  assert.equal(
    supportedReport(
      {
        ...valid,
        sentences: valid.sentences.map((s) => ({
          ...s,
          quotes: ["Uma informação que não está presente na fonte."],
        })),
      },
      synopsis,
      evidenceText,
    ),
    false,
  );
  assert.equal(supportedReport("aprovado", synopsis, evidenceText), false);
  await automaticSource();
  const cid = await add();
  const ai = env.AI;
  env.AI = {
    run: async (model) => ({
      response:
        model === MODEL
          ? synopsis
          : JSON.stringify({ ...valid, uncertain: true }),
    }),
  };
  assert.equal((await processSynopsis(env)).status, "review");
  assert.equal(await visible(cid), false);
  env.AI = ai;
});
test("afirmação inventada sinalizada pelo verificador vai à Curadoria, sem tentar completar o feed", async () => {
  await automaticSource();
  const cid = await add();
  const ai = env.AI;
  const invented = synopsis.replace("O artigo examina", "O artigo comprova");
  env.AI = {
    run: async (model) => ({
      response:
        model === MODEL
          ? invented
          : JSON.stringify({ ...reportFor(invented), uncertain: true }),
    }),
  };
  assert.equal((await processSynopsis(env)).status, "review");
  assert.equal(await visible(cid), false);
  env.AI = ai;
});
test("estudo nunca recebe validação automática e cron registra execução sem novas gerações em leitura", async () => {
  await automaticSource();
  const cid = await add("en", "paper");
  await scheduledSynopses(env);
  assert.equal(await visible(cid), false);
  assert.equal(calls, 1);
  const schedule: any = await first(env.DB, "SELECT * FROM synopsis_scheduler");
  assert.equal(schedule.last_status, "review");
  assert.ok(schedule.last_finished_at);
});
test("futuro não é inferido de pesquisa já em andamento, mesmo com parecer positivo simulado", async () => {
  await automaticSource();
  const cid = await add();
  const ai = env.AI;
  const future = synopsis.replace("O artigo examina", "O artigo lançará");
  env.AI = {
    run: async (model) => {
      calls++;
      return {
        response: model === MODEL ? future : JSON.stringify(reportFor(future)),
      };
    },
  };
  assert.equal((await processSynopsis(env)).status, "review");
  assert.equal(await visible(cid), false);
  assert.equal(calls, 1);
  const row: any = await first(
    env.DB,
    "SELECT validation_note FROM content_synopses WHERE content_id=?",
    cid,
  );
  assert.match(row.validation_note, /temporalidade/);
  env.AI = ai;
});
test("telemetria distingue tokens observados de reserva e dados ausentes", () => {
  assert.equal(neuronUsage(MODEL, null), null);
  assert.deepEqual(
    neuronUsage(MODEL, { prompt_tokens: 1000, completion_tokens: 100 }),
    { prompt: 1000, completion: 100, neurons: 7.6725 },
  );
  assert.ok(
    neuronUsage(VERIFIER, { prompt_tokens: 1000, completion_tokens: 100 })!
      .neurons > 0,
  );
  assert.equal(
    neuronUsage(LEGACY_VERIFIER, {
      prompt_tokens: 1000,
      completion_tokens: 100,
    })!.neurons,
    7.6058,
  );
  assert.equal(
    neuronUsage(VERIFIER, { prompt_tokens: 1000, completion_tokens: 100 })!
      .neurons,
    47.1485,
  );
  assert.equal(
    neuronUsage("unknown-model", {
      prompt_tokens: 1000,
      completion_tokens: 100,
    }),
    null,
  );
});

test("50/50 preserva pares completos quando um idioma tem sobra ou nenhum conteúdo", () => {
  for (const pt of [0, 8]) {
    const items = Array.from({ length: pt + 9 }, (_, i) =>
      contentFixture({ id: `asymmetric-${i}`, language: i < pt ? "pt" : "en" }),
    );
    const feed = balanceLanguages(
      rank(items, { interests: [], languages: [] }, defaultPolicy),
    );
    assert.equal(feed.length, pt * 2);
    assert.equal(feed.filter((i) => i.content.language === "pt").length, pt);
    assert.equal(feed.filter((i) => i.content.language === "en").length, pt);
    assert.equal(new Set(feed.map((i) => i.content.id)).size, feed.length);
  }
});

test("respostas de binding objeto/string são aceitas, truncamento e recusas nunca publicam", () => {
  const report = reportFor();
  for (const response of [
    report,
    JSON.stringify(report),
    ` \n\u0060\u0060\u0060json\n${JSON.stringify(report)}\n\u0060\u0060\u0060\n `,
  ])
    assert.equal(
      decodeVerification({ response }, synopsis, evidenceText).passed,
      true,
    );
  for (const output of [
    { response: '{"sentences":[' },
    { response: null },
    { response: report, finish_reason: "length" },
    {
      response: report,
      usage: { completion_tokens: VERIFICATION_OUTPUT_TOKENS },
    },
    { response: report, refusal: "Cannot verify" },
    { response: { ...report, uncertain: true } },
    { response: { ...report, sentences: report.sentences.slice(0, 2) } },
    {
      response: {
        ...report,
        sentences: report.sentences.map((s) => ({ ...s, index: 0 })),
      },
    },
    {
      response: {
        ...report,
        sentences: report.sentences.map((s) => ({
          ...s,
          supported: false,
          quotes: [],
        })),
      },
    },
  ])
    assert.equal(
      decodeVerification(output, synopsis, evidenceText).passed,
      false,
    );
});

test("concorrência preserva teto de 4.500 com a reserva integral do novo verificador", async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      reserveBudget(env.DB, now().slice(0, 10), AUTOMATIC_RESERVATION),
    ),
  );
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal(
    (await first<any>(env.DB, "SELECT reserved_neurons FROM synopsis_usage"))!
      .reserved_neurons,
    4500,
  );
});

test("entrada excessiva do verificador retém rascunho sem bloquear quota ou repetir geração", async () => {
  await automaticSource();
  const cid = await add();
  await stmt(
    env.DB,
    "UPDATE content_synopses SET evidence_json=? WHERE content_id=?",
    JSON.stringify({
      ...evidence,
      text: evidenceText.repeat(6).slice(0, 2900),
    }),
    cid,
  ).run();
  const before = calls;
  assert.equal((await processSynopsis(env)).status, "review");
  assert.equal(calls, before + 1);
  assert.equal(
    (await first<any>(env.DB, "SELECT blocked FROM synopsis_usage"))!.blocked,
    0,
  );
  assert.equal(await visible(cid), false);
  assert.equal((await processSynopsis(env)).status, "idle");
  assert.equal(calls, before + 1);
});
test("ciclo licenciado preserva atribuição, cache e limite de consultas D1", async () => {
  const licenseUrl = "https://creativecommons.org/licenses/by-sa/4.0/";
  const cid = await add();
  await stmt(
    env.DB,
    "UPDATE sources SET config_json=? WHERE id=?",
    JSON.stringify({
      ...fixtureSource,
      synopsisAllowed: true,
      synopsisRightsNote: evidence.rightsNote,
      synopsisLicenseUrl: licenseUrl,
    }),
    fixtureSource.id,
  ).run();
  await stmt(
    env.DB,
    "UPDATE content_synopses SET evidence_json=? WHERE content_id=?",
    JSON.stringify({
      ...evidence,
      kind: "authorized_feed_description",
      licenseUrl,
      sourceId: fixtureSource.id,
      originUrl: fixtureSource.url,
      permissionVersion: (await first<any>(
        env.DB,
        "SELECT synopsis_permission_version v FROM sources WHERE id=?",
        fixtureSource.id,
      ))!.v,
      url: (await content(env.DB, cid)).url,
    }),
    cid,
  ).run();
  let queries = 0;
  const db = env.DB;
  const counted = {
    prepare: (sql: string) => {
      queries++;
      return db.prepare(sql);
    },
    batch: db.batch.bind(db),
  } as D1Database;
  const result = await processSynopsis({
    ...env,
    DB: counted,
    AI: {
      run: async (model) => {
        calls++;
        return {
          response: model === MODEL ? synopsis : JSON.stringify(reportFor()),
          usage: { prompt_tokens: 600, completion_tokens: 100, neurons: 7.25 },
        };
      },
    },
  });
  assert.equal(result.status, "validated");
  assert.ok(
    queries < 50,
    `${queries} queries exceeds D1 Free invocation budget`,
  );
  assert.equal((await content(db, cid)).synopsis?.licenseUrl, licenseUrl);
  const before = calls;
  await content(db, cid);
  assert.equal(calls, before);
});
beforeEach(async () => {
  calls = 0;
  await stmt(
    env.DB,
    "UPDATE sources SET config_json=? WHERE id=?",
    JSON.stringify({ ...fixtureSource, autoApprove: false }),
    fixtureSource.id,
  ).run();
  await stmt(
    env.DB,
    "UPDATE content_synopses SET status='blocked',block_code='editorial'",
  ).run();
  await stmt(env.DB, "DELETE FROM synopsis_usage").run();
});
test("descrição inglesa autorizada entra no gerador; rascunho factual não ganha aprovação automática", async () => {
  const cid = await add("en", "article", false);
  const english =
    "This original synthetic test article discusses the typography of banking interfaces. It examines the distinction between similar letters and digits, spacing, and readable character sizes. The author explains how these choices relate to trust in digital services. Examples concern interface design decisions, without investment advice, measured outcomes or claims that a particular typeface prevents fraud.";
  await stmt(
    env.DB,
    "UPDATE contents SET metadata_json=json_set(metadata_json,'$.description',?) WHERE id=?",
    english,
    cid,
  ).run();
  await stmt(
    env.DB,
    "UPDATE sources SET config_json=? WHERE id=?",
    JSON.stringify({
      ...fixtureSource,
      synopsisAllowed: true,
      autoApprove: false,
      synopsisRightsNote:
        "Material sintético de teste com processamento autorizado.",
    }),
    fixtureSource.id,
  ).run();
  const ai = env.AI;
  const source = sourceView(
    (await first<SourceRow>(
      env.DB,
      "SELECT * FROM sources WHERE id=?",
      fixtureSource.id,
    ))!,
  );
  const capture = captureEvidence(
    source,
    (await content(env.DB, cid)).url,
    english,
    null,
    now(),
  )!;
  await captureStatement(env.DB, source, [capture], now()).run();
  env.AI = {
    run: async (model, input) => {
      calls++;
      assert.ok(input.messages.at(-1)!.content.includes(english));
      return { response: synopsis };
    },
  };
  assert.equal((await processSynopsis(env)).status, "review");
  assert.equal(calls, 1);
  assert.equal(await visible(cid), false);
  const row: any = await first(
    env.DB,
    "SELECT evidence_json FROM content_synopses WHERE content_id=?",
    cid,
  );
  assert.equal(JSON.parse(row.evidence_json).text, english);
  env.AI = ai;
});
test("cursor antigo e busca revalidam o requisito; favoritos continuam acessíveis", async () => {
  const pt = await add("pt"),
    en = await add("en");
  await processSynopsis(env);
  await processSynopsis(env);
  await validateSynopsis(env.DB, pt, review);
  await validateSynopsis(env.DB, en, review);
  const page: any = await (await request("/api/feed?limit=1")).json();
  assert.ok(page.nextCursor);
  await stmt(env.DB, "UPDATE content_synopses SET status='blocked'").run();
  const next: any = await (
    await request("/api/feed?limit=1&cursor=" + page.nextCursor)
  ).json();
  assert.equal(next.items.length, 0);
  const search: any = await (await request("/api/search")).json();
  assert.equal(search.items.length, 0);
  await stmt(
    env.DB,
    "INSERT INTO favorites VALUES (?,?,?)",
    "owner",
    pt,
    now(),
  ).run();
  const saved: any = await (await request("/api/favorites")).json();
  assert.ok(saved.items.some((i: any) => i.id === pt));
});
async function add(
  language = "pt",
  kind: "article" | "paper" = "article",
  withEvidence = true,
) {
  const n = id();
  const c = {
    ...fixtureCandidate,
    url: `https://fixtures.example.test/${n}`,
    identifiers: [],
    language,
    kind,
  };
  const cid = await saveContent(
    env.DB,
    c,
    fixtureSource,
    contentFixture().quality,
    "approved",
  );
  await enqueueSynopses(env.DB);
  if (withEvidence)
    await stmt(
      env.DB,
      "UPDATE content_synopses SET evidence_json=? WHERE content_id=?",
      JSON.stringify(evidence),
      cid,
    ).run();
  return cid;
}
async function request(path: string, method = "GET", body?: unknown) {
  return app.fetch(
    new Request("http://localhost" + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
}
async function visible(cid: string) {
  return !!(await first(
    env.DB,
    `SELECT c.id FROM contents c WHERE c.id=? AND ${synopsisGate}`,
    cid,
  ));
}
const review = {
  text: synopsis,
  reason:
    "Conferência editorial de todas as afirmações contra a evidência sintética.",
  evidenceSupported: true as const,
};
test("título isolado, números inventados e cópia não passam nas verificações básicas", () => {
  assert.equal(
    sufficientEvidence(fixtureCandidate.title, fixtureCandidate.title),
    false,
  );
  assert.equal(sufficientEvidence(evidenceText, fixtureCandidate.title), true);
  assert.deepEqual(checkSynopsis(synopsis, evidenceText), []);
  assert.ok(
    checkSynopsis(synopsis + " O aumento foi de 99%.", evidenceText).some((e) =>
      e.includes("Número"),
    ),
  );
  assert.ok(
    checkSynopsis(evidenceText, evidenceText).some((e) =>
      e.includes("próximo"),
    ),
  );
});
test("português e inglês geram uma vez e só aparecem após revisão; leituras usam cache", async () => {
  for (const language of ["pt", "en"]) {
    const cid = await add(language);
    assert.equal((await processSynopsis(env)).status, "review");
    assert.equal(await visible(cid), false);
    await validateSynopsis(env.DB, cid, review);
    assert.equal(await visible(cid), true);
    assert.equal((await content(env.DB, cid)).synopsis?.text, synopsis);
    assert.equal((await processSynopsis(env)).status, "idle");
    await content(env.DB, cid);
    await content(env.DB, cid);
  }
  assert.equal(calls, 2);
  const feed = await request("/api/feed");
  assert.equal(feed.status, 200);
  const json: any = await feed.json();
  assert.ok(json.items.length > 0);
  assert.ok(
    json.items.every((i: any) => i.content.synopsis?.status === "validated"),
  );
  assert.equal(
    json.items.filter((i: any) => i.content.language === "pt").length,
    json.items.filter((i: any) => i.content.language === "en").length,
  );
});
test("sem autorização de processamento ou evidência suficiente não chama IA", async () => {
  const cid = await add("pt", "article", false);
  assert.equal((await processSynopsis(env)).status, "blocked");
  assert.equal(calls, 0);
  await stmt(
    env.DB,
    "UPDATE content_synopses SET status='pending',evidence_json=? WHERE content_id=?",
    JSON.stringify({ ...evidence, text: fixtureCandidate.title.repeat(10) }),
    cid,
  ).run();
  assert.equal((await processSynopsis(env)).status, "blocked");
  assert.equal(calls, 0);
});
test("estudos científicos exigem revisão e alterações invalidam sinopse, mantendo favoritos", async () => {
  const cid = await add("en", "paper");
  await processSynopsis(env);
  assert.equal(await visible(cid), false);
  await validateSynopsis(env.DB, cid, review);
  await stmt(
    env.DB,
    "INSERT INTO favorites VALUES (?,?,?)",
    "owner",
    cid,
    now(),
  ).run();
  await stmt(
    env.DB,
    "UPDATE contents SET metadata_json=json_set(metadata_json,'$.title','Título corrigido') WHERE id=?",
    cid,
  ).run();
  assert.equal(await visible(cid), false);
  await assert.rejects(() => validateSynopsis(env.DB, cid, review));
  await enqueueSynopses(env.DB);
  assert.equal((await content(env.DB, cid)).synopsis, null);
  assert.ok(
    await first(env.DB, "SELECT * FROM favorites WHERE content_id=?", cid),
  );
});
test("reserva atômica limita concorrência a 30 chamadas e bloqueio de quota impede novas reservas", async () => {
  const results = await Promise.all(
    Array.from({ length: 35 }, () => reserveBudget(env.DB)),
  );
  assert.equal(results.filter(Boolean).length, 30);
  const usage: any = await first(env.DB, "SELECT * FROM synopsis_usage");
  assert.equal(usage.reserved_neurons, 4500);
  assert.equal(usage.calls, 30);
  await stmt(
    env.DB,
    "UPDATE synopsis_usage SET blocked=1,reserved_neurons=0",
  ).run();
  assert.equal(await reserveBudget(env.DB), null);
});
test("orçamento esgotado deixa pendente, quota bloqueia dia, falha não regenera silenciosamente", async () => {
  const cid = await add();
  await stmt(
    env.DB,
    "INSERT INTO synopsis_usage(day,reserved_neurons,calls) VALUES (?,4500,30)",
    now().slice(0, 10),
  ).run();
  assert.equal((await processSynopsis(env)).status, "pending");
  assert.equal(calls, 0);
  await stmt(env.DB, "DELETE FROM synopsis_usage").run();
  const ai = env.AI;
  env.AI = {
    run: async () => {
      calls++;
      throw Error("429 neuron quota exhausted");
    },
  };
  assert.equal((await processSynopsis(env)).status, "failed");
  assert.equal(await visible(cid), false);
  assert.equal((await processSynopsis(env)).status, "idle");
  assert.equal(calls, 1);
  assert.equal(await reserveBudget(env.DB), null);
  env.AI = ai;
});
test("reenvio da mesma evidência não apaga validação nem gera novamente e endpoints exigem login", async () => {
  const cid = await add();
  await processSynopsis(env);
  await validateSynopsis(env.DB, cid, review);
  const response = await request(`/api/admin/synopses/${cid}/evidence`, "PUT", {
    ...evidence,
    retrievedAt: now(),
  });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as any).unchanged, true);
  assert.equal(await visible(cid), true);
  assert.equal((await processSynopsis(env)).status, "idle");
  assert.equal(calls, 1);
  const denied = await app.fetch(
    new Request("http://localhost/api/admin/synopses"),
    env,
  );
  assert.equal(denied.status, 401);
});
test("resultado antigo não sobrescreve evidência trocada durante inferência", async () => {
  const cid = await add();
  const ai = env.AI;
  env.AI = {
    run: async () => {
      await stmt(
        env.DB,
        "UPDATE contents SET metadata_json=json_set(metadata_json,'$.title','Nova versão') WHERE id=?",
        cid,
      ).run();
      await enqueueSynopses(env.DB);
      return { response: synopsis };
    },
  };
  await processSynopsis(env);
  assert.equal(await visible(cid), false);
  const row: any = await first(
    env.DB,
    "SELECT * FROM content_synopses WHERE content_id=?",
    cid,
  );
  assert.equal(row.status, "pending");
  assert.equal(row.text, null);
  env.AI = ai;
});
