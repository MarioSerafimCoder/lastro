// Validação opt-in local. Aprova somente dois artigos cuja procedência foi conferida em 21/10/2026.
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:8787";
const token = (await readFile(".dev.vars", "utf8"))
  .match(/^DEV_TOKEN=(.+)$/m)?.[1]
  .trim();
if (!token) throw Error("Execute npm run setup.");
async function call(path, method = "GET", body) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = r.status === 204 ? null : await r.json();
  if (!r.ok) throw Error(`${r.status} ${JSON.stringify(data)}`);
  return data;
}
const config = JSON.parse(await readFile("examples/catalog/02.json", "utf8"));
let source = (await call("/admin/sources?limit=50")).items.find(
  (s) => s.url === config.url,
);
if (!source) source = await call("/admin/sources", "POST", config);
if (source.status !== "approved")
  await call(`/admin/sources/${source.id}/status`, "PATCH", {
    status: "approved",
    reason:
      "Demonstração local: RSS oficial e página de assinatura conferidos; somente metadados sem reprodução do texto.",
  });
const runs = [];
let queue = (await call("/admin/candidates?limit=50")).items.filter(
  (c) => c.sourceId === source.id,
);
if (!queue.length) {
  runs.push(await call(`/admin/sources/${source.id}/ingest`, "POST"));
  queue = (await call("/admin/candidates?limit=50")).items.filter(
    (c) => c.sourceId === source.id,
  );
}
const approved = [];
for (const [slug, author] of [
  ["good-designers-bad-websites-a-proposal", "Alan Dalton"],
  ["designed-for-a-dead-language", "Shrey Shah"],
]) {
  const item = queue.find((c) => c.metadata.url.includes("/" + slug));
  assert.ok(
    item,
    "Artigo conferido não encontrado no lote; não aprovar substituto automaticamente.",
  );
  const result = await call(`/admin/candidates/${item.id}/review`, "POST", {
    decision: "approved",
    reason:
      "Demonstração local: título, autoria, data, idioma e pertinência conferidos na página original " +
      item.metadata.url +
      ". Autoria corrigida porque o feed informava apenas by. Texto não auditado integralmente; não constitui evidência científica validada.",
    correction: {
      authors: [{ name: author, orcid: null, openalex: null }],
      language: "en",
      accessNote:
        "Metadados conferidos na página original; autoria corrigida. Sem auditoria integral ou validação científica.",
    },
  });
  approved.push(result.contentId);
}
// Uma continuação comprova retomada da fila persistida, sem ignorar o intervalo de coleta.
runs.push(await call(`/admin/sources/${source.id}/ingest`, "POST"));
const previous = (await call("/workshop/selection")).items.map((i) => i.id);
const before = await Promise.all(approved.map((id) => call("/contents/" + id)));
let prompt;
try {
  for (const id of approved) await call(`/contents/${id}/favorite`, "PUT");
  await call("/workshop/selection", "PUT", { contentIds: approved });
  const feed = await call("/feed?limit=50");
  for (const id of approved)
    assert.ok(feed.items.some((i) => i.content.id === id));
  const search = await call(
    "/search?sourceId=" + source.id + "&topic=design&kind=article&language=en",
  );
  for (const id of approved) assert.ok(search.items.some((i) => i.id === id));
  const favorites = await call("/favorites?sourceId=" + source.id);
  for (const id of approved)
    assert.ok(favorites.items.some((i) => i.id === id));
  const pack = await call("/research-packages", "POST", {
    format: "carousel",
    slides: 6,
    objective:
      "Comparar referências editoriais sobre decisões de design sem tratá-las como evidência científica.",
    notes: "Demonstração local Etapa 03; revisão humana final necessária.",
  });
  prompt = await call(`/research-packages/${pack.id}/prompt`, "POST");
  assert.ok(prompt.text.includes("Alan Dalton"));
  assert.ok(prompt.text.includes("Shrey Shah"));
} finally {
  await call("/workshop/selection", "PUT", { contentIds: previous });
  for (const item of before)
    if (!item.state.favorite)
      await call(`/contents/${item.id}/favorite`, "DELETE");
}
const allRuns = (await call("/admin/ingestion-runs?limit=50")).items.filter(
  (r) => r.sourceId === source.id,
);
const candidates = (await call("/admin/candidates?limit=50")).items.filter(
  (c) => c.sourceId === source.id,
);
const report = {
  checkedAt: new Date().toISOString(),
  environment: "local",
  sourceId: source.id,
  runs: allRuns,
  candidates: candidates.map((c) => ({
    id: c.id,
    title: c.metadata.title,
    outcome: c.outcome,
    authors: c.metadata.authors,
    score: c.quality.score,
  })),
  approved,
  workflow: {
    feed: true,
    searchFilters: true,
    favorites: true,
    selection: true,
    promptId: prompt.id,
    promptContainsBothAuthors: true,
    previousUserStateRestored: true,
  },
};
await writeFile(
  "docs/examples/stage03-live-check.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
