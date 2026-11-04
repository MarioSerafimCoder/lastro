// Public metadata sampling against an existing private SQLite export, read-only.
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { parseRss, readBounded } from "../src/connectors";
import { normalizeCandidate, canonicalUrl } from "../src/normalize";
import { editorialWeek } from "../src/schedule";
import type { Source } from "../packages/contracts";
const input = process.argv.find((v) => v.startsWith("--copy="))?.slice(7);
if (!input)
  throw Error(
    "Required --copy=PRIVATE_SQLITE_COPY; remote databases unsupported",
  );
const db = new DatabaseSync(input, { readOnly: true });
const names = [
  "Creative Boom",
  "It’s Nice That",
  "Smashing Magazine",
  "A List Apart",
  "Plau — Entrelinha",
];
const week = editorialWeek(),
  observations = [];
for (const name of names) {
  const row = db.prepare("SELECT * FROM sources WHERE name=?").get(name) as any;
  if (!row) continue;
  const s: Source = {
    ...JSON.parse(row.config_json),
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    nextFetchAt: row.next_fetch_at,
    summaryAllowed: false,
    imageAllowed: false,
  };
  try {
    const response = await fetch(row.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Lastro/0.2 (metadata-only homologation)" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      observations.push({ name, url: row.url, status: response.status });
      continue;
    }
    const items = parseRss(await readBounded(response), s).map(
      normalizeCandidate,
    );
    const current = items.filter(
      (c) =>
        c.publishedAt &&
        c.publishedAt >= week.start &&
        c.publishedAt < week.end &&
        Date.parse(c.publishedAt) <= Date.now(),
    );
    const samples = current.slice(0, 3).map((c) => {
      const url = canonicalUrl(c.url);
      const content = db
        .prepare(
          "SELECT editorial_status status,collected_at discoveredAt,published_at publishedAt FROM contents WHERE canonical_url=?",
        )
        .get(url);
      const queued = !!db
        .prepare("SELECT 1 FROM ingestion_queue WHERE canonical_url=?")
        .get(url);
      const decision = db
        .prepare(
          "SELECT outcome,reasons_json FROM ingestion_candidates WHERE source_id=? AND json_extract(payload_json,'$.url')=? ORDER BY created_at DESC LIMIT 1",
        )
        .get(row.id, c.url) as any;
      return {
        url,
        publishedAt: c.publishedAt,
        content: content ?? null,
        queued,
        decision: decision
          ? {
              outcome: decision.outcome,
              reasons: JSON.parse(decision.reasons_json).filter(
                (r: string) => !r.includes(" "),
              ),
            }
          : null,
      };
    });
    observations.push({
      name,
      url: row.url,
      status: response.status,
      entries: items.length,
      latestPublication: items
        .map((c) => c.publishedAt)
        .filter(Boolean)
        .sort()
        .at(-1),
      publicationsThisWeek: current.length,
      lastCollection: row.last_success_at,
      payloadNotRetained: true,
      samples,
    });
  } catch (e) {
    observations.push({ name, url: row.url, error: (e as Error).message });
  }
}
const previous = JSON.parse(
  await readFile("docs/radar2-source-validation.json", "utf8"),
);
await writeFile(
  "docs/radar2-homologation-sources.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      environment:
        "public RSS metadata; private SQLite snapshot read-only; no source changes or AI",
      week,
      observations,
      internationalChecksReusedFrom: {
        file: "radar2-source-validation.json",
        checkedAt: previous.checkedAt,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    observations.map(
      ({
        name,
        status,
        latestPublication,
        publicationsThisWeek,
        error,
      }: any) => ({
        name,
        status,
        latestPublication,
        publicationsThisWeek,
        error,
      }),
    ),
  ),
);
db.close();
