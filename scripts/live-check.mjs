// Opt-in live integration check against the local API. Never targets production.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:8787";
const vars = await readFile(".dev.vars", "utf8");
const token = vars.match(/^DEV_TOKEN=(.+)$/m)?.[1].trim();
if (!token) throw new Error("Execute npm run setup.");
const report = {
  checkedAt: new Date().toISOString(),
  environment: "local",
  external: [],
  workflow: null,
};
async function call(path, method = "GET", body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = r.status === 204 ? null : await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(value)}`);
  return value;
}
assert.equal((await fetch(base + "/api/feed")).status, 401);
let chosen;
for (const file of ["source-rss.json", "source-openalex.json"]) {
  const config = JSON.parse(await readFile(`examples/${file}`, "utf8"));
  const listing = await call("/api/admin/sources?limit=50");
  let source = listing.items.find((s) => s.url === config.url);
  if (!source) source = await call("/api/admin/sources", "POST", config);
  if (source.status !== "approved")
    source = await call(`/api/admin/sources/${source.id}/status`, "PATCH", {
      status: "approved",
      reason:
        "Validação técnica local do conector: coleta pública de metadados, sem texto integral. Não valida qualidade científica.",
    });
  let run;
  try {
    run = await call(`/api/admin/sources/${source.id}/ingest`, "POST");
  } catch (e) {
    report.external.push({ connector: config.connector, error: e.message });
    continue;
  }
  report.external.push({
    connector: config.connector,
    sourceId: source.id,
    ...run,
  });
  console.log(
    JSON.stringify({
      connector: config.connector,
      status: run.status,
      accepted: run.accepted,
      pending: run.pending,
      rejected: run.rejected,
      queuedRemaining: run.queuedRemaining,
      error: run.error,
    }),
  );
  if (config.connector === "rss" && run.pending) {
    const candidates = await call(
      `/api/admin/candidates?runId=${run.id}&outcome=pending`,
    );
    chosen = candidates.items[0];
  }
}
if (chosen) {
  const reviewed = await call(
    `/api/admin/candidates/${chosen.id}/review`,
    "POST",
    {
      decision: "approved",
      reason:
        "Aprovação para demonstração técnica local: título, procedência, autoria e pertinência temática conferidos nos metadados. Texto integral não consultado; não é validação científica.",
    },
  );
  const contentId = reviewed.contentId,
    previousSelection = await call("/api/workshop/selection");
  const before = await call(`/api/contents/${contentId}`);
  try {
    await call(`/api/contents/${contentId}/favorite`, "PUT");
    await call("/api/workshop/selection", "PUT", { contentIds: [contentId] });
    const feed = await call("/api/feed?limit=5");
    assert.ok(feed.items.some((i) => i.content.id === contentId));
    const detail = await call(`/api/contents/${contentId}`);
    assert.equal(detail.state.favorite, true);
    assert.equal(detail.state.selected, true);
    const pack = await call("/api/research-packages", "POST", {
      format: "post",
      objective:
        "Explorar a referência de design selecionada após consultar a fonte original.",
      notes:
        "Pacote criado na validação técnica local; exige leitura e revisão editorial antes de uso.",
    });
    const prompt = await call(
      `/api/research-packages/${pack.id}/prompt`,
      "POST",
    );
    assert.ok(prompt.text.includes(detail.url));
    await mkdir("docs/examples", { recursive: true });
    for (const [name, data] of Object.entries({
      feed,
      content: detail,
      researchPackage: pack,
      prompt,
    }))
      await writeFile(
        `docs/examples/${name}.json`,
        JSON.stringify(data, null, 2) + "\n",
      );
    report.workflow = {
      contentId,
      packageId: pack.id,
      promptId: prompt.id,
      status: "passed",
    };
  } finally {
    await call("/api/workshop/selection", "PUT", {
      contentIds: previousSelection.items.map((i) => i.id),
    });
    if (!before.state.favorite)
      await call(`/api/contents/${contentId}/favorite`, "DELETE");
  }
}
await mkdir("docs/examples", { recursive: true });
await writeFile(
  "docs/examples/live-check.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    report.workflow ?? { status: "no_rss_candidate_for_workflow" },
  ),
);
if (
  report.external.some((r) => r.status === "failed" || r.error) ||
  !report.workflow
)
  process.exitCode = 1;
