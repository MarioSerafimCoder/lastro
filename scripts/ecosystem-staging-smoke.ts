// Isolated staging only. Secrets are supplied through process environment, never arguments.
import assert from "node:assert/strict";
import fs from "node:fs";
import { sign, signature, VERSION } from "../packages/contracts/ecosystem";
import { fixtureSource, contentFixture } from "../tests/fixtures";
const resources = JSON.parse(
  fs
    .readFileSync(".wrangler/ecosystem-staging-resources.json", "utf8")
    .replace(/^\uFEFF/, ""),
);
const lastro = "https://lastro-ecosystem-staging.marioserafim-da.workers.dev",
  studio = "https://studio-ecosystem-staging.marioserafim-da.workers.dev",
  crm = "https://crm-ecosystem-staging.pages.dev";
const results: Record<string, unknown> = {};
const allowedDB = new Set([
  "02b2c69e-3780-484c-a0d2-034ebf15ea7a",
  "454412aa-c5fb-469d-9072-89f6a849de1d",
  "ae493a72-27d6-4219-9b55-cf1be0d835fe",
]);
async function query(db: string, sql: string, params: unknown[] = []) {
  assert.ok(allowedDB.has(db), "Only staging D1 allowed");
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/7bfc908c25ef636aade196a09572a11c/d1/database/${db}/query`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.STAGING_CF_OAUTH,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const j = (await r.json()) as any;
  assert.ok(r.ok && j.success, "Staging D1 query failed");
  return j.result[0].results;
}
const login = await fetch(lastro + "/api/auth/login", {
  method: "POST",
  headers: { Origin: lastro, "Content-Type": "application/json" },
  body: JSON.stringify({ password: process.env.STAGING_LASTRO_PASSWORD }),
});
assert.equal(login.status, 200, "Lastro staging login");
const cookie = login.headers.get("set-cookie")!.split(";")[0];
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(lastro + "/api" + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: lastro,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json()) as any;
  assert.ok(r.ok, "Lastro staging API failed " + path + " HTTP " + r.status);
  return { status: r.status, data };
}
assert.equal((await fetch(lastro + "/api/integrations/overview")).status, 401);
results.unauthenticatedLastro = "blocked";
const source = fixtureSource;
const { id: sourceId, status, createdAt, nextFetchAt, ...config } = source;
await query(
  resources["lastro-ecosystem-stage03"],
  "INSERT OR IGNORE INTO sources(id,name,connector,url,status,config_json,created_at) VALUES (?,?,?,?, 'approved',?,?)",
  [
    sourceId,
    source.name,
    source.connector,
    source.url,
    JSON.stringify(config),
    new Date().toISOString(),
  ],
);
const c = contentFixture({
  id: "30000000-0000-4000-8000-000000000003",
  sourceId,
  title: "Homologação — referência sintética",
});
await query(
  resources["lastro-ecosystem-stage03"],
  "INSERT OR IGNORE INTO contents(id,source_id,canonical_url,title,metadata_json,published_at,collected_at,kind,language,editorial_status,quality_score,quality_json) VALUES (?,?,?,?,?,?,?,?,?,'approved',80,?)",
  [
    c.id,
    sourceId,
    c.canonicalUrl,
    c.title,
    JSON.stringify(c),
    c.publishedAt,
    c.collectedAt,
    c.kind,
    c.language,
    JSON.stringify(c.quality),
  ],
);
await api("/workshop/selection", "PUT", { contentIds: [c.id] });
const pack = (
  await api("/research-packages", "POST", {
    format: "article",
    tone: "analítico",
    audience: "homologação isolada",
    objective: "Validar o fluxo de staging com conteúdo sintético",
    notes: "Sem publicação real.",
  })
).data;
const body = {
  title: "Homologação isolada — rascunho",
  argument: "Validar integração",
  outline: ["Introdução sintética"],
};
const ticket = await api(
  "/research-packages/" + pack.id + "/studio-draft",
  "POST",
  body,
);
assert.equal(ticket.status, 202);
const duplicate = await api(
  "/research-packages/" + pack.id + "/studio-draft",
  "POST",
  body,
);
assert.equal(duplicate.data.id, ticket.data.id);
await Promise.all([
  api("/integrations/reconcile", "POST"),
  api("/integrations/reconcile", "POST"),
]);
let overview = (await api("/integrations/overview")).data;
const draft = overview.studioDrafts.find((d: any) => d.package_id === pack.id);
assert.ok(draft, "Studio draft confirmed through Service Binding");
assert.ok(draft.admin_url.startsWith(studio + "/editor/"));
results.lastroStudio = {
  taskId: ticket.data.id,
  draftId: draft.id,
  packageId: pack.id,
  duplicate: "same task",
  concurrency: "completed",
};
const sl = await fetch(studio + "/api/auth/sign-in/email", {
  method: "POST",
  headers: { Origin: studio, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "marioserafim.da@gmail.com",
    password: process.env.STAGING_STUDIO_PASSWORD,
  }),
});
assert.equal(sl.status, 200, "Studio staging login");
const studioCookie = sl.headers
  .getSetCookie()
  .map((s) => s.split(";")[0])
  .join("; ");
const opened = await fetch(studio + "/api/drafts/" + draft.id, {
  headers: { Cookie: studioCookie },
});
assert.equal(opened.status, 200);
const studioDraft = (await opened.json()) as any;
assert.equal(studioDraft.sourceSha, null);
results.privateDraftOpened = true;
let articleTask = overview.tasks.find(
  (t: any) => t.source_id === "ecosystem-stage03-fixture",
);
assert.ok(articleTask);
assert.ok(["backlog_review", "invalid_contract"].includes(articleTask.error));
assert.equal(overview.newsletters.length, 0);
results.historicalGuard =
  "held before explicit individual approval; approval retained during Access failure";
await api("/integrations/tasks/" + articleTask.id + "/retry", "POST");
await api("/integrations/reconcile", "POST");
overview = (await api("/integrations/overview")).data;
const newsletter = overview.newsletters.find(
  (n: any) => n.source_id === "ecosystem-stage03-fixture",
);
assert.ok(newsletter, "CRM newsletter created through Access");
assert.ok(newsletter.admin_url.startsWith(crm + "/editor/"));
const docs = await query(
  resources["crm-ecosystem-stage03"],
  "SELECT payload,version FROM editorial_documents WHERE kind='draft' AND id=?",
  [newsletter.target_id],
);
assert.equal(docs.length, 1);
const payload = JSON.parse(docs[0].payload);
assert.equal(payload.schemaVersion, 3);
assert.equal(payload.templateId, "blog");
assert.equal(payload.status, "draft");
assert.equal(payload.document.type, "grapesjs");
assert.equal(payload.buttondownId, undefined);
assert.ok(payload.content.includes("Resumo sintético"));
results.blogCrm = {
  id: newsletter.target_id,
  template: "blog / GrapesJS 3",
  simulation: "staging-only publication fixture",
};
payload.subject = "Edição manual preservada na homologação";
await query(
  resources["crm-ecosystem-stage03"],
  "UPDATE editorial_documents SET payload=?,version=version+1 WHERE kind='draft' AND id=?",
  [JSON.stringify(payload), newsletter.target_id],
);
const signed = await sign(
  new Request(crm + "/integration/v1/newsletter-drafts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Access-Client-Id": process.env.STAGING_ACCESS_ID!,
      "CF-Access-Client-Secret": process.env.STAGING_ACCESS_SECRET!,
    },
    body: JSON.stringify({
      version: VERSION,
      slug: "ecosystem-stage03-fixture",
      sha: "a".repeat(40),
      title: "Homologação isolada — artigo sintético",
      summary: "Resumo sintético para validar integração sem publicação real.",
      category: "processo",
      url: "https://marioserafim.com.br/blog/ecosystem-stage03-fixture",
      cover: null,
      publishAt: "2026-10-01T13:00:00.000Z",
    }),
  }),
  process.env.STAGING_CRM_SECRET!,
);
const repeated = await Promise.all([
  fetch(signed.clone()),
  fetch(signed.clone()),
]);
for (const response of repeated)
  assert.equal(response.status, 200, "Repeated CRM request through Access");
const preserved = await query(
  resources["crm-ecosystem-stage03"],
  "SELECT payload,version FROM editorial_documents WHERE id=?",
  [newsletter.target_id],
);
assert.equal(JSON.parse(preserved[0].payload).subject, payload.subject);
assert.equal(preserved[0].version, docs[0].version + 1);
results.duplicateNewsletterAndManualEdit = "preserved";
const unauth = await fetch(crm + "/integration/v1/newsletter-drafts", {
  method: "POST",
  redirect: "manual",
});
assert.ok([302, 401, 403].includes(unauth.status));
for (const path of ["/api/campaign-delivery", "/api/subscribers"]) {
  const denied = await fetch(crm + path, {
    redirect: "manual",
    headers: {
      "CF-Access-Client-Id": process.env.STAGING_ACCESS_ID!,
      "CF-Access-Client-Secret": process.env.STAGING_ACCESS_SECRET!,
    },
  });
  assert.ok(
    [302, 401, 403].includes(denied.status),
    "Service identity denied user API",
  );
}
const bad = await fetch(studio + "/integration/v1/catalogue", {
  headers: {
    "X-Ecosystem-Time": String(Date.now()),
    "X-Ecosystem-Signature": "0".repeat(64),
  },
});
assert.equal(bad.status, 401);
const time = String(Date.now() - 600000),
  sig = await signature(
    process.env.STAGING_STUDIO_SECRET!,
    `${time}\nGET\n/integration/v1/catalogue\n`,
  );
const expired = await fetch(studio + "/integration/v1/catalogue", {
  headers: { "X-Ecosystem-Time": time, "X-Ecosystem-Signature": sig },
});
assert.equal(expired.status, 401);
results.security =
  "unauthenticated, service scope, invalid and expired signatures blocked";
const weekly = await api("/integrations/weekly");
assert.ok(weekly.data.metrics);
results.weekly = "available";
results.stagingDatabases = [...allowedDB];
results.urls = { lastro, studio, crm };
fs.writeFileSync(
  ".wrangler/ecosystem-remote-results.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
