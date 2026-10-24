import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  sourceInputSchema,
  candidateSchema,
  defaultPolicy,
} from "../packages/contracts";
import { automaticReviewReasons, evaluate } from "../src/quality";
import { fixtureCandidate, fixtureSource } from "./fixtures";
import { migrationStatements } from "./migration-statements";
import { scheduledIngest } from "../src/ingestion";
import { processSynopsis, synopsisOverview } from "../src/synopses";
import { first, rows, stmt, id, now } from "../src/db";
import { app } from "../src/index";
import { verifierSchema, supportedReport } from "../src/synopsis-verification";
import type { Env } from "../src/env";

test("convites e anúncios promocionais não são aprovados automaticamente", () => {
  for (const title of [
    "Inscrições abertas para o encontro de design",
    "Chamada aberta: inscreva seu projeto de design",
    "Prêmio de design divulga projetos finalistas",
    "Register now for the design conference",
    "Five insights from our brand refresh",
  ]) {
    const c = { ...fixtureCandidate, title };
    assert(
      automaticReviewReasons(
        c,
        fixtureSource,
        defaultPolicy,
        evaluate(c, fixtureSource, defaultPolicy),
      ).includes("promotional_material"),
    );
  }
  assert(
    !automaticReviewReasons(
      fixtureCandidate,
      fixtureSource,
      defaultPolicy,
      evaluate(fixtureCandidate, fixtureSource, defaultPolicy),
    ).includes("promotional_material"),
  );
});

test("formato do verificador exige cobertura completa sem forçar suporte positivo", () => {
  const schema = verifierSchema(3);
  assert.equal(schema.properties.sentences.minItems, 3);
  assert.equal(schema.properties.sentences.maxItems, 3);
  assert.deepEqual(schema.properties.sentences.items.properties.supported, {
    type: "boolean",
  });
  assert.equal(schema.properties.sentences.items.properties.quotes.maxItems, 2);
  assert(
    !supportedReport(
      {
        portuguese: true,
        informative: true,
        uncertain: false,
        sentences: [
          {
            index: 0,
            supported: true,
            quotes: ["Exemplo sintético de evidência autorizada."],
          },
        ],
      },
      "O texto aborda escolhas. O autor discute interfaces. O enfoque está na leitura.",
      "Exemplo sintético de evidência autorizada.",
    ),
  );
});

test("fontes reais: ciclos sucessivos, publicação, 50/50, persistência e observabilidade", async () => {
  // Metadata and minimal licensed excerpts are real. AI responses are mocks;
  // production inference is measured separately, never inferred from this test.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
    }),
  );
  try {
    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    for (const f of (await readdir("migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      for (const sql of migrationStatements(
        await readFile(`migrations/${f}`, "utf8"),
      ))
        await db.prepare(sql).run();
    let calls = 0,
      queries = 0;
    const measuredDB = new Proxy(db, {
      get(target, key) {
        if (key === "batch")
          return (ss: D1PreparedStatement[]) => {
            queries += ss.length;
            return target.batch(ss);
          };
        if (key === "prepare")
          return (sql: string) => {
            const track = (s: any): any =>
              new Proxy(s, {
                get(obj, k) {
                  if (k === "bind")
                    return (...args: unknown[]) => track(obj.bind(...args));
                  if (["run", "all", "first", "raw"].includes(String(k)))
                    return (...args: unknown[]) => {
                      queries++;
                      return obj[k](...args);
                    };
                  return typeof obj[k] === "function"
                    ? obj[k].bind(obj)
                    : obj[k];
                },
              });
            return track(target.prepare(sql));
          };
        const value = (target as any)[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const drafts = [
      "O texto discute os desafios de mapear terreiros e registrar dados sobre religiões de matriz africana. Seu enfoque relaciona a invisibilidade dessas informações ao histórico de repressão e ao receio de retaliações. A autora aborda os obstáculos sociais que atravessam o mapeamento da fé.",
      "O artigo aborda uma discussão internacional sobre acesso ao patrimônio cultural. As autoras apresentam a passagem de um diálogo exploratório para uma mesa de debate com representantes públicos e defensores da cultura aberta. O enfoque está nos caminhos institucionais para ampliar essa conversa na UNESCO.",
    ];
    const env: Env = {
      DB: measuredDB,
      ENVIRONMENT: "development",
      DEV_TOKEN: "sustainable-test-fixture-not-a-secret-123456",
      INGEST_ENABLED: "true",
      SYNOPSIS_ENABLED: "true",
      SYNOPSIS_REQUIRED: "true",
      ALLOWED_FETCH_HOSTS: "escoladedados.org,creativecommons.org",
      AI: {
        run: async (model, input) => {
          calls++;
          const data = JSON.parse(input.messages.at(-1)!.content);
          if (model.includes("3.2-3b"))
            return {
              response: drafts[data.evidence.includes("Iemanjá") ? 0 : 1],
              usage: { neurons: 5 },
            };
          const schema = input.response_format?.json_schema as any;
          assert.equal(
            schema.properties.sentences.minItems,
            data.SENTENCES.length,
          );
          assert.equal(
            schema.properties.sentences.maxItems,
            data.SENTENCES.length,
          );
          return {
            response: JSON.stringify({
              portuguese: true,
              informative: true,
              uncertain: false,
              sentences: data.SENTENCES.map(({ index }: { index: number }) => ({
                index,
                supported: true,
                quotes: [data.EVIDENCE.slice(-990)],
              })),
            }),
            usage: { neurons: 8 },
          };
        },
      },
    };
    const feeds = new Map<string, string>();
    const sources: string[] = [];
    for (const n of [21, 22]) {
      const input = sourceInputSchema.parse(
        JSON.parse(await readFile(`examples/catalog/${n}.json`, "utf8")),
      );
      const f = JSON.parse(
        await readFile(`tests/fixtures/source-${n}-licensed.json`, "utf8"),
      );
      const c = candidateSchema.parse(f.candidate),
        sid = id();
      sources.push(sid);
      assert.equal(f.licenseUrl, input.synopsisLicenseUrl);
      assert(f.evidence.length <= 1200);
      await stmt(
        db,
        "INSERT INTO sources(id,name,connector,url,status,config_json,created_at) VALUES (?,?,?,?,'approved',?,?)",
        sid,
        input.name,
        input.connector,
        input.url,
        JSON.stringify(input),
        now(),
      ).run();
      const esc = (v: string) =>
        v.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
      feeds.set(
        input.url,
        `<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${esc(input.name)}</title><language>${c.language}</language><item><title>${esc(c.title)}</title><link>${esc(c.url)}</link><guid>${esc(c.url)}</guid><dc:creator>${esc(c.authors[0].name)}</dc:creator><pubDate>${c.publishedAt}</pubDate><description><![CDATA[${f.evidence}]]></description>${c.topics.map((t) => `<category>${esc(t)}</category>`).join("")}</item></channel></rss>`,
      );
    }
    const fetcher = async (url: string | URL | Request) =>
      new Response(feeds.get(String(url))!, {
        headers: { "Content-Type": "application/rss+xml" },
      });
    for (let cycle = 0; cycle < 2; cycle++) {
      queries = 0;
      await scheduledIngest(env, fetcher);
      assert(queries <= 50, `discovery cycle ${cycle}: ${queries}`);
      queries = 0;
      assert.equal(
        (await processSynopsis(env, Date.now(), fetcher)).status,
        "validated",
      );
      assert(queries + 2 <= 50, `synopsis + scheduler: ${queries + 2}`);
    }
    assert.equal(calls, 4);
    const snapshot = await rows<any>(
      db,
      "SELECT content_id,text FROM content_synopses ORDER BY content_id",
    );
    for (let cycle = 1; cycle <= 2; cycle++) {
      const clock = Date.now() + cycle * 86400001;
      for (let s = 0; s < 2; s++) {
        queries = 0;
        await scheduledIngest(env, fetcher, clock);
        assert(queries <= 50);
      }
      assert.equal((await processSynopsis(env, clock, fetcher)).status, "idle");
    }
    assert.equal(calls, 4, "recollection never repeats AI");
    assert.deepEqual(
      await rows(
        db,
        "SELECT content_id,text FROM content_synopses ORDER BY content_id",
      ),
      snapshot,
    );
    assert.equal(
      (await first<any>(db, "SELECT COUNT(*) n FROM synopsis_evidence_cache"))!
        .n,
      2,
    );
    const request = async (path: string) =>
      await app.request(
        "http://localhost" + path,
        { headers: { Authorization: `Bearer ${env.DEV_TOKEN}` } },
        env,
      );
    const feed = (await (await request("/api/feed?limit=20")).json()) as any;
    assert.equal(feed.items.length, 2);
    assert.equal(
      feed.items.filter((i: any) => i.content.language === "pt").length,
      1,
    );
    const overview = (await synopsisOverview(db)) as any;
    assert.equal(overview.impact.publishedLast7Days, 2);
    assert.equal(
      overview.counts.find((c: any) => c.status === "validated").count,
      2,
    );
    const ss = (await (await request("/api/admin/sources")).json()) as any;
    assert(
      ss.items.every(
        (s: any) => s.lastSuccessAt && s.lastReferenceAt && s.queued === 0,
      ),
    );
    await stmt(
      db,
      "UPDATE content_synopses SET status='blocked',block_code='rights' WHERE content_id=?",
      snapshot[0].content_id,
    ).run();
    const blocked = (await synopsisOverview(db)) as any;
    assert.equal(
      blocked.counts.find((c: any) => c.status === "blocked").rights,
      1,
    );
    console.info(
      "Fontes reais + IA simulada: 2 publicações em ciclos sucessivos; recolheita idempotente; consultas D1 <50.",
    );
  } finally {
    await mf.dispose();
  }
});
