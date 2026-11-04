// Local rehearsal only. Never opens a Cloudflare binding or makes network requests.
import { DatabaseSync } from "node:sqlite";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { expireRadar } from "../src/radar-retention";
import { radarFeed } from "../src/radar-feed";
import { radarStatus } from "../src/radar";
import { policy } from "../src/db";
import type { Env } from "../src/env";
const input = process.argv.find((v) => v.startsWith("--copy="))?.slice(7);
if (!input)
  throw Error(
    "Required: --copy=PATH to an existing isolated SQLite copy, never a remote database",
  );
const output =
  input.replace(/\.sqlite$/, "") + "-radar2-" + Date.now() + ".sqlite";
await copyFile(input, output, constants.COPYFILE_EXCL);
const sqlite = new DatabaseSync(output);
sqlite.exec("PRAGMA foreign_keys=ON");
let queries = 0;
function prepare(sql: string, values: unknown[] = []): any {
  const bound = () => values.map((v) => (v === undefined ? null : v)) as any[];
  return {
    bind: (...v: unknown[]) => prepare(sql, v),
    execute: () => {
      queries++;
      const r = sqlite.prepare(sql).run(...bound());
      return {
        success: true,
        results: [],
        meta: { changes: Number(r.changes) },
      };
    },
    async run() {
      return this.execute();
    },
    async first(column?: string) {
      queries++;
      const r = sqlite.prepare(sql).get(...bound()) as any;
      return column ? (r?.[column] ?? null) : (r ?? null);
    },
    async all() {
      queries++;
      return {
        success: true,
        results: sqlite.prepare(sql).all(...bound()),
        meta: {},
      };
    },
  };
}
const DB = {
  prepare,
  batch: async (ss: any[]) => {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = ss.map((s) => s.execute());
      sqlite.exec("COMMIT");
      return result;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  },
} as unknown as D1Database;
const protectedIds = () =>
  sqlite
    .prepare(
      `SELECT id,metadata_json FROM contents WHERE id IN(SELECT content_id FROM favorites UNION SELECT content_id FROM workshop_selection UNION SELECT content_id FROM research_package_items UNION SELECT content_id FROM output_sources UNION SELECT content_id FROM collection_items UNION SELECT content_id FROM notes UNION SELECT content_id FROM knowledge_annotations) ORDER BY id`,
    )
    .all();
const auditTables = [
  "favorites",
  "workshop_selection",
  "research_packages",
  "research_package_items",
  "editorial_outputs",
  "output_sources",
  "editorial_decisions",
  "synopsis_decisions",
  "synopsis_history",
  "notes",
  "knowledge_annotations",
];
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const audit = () =>
  Object.fromEntries(
    auditTables.map((t) => {
      const rows = sqlite
        .prepare("SELECT * FROM " + t + " ORDER BY rowid")
        .all();
      return [t, { hash: hash(rows), count: rows.length }];
    }),
  );
const before = { protected: hash(protectedIds()), audit: audit() };
sqlite.exec(await readFile("migrations/0014_radar_editorial.sql", "utf8"));
sqlite.exec("INSERT INTO radar_scheduler(id) VALUES (1)");
const clock = Date.parse("2026-11-04T17:21:59Z"),
  p = await policy(DB),
  prefs = JSON.parse(
    (
      sqlite
        .prepare("SELECT preferences_json FROM users WHERE id='owner'")
        .get() as any
    ).preferences_json,
  );
const feedBefore = await radarFeed(
  DB,
  { scope: "editorial", limit: "50" },
  prefs,
  p,
  clock,
);
const passes = [];
for (let i = 0; i < 12; i++) {
  queries = 0;
  const result = await expireRadar(DB, clock + i);
  passes.push({ ...result, statements: queries });
  if (queries > 50) throw Error("Retention query budget exceeded");
  if (!result.expired && !result.purged) break;
}
const feedAfter = await radarFeed(
  DB,
  { scope: "editorial", limit: "50" },
  prefs,
  p,
  clock + 20,
);
const status = await radarStatus(
  { DB, INGEST_ENABLED: "true" } as Env,
  null,
  clock,
);
const report = {
  snapshotAt: new Date(clock).toISOString(),
  environment: "isolated SQLite copy, no production writes",
  passes,
  protectedMetadataPreserved: before.protected === hash(protectedIds()),
  auditsPreserved: auditTables.every(
    (t) =>
      hash(
        sqlite
          .prepare("SELECT * FROM " + t + " ORDER BY rowid LIMIT ?")
          .all(before.audit[t].count),
      ) === before.audit[t].hash,
  ),
  foreignKeys: sqlite.prepare("PRAGMA foreign_key_check").all(),
  integrity: sqlite.prepare("PRAGMA quick_check").all(),
  dailyBeforeCleanup: feedBefore.items.length,
  dailyAfterCleanup: feedAfter.items.length,
  health: status.health,
  expired: sqlite
    .prepare("SELECT COUNT(*) n FROM contents WHERE expired_at IS NOT NULL")
    .get(),
  purged: sqlite
    .prepare("SELECT COUNT(*) n FROM contents WHERE purged_at IS NOT NULL")
    .get(),
};
console.log(
  JSON.stringify({
    protectedMetadataPreserved: report.protectedMetadataPreserved,
    auditsPreserved: report.auditsPreserved,
    foreignKeyViolations: report.foreignKeys.length,
    passes: report.passes,
  }),
);
if (
  !report.protectedMetadataPreserved ||
  !report.auditsPreserved ||
  report.foreignKeys.length
)
  throw Error("Isolated integrity rehearsal failed");
await writeFile(
  "docs/radar2-copy-validation.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ ...report, health: undefined }));
sqlite.close();
