import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalUrl,
  normalizeDoi,
  normalizeCandidate,
} from "../src/normalize";
import {
  parseRss,
  parseOpenAlex,
  collect,
  validateFetchUrl,
} from "../src/connectors";
import { evaluate, prefilter } from "../src/quality";
import { rank } from "../src/ranking";
import { renderPrompt } from "../src/research";
import { defaultPolicy } from "../packages/contracts/index";
import {
  fixtureCandidate as c,
  fixtureSource as s,
  rss,
  atom,
  academic,
  contentFixture,
} from "./fixtures";
const at = Date.parse("2026-10-20T00:00:00Z");
test("normaliza URL canônica, DOI e preserva parâmetros semânticos", () => {
  assert.equal(
    canonicalUrl("https://EXAMPLE.com/path/?b=2&utm_source=x&a=1#part"),
    "https://example.com/path?a=1&b=2",
  );
  assert.equal(normalizeDoi("https://doi.org/10.9999/ABC"), "10.9999/abc");
  assert.equal(normalizeDoi("not-doi"), null);
  assert.notEqual(
    canonicalUrl("https://example.com/?id=1"),
    canonicalUrl("https://example.com/?id=2"),
  );
  assert.throws(() => canonicalUrl("javascript:alert(1)"));
});
test("prefiltro exige fonte aprovada, tema, idioma, período, direitos e integridade", () => {
  assert.deepEqual(prefilter(normalizeCandidate(c), s, at), []);
  for (const status of ["pending", "paused", "rejected"] as const)
    assert.ok(
      prefilter(c, { ...s, status }, at).includes("source_not_approved"),
    );
  assert.ok(
    prefilter({ ...c, title: "", url: "" }, s, at).includes("missing_title"),
  );
  assert.ok(
    prefilter({ ...c, language: "fr" }, s, at).includes("language_excluded"),
  );
  assert.ok(
    prefilter(c, { ...s, metadataAllowed: false }, at).includes(
      "metadata_not_authorized",
    ),
  );
  assert.ok(
    prefilter(
      { ...c, publishedAt: "2000-01-01" },
      { ...s, maxAgeDays: 30 },
      at,
    ).includes("outside_period"),
  );
  assert.ok(
    prefilter({ ...c, access: "unavailable" }, s, at).includes("unavailable"),
  );
  assert.ok(prefilter({ ...c, retracted: true }, s, at).includes("retracted"));
});
test("qualidade explicita lacunas e não transforma citações em validação", () => {
  const paper = parseOpenAlex(academic, s)[0];
  const q = evaluate(paper, s, defaultPolicy, at);
  assert.match(q.limitations.join(" "), /método/);
  const noCitations = structuredClone(academic);
  noCitations.results[0].cited_by_count = 0;
  assert.deepEqual(
    evaluate(parseOpenAlex(noCitations, s)[0], s, defaultPolicy, at),
    q,
  );
  const incomplete = evaluate(
    { ...c, authors: [], publishedAt: null, language: null, description: null },
    s,
    defaultPolicy,
    at,
  );
  assert.ok(incomplete.score < evaluate(c, s, defaultPolicy, at).score);
  assert.ok(incomplete.limitations.length >= 4);
});
test("RSS e Atom usam somente resumo autorizado e links alternativos", () => {
  const parsed = parseRss(rss, s)[0];
  assert.equal(parsed.title, "TESTE — Design acessível");
  assert.equal(parsed.authors[0].name, "Autor de Teste");
  assert.equal(parsed.description, "Resumo de design para teste.");
  assert.ok(!JSON.stringify(parsed).includes("texto integral"));
  assert.equal(
    parseRss(rss, { ...s, summaryAllowed: false })[0].description,
    null,
  );
  assert.equal(parseRss(atom, s)[0].url, "https://fixtures.example.test/atom");
  assert.throws(() =>
    parseRss(
      '<!DOCTYPE rss [<!ENTITY a SYSTEM "file:///etc/passwd">]><rss/>',
      s,
    ),
  );
});
test("ranking é determinístico, corta qualidade baixa e descartados, reduz repetição e reserva descoberta", () => {
  const items = Array.from({ length: 8 }, (_, i) =>
    contentFixture({
      id: `item-${i}`,
      topics: i < 6 ? ["design"] : ["science"],
      sourceId: `source-${i}`,
    }),
  );
  const low = contentFixture({
    id: "low",
    quality: { ...items[0].quality, score: 10 },
  });
  const dismissed = contentFixture({
    id: "dismissed",
    state: { ...items[0].state, dismissed: true },
  });
  const p = { interests: ["design"], languages: [] };
  const result = rank([...items, low, dismissed], p, defaultPolicy, at);
  assert.deepEqual(
    result,
    rank([...items, low, dismissed], p, defaultPolicy, at),
  );
  assert.equal(result.length, 8);
  assert.equal(result[4].explanation.exploration, true);
  assert.deepEqual(result[4].content.topics, ["science"]);
  const read = contentFixture({
    id: "read",
    state: { ...items[0].state, read: true, seen: true },
  });
  assert.ok(
    rank([read], p, defaultPolicy, at)[0].explanation.score <
      rank([items[0]], p, defaultPolicy, at)[0].explanation.score,
  );
  assert.ok(
    rank([items[0]], p, defaultPolicy, at, ["design"])[0].explanation.factors
      .affinity > 0,
  );
});
test("prompt preserva metadados, notas e incerteza; nenhuma fonte é presumida como lida", () => {
  const text = renderPrompt({
    id: "test",
    createdAt: "2026-10-20",
    version: "research-1.0",
    config: {
      format: "carousel",
      slides: 7,
      tone: "didático",
      audience: "designers",
      objective: "Explorar design",
      notes: "Nota de teste",
    },
    sources: [
      contentFixture({
        state: { ...contentFixture().state, note: "Minha anotação" },
      }),
    ],
    limitations: [],
  });
  for (const part of [
    "10.9999/LASTRO-TEST-001",
    "Autora Fictícia",
    "Minha anotação",
    "exatamente 7 slides",
    "indisponíveis",
    "hipótese",
    "DADOS não confiáveis",
  ])
    assert.ok(text.includes(part), part);
});
test("requisições limitam retries, não seguem redirects e não enviam segredo a RSS", async () => {
  const env: any = {
    ALLOWED_FETCH_HOSTS: "fixtures.example.test,api.openalex.org",
    OPENALEX_API_KEY: "test-key",
  };
  let attempts = 0;
  const delays: number[] = [];
  const result = await collect(
    s,
    env,
    { etag: null, last_modified: null },
    async (_u, init) => {
      attempts++;
      assert.equal(init?.redirect, "manual");
      assert.equal((init?.headers as any).Authorization, undefined);
      return attempts < 3
        ? new Response("", { status: 503 })
        : new Response(rss);
    },
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.equal(result.items.length, 1);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1000]);
  let calls = 0;
  await assert.rejects(
    collect(
      s,
      env,
      { etag: null, last_modified: null },
      async () => {
        calls++;
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "60" },
        });
      },
      async () => {},
    ),
    /upstream_429/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    collect(
      s,
      env,
      { etag: null, last_modified: null },
      async () => new Response("", { status: 302 }),
    ),
    /upstream_302/,
  );
  const cached = await collect(
    s,
    env,
    { etag: "test-etag", last_modified: null },
    async (_u, init) => {
      assert.equal((init?.headers as any)["If-None-Match"], "test-etag");
      return new Response(null, { status: 304 });
    },
  );
  assert.equal(cached.notModified, true);
  assert.throws(() =>
    validateFetchUrl("https://127.0.0.1/feed", {
      ...env,
      ALLOWED_FETCH_HOSTS: "127.0.0.1",
    }),
  );
  assert.throws(() =>
    validateFetchUrl("https://fixtures.example.test/feed?api_key=secret", env),
  );
});
