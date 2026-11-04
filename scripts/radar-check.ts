// Opt-in real metadata validation in an ephemeral database, never the personal DB.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { sourceInputSchema } from "../packages/contracts/index";
import { ingestSource } from "../src/ingestion";
import { stmt, id, first, rows } from "../src/db";
import type { Env } from "../src/env";
import { migrationStatements } from "../tests/migration-statements";
if (!process.argv.includes("--live")) throw Error("Explicit --live required");
const automatic = process.argv.includes("--auto");
const radar2 = process.argv.includes("--radar2");
const catalogFilter = process.argv
  .find((arg) => arg.startsWith("--catalog="))
  ?.split("=")[1]
  ?.split(",");
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("isolated")}}',
    compatibilityDate: "2026-10-01",
    d1Databases: ["DB"],
  }),
);
const report: any = {
  checkedAt: new Date().toISOString(),
  environment: "ephemeral Miniflare, no personal or production data",
  sources: [],
};
try {
  const db = (await mf.getD1Database("DB")) as unknown as D1Database;
  for (const file of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      await readFile(`migrations/${file}`, "utf8"),
    ))
      await db.prepare(sql).run();
  const configs = radar2
    ? JSON.parse(
        await readFile("examples/radar2-catalog.json", "utf8"),
      ).initial.map((s: { config: unknown }) =>
        sourceInputSchema.parse(s.config),
      )
    : await Promise.all(
        (await readdir("examples/catalog"))
          .filter(
            (file) =>
              !catalogFilter ||
              catalogFilter.includes(file.replace(/\.json$/, "")),
          )
          .sort()
          .map(async (file) =>
            sourceInputSchema.parse(
              JSON.parse(await readFile(`examples/catalog/${file}`, "utf8")),
            ),
          ),
      );
  const env: Env = {
    DB: db,
    ALLOWED_FETCH_HOSTS: [
      ...new Set(configs.map((s) => new URL(s.url).hostname)),
    ].join(","),
  };
  for (const config of configs) {
    const sid = id();
    const requests: any[] = [];
    const runs = [];
    await stmt(
      db,
      "INSERT INTO sources(id,name,connector,url,status,config_json,created_at) VALUES (?,?,?,?,?,?,?)",
      sid,
      config.name,
      config.connector,
      config.url,
      "approved",
      JSON.stringify({
        ...config,
        autoApprove: radar2 ? automatic && config.autoApprove : automatic,
      }),
      new Date().toISOString(),
    ).run();
    const fetcher: typeof fetch = async (input, init) => {
      const start = Date.now();
      const r = await fetch(input, init);
      requests.push({
        status: r.status,
        ms: Date.now() - start,
        redirect: r.headers.get("location"),
      });
      return r;
    };
    for (let i = 0; i < 13; i++) {
      const run = await ingestSource(env, sid, fetcher);
      runs.push(run);
      if (run.status === "failed" || !run.queuedRemaining) break;
    }
    const totals = await first(
      db,
      "SELECT COUNT(*) candidates,SUM(outcome='pending') pending,SUM(outcome='rejected') rejected,SUM(outcome='duplicate') duplicates,SUM(outcome='approved') approved FROM ingestion_candidates WHERE source_id=?",
      sid,
    );
    report.sources.push({
      name: config.name,
      url: config.url,
      cycle:
        config.connector === "openalex"
          ? "bimonthly UTC"
          : "daily America/Fortaleza",
      requests,
      ...(radar2
        ? {
            processingRuns: runs.length,
            finalRun: runs.at(-1)
              ? {
                  status: runs.at(-1)!.status,
                  queuedRemaining: runs.at(-1)!.queuedRemaining,
                  error: runs.at(-1)!.error,
                }
              : null,
          }
        : { runs }),
      totals,
      approvedExamples:
        automatic && !radar2
          ? await rows<{ title: string }>(
              db,
              "SELECT title FROM contents WHERE source_id=? AND editorial_status='approved' ORDER BY quality_score DESC LIMIT 3",
              sid,
            )
          : [],
      ...(radar2
        ? {
            reasons: await rows(
              db,
              "SELECT value reason,COUNT(*) count FROM ingestion_candidates,json_each(reasons_json) WHERE source_id=? GROUP BY value ORDER BY count DESC LIMIT 10",
              sid,
            ),
          }
        : {}),
    });
    console.log(
      config.name,
      JSON.stringify(totals),
      runs.at(-1)?.error ?? "ok",
    );
  }
  await writeFile(
    radar2
      ? "docs/examples/radar2-source-checks.json"
      : catalogFilter
        ? "docs/examples/for-you-2-source-checks.json"
        : automatic
          ? "docs/examples/feed-vivo-source-checks.json"
          : "docs/examples/stage04-1-source-checks.json",
    JSON.stringify(report, null, 2) + "\n",
  );
} finally {
  await mf.dispose();
}
