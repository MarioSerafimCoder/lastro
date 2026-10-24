import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { migrationStatements } from "./migration-statements";
import { app } from "../src/index";
import {
  first,
  rows,
  stmt,
  id,
  now,
  sourceView,
  type SourceRow,
} from "../src/db";
import { saveContent, ingestSource, scheduledIngest } from "../src/ingestion";
import { collect, parseRss } from "../src/connectors";
import {
  processSynopsis,
  scheduledSynopses,
  setSynopsisEvidence,
  validateSynopsis,
  checkSynopsis,
  sufficientEvidence,
} from "../src/synopses";
import {
  captureEvidence,
  captureStatement,
  evidenceKey,
  synopsisGate,
  type Evidence,
} from "../src/synopsis-evidence";
import { supportedReport, splitSentences } from "../src/synopsis-verification";
import { automaticFactualErrors, anchorErrors } from "../src/synopsis-facts";
import { contentFixture, fixtureCandidate, fixtureSource } from "./fixtures";
import { content } from "../src/content";
import type { Env } from "../src/env";
import type { Source } from "../packages/contracts";

let mf: Miniflare,
  env: Env,
  calls = 0;
const token = "autonomy-fixture-not-a-real-secret-123456";
const licence = "https://creativecommons.org/licenses/by-sa/4.0/" as const;
const evidenceText =
  "Texto sintético original autorizado para testes. A publicação discute escolhas tipográficas em interfaces financeiras e sua relação com a legibilidade e a confiança dos usuários. A autora apresenta exemplos de caracteres semelhantes que podem causar confusão e discute dimensões das letras e espaçamento. O enfoque está nas decisões de projeto para organizar informações financeiras com clareza, sem promessas de retorno ou demonstrações de eficácia.";
const synopsis =
  "O artigo examina como decisões tipográficas participam da experiência em aplicativos financeiros. Com foco na leitura clara das informações, aborda diferenças entre caracteres, organização dos espaços e dimensões das letras. O leitor encontra exemplos de escolhas de design relacionadas à legibilidade e à confiança na interface.";
const report = (text = synopsis, quote = evidenceText) => ({
  portuguese: true,
  informative: true,
  uncertain: false,
  sentences: splitSentences(text).map((_, index) => ({
    index,
    supported: true,
    quotes: [quote],
  })),
});
const review = {
  text: synopsis,
  evidenceSupported: true as const,
  reason:
    "Conferência editorial contra a evidência original sintética autorizada.",
};
const fakeAI: Env["AI"] = {
  run: async (model, input) => {
    calls++;
    return {
      response: model.includes("3.2-3b")
        ? synopsis
        : JSON.stringify(
            report(
              synopsis,
              JSON.parse(input.messages.at(-1)!.content).EVIDENCE,
            ),
          ),
      usage: { prompt_tokens: 600, completion_tokens: 100, neurons: 7.25 },
    };
  },
};
async function migrate(db: D1Database, until = "9999") {
  for (const f of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql") && f <= until)
    .sort())
    for (const sql of migrationStatements(
      await readFile(`migrations/${f}`, "utf8"),
    ))
      await db.prepare(sql).run();
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
    ALLOWED_FETCH_HOSTS: "fixtures.example.test",
    INGEST_ENABLED: "true",
    SYNOPSIS_ENABLED: "true",
    SYNOPSIS_REQUIRED: "true",
    AI: fakeAI,
  };
  await migrate(env.DB);
});
after(async () => mf.dispose());
beforeEach(async () => {
  calls = 0;
  env.AI = fakeAI;
  await stmt(env.DB, "UPDATE sources SET status='paused'").run();
  await stmt(env.DB, "DELETE FROM synopsis_usage").run();
});
async function source(allowed = true) {
  const sid = id();
  const s: Source = {
    ...fixtureSource,
    id: sid,
    url: `https://fixtures.example.test/feed/${sid}`,
    summaryAllowed: false,
    synopsisAllowed: allowed,
    synopsisLicenseUrl: licence,
    synopsisRightsNote:
      "Fixture original com permissão de adaptação sob CC BY-SA 4.0.",
    autoApprove: true,
    status: "approved",
  };
  await stmt(
    env.DB,
    "INSERT INTO sources(id,name,connector,url,status,config_json,created_at) VALUES (?,?,?,?,'approved',?,?)",
    sid,
    s.name,
    s.connector,
    s.url,
    JSON.stringify(s),
    now(),
  ).run();
  return s;
}
async function current(s: Source) {
  return sourceView(
    (await first<SourceRow>(env.DB, "SELECT * FROM sources WHERE id=?", s.id))!,
  );
}
async function add(s: Source, lang = "pt") {
  return saveContent(
    env.DB,
    {
      ...fixtureCandidate,
      title: "Design de informação e interfaces financeiras",
      url: `https://fixtures.example.test/article/${id()}`,
      identifiers: [],
      language: lang,
      description: null,
    },
    s,
    contentFixture().quality,
    "approved",
  );
}
async function capture(
  s: Source,
  cid: string,
  text = evidenceText,
  rights: string | null = null,
) {
  const c = await content(env.DB, cid),
    s2 = await current(s);
  const e = captureEvidence(s2, c.url, text, rights, now())!;
  await captureStatement(env.DB, s2, [e], now()).run();
  return e;
}
async function visible(cid: string) {
  return !!(await first(
    env.DB,
    `SELECT c.id FROM contents c WHERE c.id=? AND ${synopsisGate}`,
    cid,
  ));
}
async function req(path: string, method = "GET", body?: unknown) {
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
async function permissions(s: Source, allowed: boolean) {
  const {
    id: sid,
    status,
    createdAt,
    nextFetchAt,
    synopsisPermissionVersion,
    ...input
  } = await current(s);
  assert.equal(
    (
      await req(`/api/admin/sources/${sid}`, "PUT", {
        ...input,
        synopsisAllowed: allowed,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await req(`/api/admin/sources/${sid}/status`, "PATCH", {
        status: "approved",
        reason: "Permissões sintéticas verificadas neste teste.",
      })
    ).status,
    200,
  );
  return current(s);
}
const noNetwork = async () => {
  throw Error("unexpected_network");
};

test("descoberta persiste evidência antes da fila: artigo fora do RSS recente publica sem nova requisição", async () => {
  const s = await source();
  const url = `https://fixtures.example.test/discovered/${id()}`;
  const xml = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Fixture</title><language>pt</language><item><title>Design de interfaces financeiras</title><link>${url}</link><dc:creator>Autora Fictícia</dc:creator><pubDate>Mon, 19 Oct 2026 12:00:00 GMT</pubDate><guid>${url}</guid><description>Curta.</description><content:encoded><![CDATA[<p>${evidenceText}</p>]]></content:encoded></item></channel></rss>`;
  const run = await ingestSource(env, s.id, async () => new Response(xml));
  assert.equal(run.accepted, 1);
  const c = await first<any>(
    env.DB,
    "SELECT * FROM contents WHERE source_id=?",
    s.id,
  );
  assert.equal(JSON.parse(c.metadata_json).description, null);
  const saved = await first<any>(
    env.DB,
    "SELECT * FROM synopsis_evidence_cache WHERE source_id=?",
    s.id,
  );
  assert.equal(JSON.parse(saved.evidence_json).originUrl, s.url);
  assert.equal(JSON.parse(saved.evidence_json).licenseUrl, licence);
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "validated",
  );
  assert(await visible(c.id));
  const before = calls;
  for (let n = 0; n < 5; n++)
    assert.equal(
      (await processSynopsis(env, Date.now() + n * 300000, noNetwork)).status,
      "idle",
    );
  assert.equal(calls, before);
});
test("blocked recupera com nova permissão e captura; configuração e material idênticos não repetem IA", async () => {
  let s = await source(false);
  const cid = await add(s);
  let network = 0;
  const denied = await processSynopsis(env, Date.now(), async () => {
    network++;
    throw Error("must not fetch");
  });
  assert.equal(denied.status, "blocked");
  assert.equal(
    (
      await first<any>(
        env.DB,
        "SELECT block_code FROM content_synopses WHERE content_id=?",
        cid,
      )
    ).block_code,
    "rights",
  );
  for (let i = 0; i < 4; i++)
    assert.equal(
      (await processSynopsis(env, Date.now(), noNetwork)).status,
      "idle",
    );
  assert.equal(network, 0);
  assert.equal(calls, 0);
  s = await permissions(s, true);
  await capture(s, cid);
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "validated",
  );
  assert(await visible(cid));
  assert.equal(calls, 2);
  await capture(s, cid);
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "idle",
  );
  assert.equal(calls, 2);
});
test("evidência insuficiente reativa só após mudança material; decisão editorial rejeitada não é desfeita", async () => {
  const s = await source(),
    cid = await add(s);
  await capture(s, cid, "Texto curto.");
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "blocked",
  );
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "idle",
  );
  assert.equal(calls, 0);
  await capture(s, cid);
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "validated",
  );
  assert.equal(
    (
      await req(`/api/admin/synopses/${cid}/reject`, "POST", {
        reason:
          "Rejeição editorial explícita para preservar a decisão do proprietário.",
      })
    ).status,
    200,
  );
  await permissions(s, false);
  await permissions(s, true);
  await capture(
    s,
    cid,
    evidenceText + " O texto inclui uma nova seção de exemplos de leitura.",
  );
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "idle",
  );
  assert(!(await visible(cid)));
  assert.equal(calls, 2);
});
test("revogação/reaprovação não ressuscita autorização antiga; texto e histórico são preservados", async () => {
  let s = await source();
  const cid = await add(s);
  await capture(s, cid);
  await processSynopsis(env, Date.now(), noNetwork);
  assert(await visible(cid));
  const before = calls;
  s = await permissions(s, false);
  assert(!(await visible(cid)));
  assert.equal((await content(env.DB, cid)).synopsis, null);
  await assert.rejects(() => validateSynopsis(env.DB, cid, review));
  s = await permissions(s, true);
  assert(!(await visible(cid)));
  assert.equal(
    (
      await processSynopsis(
        env,
        Date.now(),
        async () =>
          new Response(
            "<rss><channel><title>Feed sem o artigo antigo</title></channel></rss>",
          ),
      )
    ).status,
    "blocked",
  );
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "idle",
  );
  assert.equal(calls, before);
  assert.equal(
    (
      await first<any>(
        env.DB,
        "SELECT text FROM content_synopses WHERE content_id=?",
        cid,
      )
    ).text,
    synopsis,
  );
  assert(
    (
      await first<any>(
        env.DB,
        "SELECT COUNT(*) n FROM synopsis_history WHERE content_id=?",
        cid,
      )
    ).n > 0,
  );
  await capture(s, cid);
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "validated",
  );
  assert.equal(calls, before + 2);
});
test("evidência editorial independente mantém autorização após mudança de direitos da fonte", async () => {
  const s = await source(),
    cid = await add(s);
  const independent: Evidence = {
    text: evidenceText,
    url: (await content(env.DB, cid)).url,
    rightsNote:
      "Notas factuais originais do LASTRO autorizadas para processamento.",
    retrievedAt: now(),
    kind: "editorial_evidence",
  };
  await setSynopsisEvidence(env.DB, cid, independent);
  await processSynopsis(env, Date.now(), noNetwork);
  assert(await visible(cid));
  await permissions(s, false);
  assert(await visible(cid));
  assert.equal((await content(env.DB, cid)).synopsis?.text, synopsis);
  const before = calls;
  assert(
    (
      await setSynopsisEvidence(env.DB, cid, {
        ...independent,
        retrievedAt: now(),
      })
    ).unchanged,
  );
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "idle",
  );
  assert.equal(calls, before);
});
test("restrição específica nova invalida evidência dependente, sem gravar texto proibido nem repetir chamadas", async () => {
  const s = await source(),
    cid = await add(s);
  await capture(s, cid);
  await processSynopsis(env, Date.now(), noNetwork);
  assert(await visible(cid));
  await capture(
    s,
    cid,
    evidenceText,
    licence + " All rights reserved. No adaptations.",
  );
  const cached = await first<any>(
    env.DB,
    "SELECT * FROM synopsis_evidence_cache WHERE source_id=?",
    s.id,
  );
  assert.equal(cached.evidence_json, null);
  assert.equal(cached.block_code, "rights");
  assert(!(await visible(cid)));
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "blocked",
  );
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "idle",
  );
  assert.equal(calls, 2);
  assert(
    (
      await first<any>(
        env.DB,
        "SELECT COUNT(*) n FROM synopsis_history WHERE source_id=? AND event='discovery'",
        s.id,
      )
    ).n > 0,
  );
});

test("alteração apenas de espaços/data de coleta é idempotente; licença material diferente é registrada", async () => {
  const s = await source(),
    cid = await add(s);
  const e: Evidence = {
    text: evidenceText,
    url: (await content(env.DB, cid)).url,
    rightsNote: "Evidência original do LASTRO autorizada para este teste.",
    retrievedAt: now(),
    kind: "editorial_evidence",
  };
  await setSynopsisEvidence(env.DB, cid, e);
  await processSynopsis(env, Date.now(), noNetwork);
  assert(
    (
      await setSynopsisEvidence(env.DB, cid, {
        ...e,
        text: e.text.replaceAll(" ", "  \n"),
        retrievedAt: now(),
      })
    ).unchanged,
  );
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "idle",
  );
  assert.equal(calls, 2);
  assert.equal(
    (await setSynopsisEvidence(env.DB, cid, { ...e, licenseUrl: licence }))
      .status,
    "pending",
  );
  assert(
    (
      await first<any>(
        env.DB,
        "SELECT COUNT(*) n FROM synopsis_history WHERE content_id=?",
        cid,
      )
    ).n > 0,
  );
});

test("mudança de restrição do item durante IA cancela publicação e não repete a inferência", async () => {
  const s = await source(),
    cid = await add(s);
  await capture(s, cid);
  env.AI = {
    run: async (model) => {
      calls++;
      if (model.includes("3.2-3b")) {
        await capture(s, cid, evidenceText, "All rights reserved");
        return { response: synopsis };
      }
      return { response: JSON.stringify(report()) };
    },
  };
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "stale",
  );
  assert(!(await visible(cid)));
  const before = calls;
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "blocked",
  );
  assert.equal(calls, before);
});

test("revogação durante geração impede publicação mesmo com verificador positivo", async () => {
  const s = await source(),
    cid = await add(s);
  await capture(s, cid);
  env.AI = {
    run: async (model) => {
      calls++;
      if (model.includes("3.2-3b")) {
        await permissions(s, false);
        return { response: synopsis };
      }
      return { response: JSON.stringify(report()) };
    },
  };
  assert.equal(
    (await processSynopsis(env, Date.now(), noNetwork)).status,
    "stale",
  );
  assert(!(await visible(cid)));
  const before = calls;
  await processSynopsis(env, Date.now(), noNetwork);
  assert.equal(calls, before);
});

test("descoberta licenciada com duas entradas e cron permanece abaixo de 50 consultas D1", async () => {
  const s = await source();
  let queries = 0;
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
      const value = (target as any)[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const xml = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Fixture</title><language>pt</language>${[1, 2].map((n) => `<item><title>Design de interfaces financeiras ${n}</title><link>https://fixtures.example.test/${s.id}/${n}</link><guid>${s.id}-${n}</guid><dc:creator>Autora de Teste</dc:creator><pubDate>Mon, 19 Oct 2026 12:00:00 GMT</pubDate><content:encoded><![CDATA[<p>${evidenceText}</p>]]></content:encoded></item>`).join("")}</channel></rss>`;
  await scheduledIngest({ ...env, DB: db }, async () => new Response(xml));
  assert(queries <= 50, `D1: ${queries} consultas`);
  console.info(`D1 cron com captura licenciada: ${queries} consultas`);
  await stmt(
    env.DB,
    "UPDATE contents SET editorial_status='pending' WHERE source_id=?",
    s.id,
  ).run();
  queries = 0;
  const tomorrow = Date.now() + 86400001;
  await scheduledIngest(
    { ...env, DB: db },
    async () => new Response(xml),
    tomorrow,
  );
  assert(queries <= 50, `D1 reavaliação: ${queries} consultas`);
  assert.equal(
    (
      await first<any>(
        env.DB,
        "SELECT COUNT(*) n FROM contents WHERE source_id=? AND editorial_status='pending'",
        s.id,
      )
    ).n,
    1,
  );
  console.info(`D1 cron com reavaliação de existente: ${queries} consultas`);
  assert.equal(
    (
      await first<any>(
        env.DB,
        "SELECT COUNT(*) n FROM synopsis_evidence_cache WHERE source_id=?",
        s.id,
      )
    ).n,
    2,
  );
});

test("migração preserva 16 sinopses legadas, favoritos, seleção e 50/50 sem liberar bloqueados", async () => {
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
    await migrate(db, "0006_synopsis_verification.sql");
    const sources = [false, true].map((allowed) => ({
      ...fixtureSource,
      id: id(),
      url: `https://fixtures.example.test/legacy/${id()}`,
      summaryAllowed: false,
      synopsisAllowed: allowed,
      synopsisRightsNote:
        "Evidência legada licenciada para este teste de preservação.",
      synopsisLicenseUrl: licence,
    }));
    for (const s of sources)
      await stmt(
        db,
        "INSERT INTO sources(id,name,connector,url,status,config_json,created_at) VALUES (?,?,?,?,'approved',?,?)",
        s.id,
        s.name,
        s.connector,
        s.url,
        JSON.stringify(s),
        now(),
      ).run();
    const ids: string[] = [];
    for (let n = 0; n < 17; n++) {
      const cid = id(),
        s = sources[n < 8 ? 0 : 1];
      ids.push(cid);
      const c = {
        ...fixtureCandidate,
        url: `https://fixtures.example.test/legacy-content/${n}/`,
        language: n < 8 ? "pt" : "en",
      };
      await stmt(
        db,
        "INSERT INTO contents(id,source_id,canonical_url,title,metadata_json,published_at,collected_at,kind,language,editorial_status,quality_score,quality_json) VALUES (?,?,?,?,?,?,?,'article',?,'approved',80,?)",
        cid,
        s.id,
        c.url.slice(0, -1),
        c.title,
        JSON.stringify(c),
        c.publishedAt,
        now(),
        c.language,
        JSON.stringify(contentFixture().quality),
      ).run();
      const e = {
        text: evidenceText,
        url: c.url,
        rightsNote: s.synopsisRightsNote,
        retrievedAt: now(),
        kind: n < 8 ? "editorial_evidence" : "authorized_feed_description",
        ...(n >= 8 ? { licenseUrl: licence } : {}),
      };
      await stmt(
        db,
        "INSERT INTO content_synopses(content_id,status,text,metadata_json,evidence_json,attempts,updated_at,validated_at,validation_mode) VALUES (?,?,?,?,?,1,?,?,?)",
        cid,
        n < 16 ? "validated" : "blocked",
        n < 16 ? synopsis : null,
        JSON.stringify(c),
        n < 16 ? JSON.stringify(e) : null,
        now(),
        n < 16 ? now() : null,
        "editorial",
      ).run();
    }
    await stmt(
      db,
      "INSERT INTO favorites VALUES (?,?,?)",
      "owner",
      ids[0],
      now(),
    ).run();
    await stmt(
      db,
      "INSERT INTO workshop_selection VALUES (?,?,?,?)",
      "owner",
      ids[1],
      0,
      now(),
    ).run();
    for (const sql of migrationStatements(
      await readFile("migrations/0007_synopsis_autonomy.sql", "utf8"),
    ))
      await db.prepare(sql).run();
    const eligible = await rows<any>(
      db,
      `SELECT c.id,c.language FROM contents c WHERE ${synopsisGate}`,
    );
    assert.equal(eligible.length, 16);
    assert.equal(eligible.filter((c) => c.language === "pt").length, 8);
    assert.equal(
      (
        await first<any>(
          db,
          "SELECT COUNT(*) n FROM content_synopses WHERE status='validated' AND text=?",
          synopsis,
        )
      ).n,
      16,
    );
    assert.equal(
      (
        await first<any>(
          db,
          "SELECT status FROM content_synopses WHERE content_id=?",
          ids[16],
        )
      ).status,
      "blocked",
    );
    assert.equal(
      (await first<any>(db, "SELECT COUNT(*) n FROM favorites")).n,
      1,
    );
    assert.equal(
      (await first<any>(db, "SELECT COUNT(*) n FROM workshop_selection")).n,
      1,
    );
  } finally {
    await isolated.dispose();
  }
});
test("concorrência e vários ciclos processam uma vez e publicam lote PT/EN com 50/50", async () => {
  const s = await source(),
    a = await add(s, "pt"),
    b = await add(s, "en");
  await capture(s, a);
  await capture(s, b);
  const result = await Promise.all([
    processSynopsis(env, Date.now(), noNetwork),
    processSynopsis(env, Date.now(), noNetwork),
    processSynopsis(env, Date.now(), noNetwork),
  ]);
  assert.equal(result.filter((r) => r.status === "validated").length, 2);
  assert.equal(calls, 4);
  for (let n = 0; n < 6; n++)
    await scheduledSynopses(env, Date.now() + n * 300000);
  assert.equal(calls, 4);
  const feed: any = await (await req("/api/feed?limit=20")).json();
  assert.equal(feed.items.length, 2);
  assert.equal(
    feed.items.filter((i: any) => i.content.language === "pt").length,
    1,
  );
});
test("orçamento diário retoma no dia seguinte; falha antes da IA tem backoff limitado, depois da IA não repete", async () => {
  const s = await source(),
    cid = await add(s);
  await capture(s, cid);
  const clock = Date.now(),
    day = new Date(clock).toISOString().slice(0, 10);
  await stmt(
    env.DB,
    "INSERT INTO synopsis_usage(day,reserved_neurons,calls) VALUES (?,4500,15)",
    day,
  ).run();
  for (let n = 0; n < 3; n++)
    assert.equal(
      (await processSynopsis(env, clock + n * 300000, noNetwork)).status,
      "pending",
    );
  assert.equal(calls, 0);
  const tomorrow = Date.parse(day + "T00:00:00Z") + 86400000;
  assert.equal(
    (await processSynopsis(env, tomorrow, noNetwork)).status,
    "validated",
  );
  assert.equal(calls, 2);
  const other = await add(s);
  let fetched = 0;
  const forbidden = async () => {
    fetched++;
    return new Response("", { status: 403 });
  };
  assert.equal((await processSynopsis(env, clock, forbidden)).status, "failed");
  assert.equal((await processSynopsis(env, clock, forbidden)).status, "idle");
  await processSynopsis(env, clock + 900001, forbidden);
  await processSynopsis(env, clock + 2700002, forbidden);
  assert.equal(
    (await processSynopsis(env, clock + 99999999, forbidden)).status,
    "idle",
  );
  assert.equal(fetched, 3);
  await capture(s, other);
  env.AI = {
    run: async () => {
      calls++;
      throw Error("429 neuron quota");
    },
  };
  assert.equal(
    (await processSynopsis(env, tomorrow, noNetwork)).status,
    "failed",
  );
  const after = calls;
  assert.equal(
    (await processSynopsis(env, tomorrow + 900000, noNetwork)).status,
    "idle",
  );
  assert.equal(calls, after);
});
test("parecer positivo com citação real não aprova causalidade, exagero, datas trocadas ou números parciais", () => {
  for (const text of [
    synopsis.replace("examina", "comprova"),
    synopsis.replace("examina", "demonstra"),
    synopsis.replace("aborda diferenças", "garante melhorias"),
    synopsis.replace("O leitor encontra", "Todos os leitores encontram"),
    synopsis.replace(
      "O leitor encontra",
      "A tipografia reduziu erros e oferece",
    ),
  ])
    assert(!supportedReport(report(text), text, evidenceText), text);
  assert(
    anchorErrors(
      "O artigo apresenta 10 exemplos.",
      "O artigo apresenta 100 exemplos.",
    ).length,
  );
  assert(
    anchorErrors(
      "O artigo apresenta oito exemplos.",
      "O artigo apresenta sete exemplos.",
    ).length,
  );
  assert(
    anchorErrors(
      "O artigo descreve a edição de 14 de junho de 2026.",
      "Houve edições em 14 de dezembro de 2026 e 18 de junho de 2026.",
    ).length,
  );
  assert(
    !supportedReport(
      report(
        "O artigo descreve 12 exemplos.",
        "A publicação oferece oito exemplos de interfaces financeiras e discute legibilidade.",
      ),
      "O artigo descreve 12 exemplos.",
      "A publicação oferece oito exemplos de interfaces financeiras e discute legibilidade. Em outra seção constam 12 participantes.",
    ),
  );
  assert(
    automaticFactualErrors("A interface é azul e tem leitura perfeita.").length,
  );
  const denied =
    "The publication analyzes chatbot responses but does not assess electoral compliance or political favouritism.";
  const claim = "O artigo analisa a conformidade eleitoral das plataformas.";
  assert(!supportedReport(report(claim, denied), claim, denied));
  const longTitle =
    "Design de interfaces tipográficas financeiras entre diferentes experiências de leitura visual clareza informação espaços caracteres dígitos símbolos digitais confiança comunicação legibilidade cultura criação tecnologia criatividade percepção humana";
  assert.equal(
    sufficientEvidence((longTitle + " ").repeat(4), longTitle),
    false,
  );
});
