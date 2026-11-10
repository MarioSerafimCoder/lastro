// Prepare a reviewable, additive rollout. This script never writes the remote DB.
// Input: Wrangler JSON export of approved RSS sources; output stays in .wrangler.
import { readFile, writeFile } from "node:fs/promises";
import { parseRss, readBounded } from "../src/connectors";
import { canonicalUrl } from "../src/normalize";
import { sourceInputSchema } from "../packages/contracts";
const root = ".wrangler/summary-rollout";
const rows = JSON.parse(
  (await readFile(`${root}/sources.json`, "utf8")).replace(/^\uFEFF/, ""),
)[0].results;
const selected = new Set([
  "brasil.uxdesign.cc",
  "www.artnews.com",
  "www.thisiscolossal.com",
  "hyperallergic.com",
  "www.b9.com.br",
  "artebrasileiros.com.br",
  "www.meioemensagem.com.br",
]);
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const sql: string[] = [],
  report: unknown[] = [];
for (const row of rows) {
  if (!selected.has(new URL(row.url).hostname)) continue;
  const current = JSON.parse(row.config_json);
  if (!["BR", "US"].includes(current.country)) continue;
  try {
    const response = await fetch(row.url, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Product opt-in requested by the owner; this is not a publisher licence or AI permission.
    const patch = { summaryAllowed: true, feedTextSummaryAllowed: true };
    const source = {
      ...sourceInputSchema.parse({
        ...current,
        name: row.name,
        connector: row.connector,
        url: row.url,
        ...patch,
      }),
      id: row.id,
      status: "approved" as const,
      createdAt: row.created_at,
      nextFetchAt: null,
    };
    const items = parseRss(await readBounded(response), source);
    const previews = items
      .filter((item) => item.description)
      .map((item) => ({ url: canonicalUrl(item.url), text: item.description }));
    if (!previews.length)
      throw new Error(
        "Feed sem texto utilizável ou com restrições explícitas.",
      );
    sql.push(
      `UPDATE sources SET config_json=json_patch(config_json,${quote(JSON.stringify(patch))}) WHERE id=${quote(row.id)} AND status='approved' AND config_json=${quote(row.config_json)};`,
    );
    const payload = quote(JSON.stringify(previews));
    sql.push(
      `UPDATE contents SET metadata_json=json_set(metadata_json,'$.description',(SELECT json_extract(value,'$.text') FROM json_each(${payload}) WHERE json_extract(value,'$.url')=contents.canonical_url LIMIT 1)) WHERE source_id=${quote(row.id)} AND expired_at IS NULL AND EXISTS(SELECT 1 FROM sources s WHERE s.id=contents.source_id AND json_extract(s.config_json,'$.summaryAllowed')=1 AND json_extract(s.config_json,'$.feedTextSummaryAllowed')=1) AND EXISTS(SELECT 1 FROM json_each(${payload}) WHERE json_extract(value,'$.url')=contents.canonical_url AND json_extract(value,'$.text') IS NOT json_extract(contents.metadata_json,'$.description'));`,
    );
    report.push({
      source: row.name,
      entries: items.length,
      summaries: previews.length,
      samples: items
        .filter((item) => item.description)
        .slice(0, 3)
        .map((item) => ({ title: item.title, summary: item.description })),
    });
  } catch (error) {
    report.push({ source: row.name, error: String(error) });
  }
}
await writeFile(`${root}/apply.sql`, sql.join("\n"));
await writeFile(`${root}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
