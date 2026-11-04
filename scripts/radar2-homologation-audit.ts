// Reads an existing private D1 SQL export. Never connects to Cloudflare.
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { editorialWeek } from "../src/schedule";
const input = process.argv.find((v) => v.startsWith("--sql="))?.slice(6);
if (!input)
  throw Error(
    "Required --sql=PRIVATE_EXPORT_PATH; no remote writes are supported",
  );
const output = input + ".sqlite";
const exclusive = await open(output, "wx");
await exclusive.close();
const sql = await readFile(input, "utf8");
const db = new DatabaseSync(output);
db.exec("PRAGMA foreign_keys=OFF");
db.exec(sql);
db.exec("PRAGMA foreign_keys=ON");
const q = (sql: string, ...args: any[]) => db.prepare(sql).all(...args);
const at = new Date().toISOString(),
  week = editorialWeek();
const report = {
  checkedAt: at,
  environment:
    "private read-only export, local SQLite audit; production unchanged",
  exportSha256: createHash("sha256").update(sql).digest("hex"),
  week,
  migrations: q("SELECT name FROM d1_migrations ORDER BY id"),
  totals: q(
    "SELECT COUNT(*) total,SUM(editorial_status='approved') approved,SUM(editorial_status='pending') pending,SUM(editorial_status='rejected') rejected FROM contents",
  ),
  publicationWeek: q(
    "SELECT s.name,c.editorial_status status,COUNT(*) count FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.kind<>'paper' AND c.published_at>=? AND c.published_at<? AND c.published_at<=? GROUP BY s.id,c.editorial_status",
    week.start,
    week.end,
    at,
  ),
  sources: q(`SELECT s.name,s.status,s.connector,s.url,
    json_extract(config_json,'$.metadataAllowed') metadataAllowed,
    json_extract(config_json,'$.summaryAllowed') summaryAllowed,
    json_extract(config_json,'$.imageAllowed') imageAllowed,
    json_extract(config_json,'$.country') country,
    last_success_at,last_attempt_at,next_fetch_at,consecutive_failures,
    (SELECT MAX(collected_at) FROM contents c WHERE c.source_id=s.id) lastDiscovery,
    (SELECT COUNT(*) FROM ingestion_queue iq WHERE iq.source_id=s.id) queued,
    (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND c.editorial_status='pending') pending
    FROM sources s ORDER BY s.name`),
  runs: q(
    "SELECT status,error,COUNT(*) count,MAX(started_at) latest,SUM(received) received FROM ingestion_runs GROUP BY status,error ORDER BY count DESC LIMIT 20",
  ),
  synopses: q(
    "SELECT status,block_code,COUNT(*) count FROM content_synopses GROUP BY status,block_code ORDER BY count DESC",
  ),
  decisions: q(
    "SELECT decision,COUNT(*) count FROM editorial_decisions GROUP BY decision",
  ),
  reasons: q(
    "SELECT j.value reason,COUNT(*) count FROM ingestion_candidates,json_each(reasons_json) j WHERE j.value NOT LIKE '% %' GROUP BY j.value ORDER BY count DESC LIMIT 20",
  ),
  priorSynopsisGate: q(
    `SELECT COUNT(*) visible,SUM(c.kind<>'paper' AND c.published_at>=? AND c.published_at<?) editorialPublishedWeek
    FROM contents c JOIN sources s ON s.id=c.source_id JOIN content_synopses sy ON sy.content_id=c.id
    WHERE c.editorial_status='approved' AND s.status='approved' AND sy.status='validated' AND sy.metadata_json=c.metadata_json`,
    week.start,
    week.end,
  ),
  foreignKeys: q("PRAGMA foreign_key_check"),
  integrity: q("PRAGMA quick_check"),
};
await writeFile(
  "docs/radar2-homologation-audit.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    checkedAt: at,
    totals: report.totals,
    publicationWeek: report.publicationWeek,
    migrations: report.migrations.slice(-2),
    integrity: report.integrity,
    foreignKeys: report.foreignKeys.length,
  }),
);
db.close();
