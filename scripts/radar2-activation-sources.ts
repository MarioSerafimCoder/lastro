// Prepare an auditable source merge and rehearse it on a COPY, never a remote DB.
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { sourceInputSchema, type Source } from "../packages/contracts";
import { parseRss, readBounded } from "../src/connectors";
import { normalizeCandidate } from "../src/normalize";
import { editorialWeek } from "../src/schedule";

const input = process.argv.find((v) => v.startsWith("--copy="))?.slice(7);
if (!input || !process.argv.includes("--live"))
  throw Error("Required --copy=PRIVATE_SQLITE_COPY --live");
const output = input + ".sources-rehearsal.sqlite";
await copyFile(input, output, constants.COPYFILE_EXCL);
const db = new DatabaseSync(output);
db.exec("PRAGMA foreign_keys=ON");
const catalog = JSON.parse(
  await readFile("examples/radar2-catalog.json", "utf8"),
);
const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const at = new Date().toISOString(),
  week = editorialWeek();
const sql: string[] = [],
  observations: any[] = [];
const retained = () =>
  db
    .prepare("SELECT id,status,config_json FROM sources ORDER BY id")
    .all() as any[];
const originals = retained();
for (const entry of catalog.initial) {
  const proposed = sourceInputSchema.parse(entry.config);
  const existing = db
    .prepare("SELECT * FROM sources WHERE url=?")
    .get(proposed.url) as any;
  const current = existing ? JSON.parse(existing.config_json) : null;
  let probe: any = {
    reusedValidation: "docs/radar2-source-validation.json, same date",
  };
  if (!existing) {
    if (
      proposed.synopsisAllowed !== false ||
      proposed.imageAllowed ||
      proposed.summaryAllowed
    )
      throw Error("New sources must remain metadata-only");
    try {
      const started = performance.now();
      const response = await fetch(proposed.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "Lastro/0.2 (official feed metadata validation)",
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        observations.push({
          name: proposed.name,
          decision: "deferred",
          status: response.status,
        });
        continue;
      }
      const xml = await readBounded(response);
      const source = {
        ...proposed,
        id: "probe",
        status: "approved",
        createdAt: at,
        nextFetchAt: null,
      } as Source;
      const items = parseRss(xml, source).map(normalizeCandidate);
      if (!items.length || items.some((i) => !i.publishedAt))
        throw Error("Feed without usable dated metadata");
      probe = {
        status: response.status,
        totalMs: Math.round(performance.now() - started),
        bytes: Buffer.byteLength(xml),
        entries: items.length,
        withAuthor: items.filter((i) => i.authors.length).length,
        latestPublication: items
          .map((i) => i.publishedAt)
          .sort()
          .at(-1),
        publicationsThisWeek: items.filter(
          (i) =>
            i.publishedAt! >= week.start &&
            i.publishedAt! < week.end &&
            Date.parse(i.publishedAt!) <= Date.now(),
        ).length,
        noPayloadStored: true,
      };
      if (!probe.withAuthor) throw Error("No verified feed bylines");
    } catch (e) {
      observations.push({
        name: proposed.name,
        decision: "deferred",
        error: (e as Error).message,
      });
      continue;
    }
  }
  const merged = sourceInputSchema.parse(
    current
      ? {
          ...current,
          country: current.country ?? proposed.country,
          radarCategory: current.radarCategory ?? proposed.radarCategory,
          topics: [...new Set([...current.topics, ...proposed.topics])].slice(
            0,
            30,
          ),
          languages: [
            ...new Set([...current.languages, ...proposed.languages]),
          ],
        }
      : proposed,
  );
  const id = existing?.id ?? crypto.randomUUID();
  const before = existing?.config_json,
    after = JSON.stringify(merged);
  if (existing && before !== after) {
    sql.push(
      `UPDATE sources SET config_json=${quote(after)} WHERE id=${quote(id)} AND config_json=${quote(before)} AND (lease_until IS NULL OR lease_until<${quote(at)});`,
    );
  } else if (!existing) {
    sql.push(
      `INSERT INTO sources(id,name,connector,url,status,config_json,created_at) VALUES (${quote(id)},${quote(merged.name)},${quote(merged.connector)},${quote(merged.url)},'approved',${quote(after)},${quote(at)});`,
    );
  }
  if (!existing || before !== after) {
    const decision = crypto.randomUUID();
    sql.push(
      `INSERT INTO source_decisions(id,source_id,status,reason,created_at) SELECT ${quote(decision)},id,status,${quote("Radar 2 activation authorized by owner; official feed and metadata-only catalog validated 2026-11-04; preserve existing licensed permissions.")},${quote(at)} FROM sources WHERE id=${quote(id)} AND config_json=${quote(after)};`,
    );
  }
  observations.push({
    id,
    name: merged.name,
    url: merged.url,
    decision: existing
      ? "merge-preserving-existing-policy"
      : "new-approved-metadata-only",
    country: merged.country,
    category: merged.radarCategory,
    languages: merged.languages,
    permissions: {
      metadata: merged.metadataAllowed,
      summary: merged.summaryAllowed,
      image: merged.imageAllowed,
      synopsis: merged.synopsisAllowed ?? null,
    },
    ...(existing ? { existingStatus: existing.status } : {}),
    probe,
  });
}
db.exec("BEGIN IMMEDIATE");
try {
  for (const statement of sql) db.exec(statement);
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
const after = retained();
for (const original of originals) {
  const final = after.find((s) => s.id === original.id);
  if (!final || final.status !== original.status)
    throw Error("Existing source identity/status changed");
  const oldConfig = JSON.parse(original.config_json),
    newConfig = JSON.parse(final.config_json);
  for (const key of [
    "summaryAllowed",
    "synopsisAllowed",
    "imageAllowed",
    "synopsisRightsNote",
    "synopsisLicenseUrl",
    "autoApprove",
    "autoTopics",
    "intervalMinutes",
    "maxAgeDays",
  ])
    if (JSON.stringify(oldConfig[key]) !== JSON.stringify(newConfig[key]))
      throw Error("Existing permission or cadence overwritten: " + key);
}
const fk = db.prepare("PRAGMA foreign_key_check").all(),
  integrity = db.prepare("PRAGMA quick_check").all();
if (fk.length || (integrity[0] as any).quick_check !== "ok")
  throw Error("Source merge integrity failed");
const body = sql.join("\n") + "\n";
await writeFile(".wrangler/tmp/radar2-activation-sources.sql", body);
await writeFile(
  "docs/radar2-activation-sources.json",
  JSON.stringify(
    {
      checkedAt: at,
      week,
      environment:
        "public feed checks + isolated SQLite source merge rehearsal",
      sqlSha256: createHash("sha256").update(body).digest("hex"),
      before: originals.length,
      after: after.length,
      existingPoliciesPreserved: true,
      foreignKeys: fk,
      integrity,
      observations,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    before: originals.length,
    after: after.length,
    existingPoliciesPreserved: true,
    observations: observations.map((x) => ({
      name: x.name,
      decision: x.decision,
      probe: x.probe,
    })),
  }),
);
db.close();
