import {
  candidateSchema,
  sourceInputSchema,
  type Source,
  type Content,
  defaultPolicy,
} from "../packages/contracts/index";
export const fixtureSource: Source = {
  ...sourceInputSchema.parse({
    name: "TESTE — Revista de Design",
    connector: "rss",
    url: "https://fixtures.example.test/feed.xml",
    authority: 85,
    topics: ["design", "branding", "science"],
    languages: ["pt", "en"],
    summaryAllowed: true,
    rightsNote: "Fixture sintética autorizada para testes.",
    autoApprove: true,
  }),
  id: "10000000-0000-4000-8000-000000000001",
  status: "approved",
  createdAt: "2026-10-20T00:00:00.000Z",
  nextFetchAt: null,
};
export const fixtureCandidate = candidateSchema.parse({
  title: "TESTE — Design de informação e pesquisa visual",
  url: "https://fixtures.example.test/design?utm_source=teste",
  authors: [
    { name: "Autora Fictícia", orcid: "https://orcid.org/0000-0000-0000-0000" },
  ],
  publication: "TESTE — Revista de Design",
  publishedAt: "2026-10-19",
  kind: "article",
  language: "pt",
  description:
    "Resumo sintético de teste sobre design, sem alegação de resultado científico.",
  identifiers: [
    { scheme: "doi", value: "https://doi.org/10.9999/LASTRO-TEST-001" },
  ],
  topics: ["design"],
  access: "restricted",
  accessNote: "Fixture simula acesso restrito, sem acesso ao texto integral.",
});
export const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>TESTE — Revista</title><language>pt-BR</language><item><title>TESTE — Design acessível</title><link>https://fixtures.example.test/rss-1?utm_medium=test</link><dc:creator>Autor de Teste</dc:creator><pubDate>Mon, 19 Oct 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>Resumo de design para teste.</p>]]></description><guid>rss-1</guid><category>design</category><content:encoded>Não armazenar texto integral</content:encoded></item></channel></rss>`;
export const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en"><title>TEST Atom</title><entry><title>Design test</title><link rel="self" href="https://fixtures.example.test/api"/><link rel="alternate" href="https://fixtures.example.test/atom"/><author><name>Test Author</name></author><published>2026-10-19T00:00:00Z</published><summary>Design summary</summary><id>atom-1</id></entry></feed>`;
export const academic = {
  results: [
    {
      id: "https://openalex.org/W999999999999",
      doi: "https://doi.org/10.9999/test-paper",
      display_name: "TEST — Design research",
      publication_date: "2026-10-18",
      language: "en",
      authorships: [
        {
          author: {
            display_name: "Test Researcher",
            id: "https://openalex.org/A999999999999",
          },
        },
      ],
      primary_location: {
        landing_page_url: "https://fixtures.example.test/paper",
        source: { display_name: "TEST Journal" },
        license: "cc-by",
      },
      open_access: { is_oa: true },
      topics: [{ display_name: "design" }],
      cited_by_count: 999999,
      is_retracted: false,
    },
  ],
};
export function contentFixture(overrides: Partial<Content> = {}): Content {
  return {
    ...fixtureCandidate,
    id: crypto.randomUUID(),
    sourceId: fixtureSource.id,
    sourceName: fixtureSource.name,
    canonicalUrl: fixtureCandidate.url,
    collectedAt: "2026-10-20T00:00:00Z",
    editorialStatus: "approved",
    quality: {
      version: defaultPolicy.version,
      score: 80,
      factors: {
        authority: 85,
        material: 70,
        relevance: 100,
        originality: 50,
        freshness: 90,
      },
      limitations: [],
    },
    state: {
      favorite: false,
      selected: false,
      seen: false,
      opened: false,
      read: false,
      dismissed: false,
      used: false,
      note: null,
    },
    annotations: [],
    ...overrides,
  };
}
