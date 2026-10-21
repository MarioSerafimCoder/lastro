// Opt-in real metadata validation in an ephemeral database, never the personal DB.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { sourceInputSchema } from "../packages/contracts/index";
import { ingestSource } from "../src/ingestion";
import { stmt, id, first } from "../src/db";
import type { Env } from "../src/env";
if (!process.argv.includes("--live")) throw Error("Explicit --live required");
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
    for (const sql of (await readFile(`migrations/${file}`, "utf8"))
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  const configs = await Promise.all(
    (await readdir("examples/catalog"))
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
      JSON.stringify({ ...config, autoApprove: false }),
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
      cycle: config.connector === "openalex" ? "monthly UTC" : "daily UTC",
      requests,
      runs,
      totals,
    });
    console.log(
      config.name,
      JSON.stringify(totals),
      runs.at(-1)?.error ?? "ok",
    );
  }
  await writeFile(
    "docs/examples/stage04-1-source-checks.json",
    JSON.stringify(report, null, 2) + "\n",
  );
} finally {
  await mf.dispose();
}
