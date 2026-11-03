import { existsSync } from "node:fs";
import test, { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { migrationStatements } from "./migration-statements";
import { app } from "../src/index";
import {
  requestStudio,
  processTask,
  reconcile,
  retryTask,
  integrationOverview,
  weeklySummary,
} from "../src/integration";
import {
  VERSION,
  verify,
  sign,
  signature,
} from "../packages/contracts/ecosystem";
import { contentFixture } from "./fixtures";
import { first, rows, stmt, now } from "../src/db";
import type { Env } from "../src/env";
let mf: Miniflare, env: Env;
const originalFetch = globalThis.fetch;
const packageId = "11111111-1111-4111-8111-111111111111",
  sha = "a".repeat(40);
const article = {
  version: VERSION,
  slug: "artigo",
  sha,
  title: "Artigo",
  summary: "Resumo",
  category: "processo",
  url: "https://marioserafim.com.br/blog/artigo",
  cover: null,
  publishAt: new Date(Date.now() - 10000).toISOString(),
};
const input = { title: "Título", argument: "", outline: ["Introdução"] };
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB", "STUDIO_DB", "CRM_DB"],
    }),
  );
  env = {
    DB: (await mf.getD1Database("DB")) as unknown as D1Database,
    ENVIRONMENT: "development",
    DEV_TOKEN: "test-token-".repeat(5),
    INTEGRATION_ENABLED: "true",
    STUDIO_ORIGIN: "https://studio.marioserafim.com.br",
    CRM_ORIGIN: "https://crm.marioserafim.com.br",
    STUDIO_INTEGRATION_SECRET: "studio-test-secret-".repeat(3),
    CRM_INTEGRATION_SECRET: "crm-test-secret-".repeat(3),
  };
  for (const file of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"),
    ))
      await env.DB.prepare(sql).run();
});
after(() => mf.dispose());
afterEach(() => {
  globalThis.fetch = originalFetch;
});
beforeEach(async () => {
  for (const table of [
    "integration_tasks",
    "integration_events",
    "integration_links",
    "integration_articles",
    "integration_studio_drafts",
    "research_packages",
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.prepare(
    "UPDATE integration_control SET next_at=0,lease_until=0,last_success=NULL,error=NULL",
  ).run();
  await stmt(
    env.DB,
    "INSERT INTO research_packages VALUES (?,?,?,?)",
    packageId,
    "owner",
    JSON.stringify({
      id: packageId,
      createdAt: now(),
      version: "research-1.0",
      config: { format: "article", objective: "Objetivo", notes: "Notas" },
      sources: [contentFixture({ description: "NEVER TRANSFER SOURCE TEXT" })],
      limitations: [],
    }),
    now(),
  ).run();
});
function mock(handler: (r: Request) => Promise<Response> | Response) {
  globalThis.fetch = (async (r: any) => {
    assert.ok(r instanceof Request);
    await verify(
      r.clone() as unknown as Request,
      r.url.startsWith(env.STUDIO_ORIGIN!)
        ? env.STUDIO_INTEGRATION_SECRET
        : env.CRM_INTEGRATION_SECRET,
    );
    return handler(r);
  }) as typeof fetch;
}
const studioResult = {
  slug: "lastro-test",
  revision: 1,
  updatedAt: new Date().toISOString(),
  version: VERSION,
  id: "22222222-2222-4222-8222-222222222222",
  adminUrl: "https://studio.marioserafim.com.br/editor/test",
};
const task = () =>
  first<any>(env.DB, "SELECT * FROM integration_tasks LIMIT 1");
async function articleTask() {
  await stmt(
    env.DB,
    "INSERT INTO integration_tasks(id,kind,source_id,version,created_at,updated_at) VALUES ('article-task','article','artigo',?,?,?)",
    sha,
    now(),
    now(),
  ).run();
  await stmt(
    env.DB,
    "INSERT INTO integration_articles VALUES ('artigo',?,'pending',NULL,NULL,NULL,?)",
    sha,
    now(),
  ).run();
}
test("owner API rejects anonymous requests and invalid contracts; queues only explicit actions", async () => {
  for (const path of ["/api/integrations/overview", "/api/integrations/weekly"])
    assert.equal(
      (await app.fetch(new Request("http://localhost" + path), env)).status,
      401,
    );
  const request = (data: unknown) =>
    app.fetch(
      new Request(
        "http://localhost/api/research-packages/" + packageId + "/studio-draft",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + env.DEV_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        },
      ),
      env,
    );
  assert.equal((await request({ title: "X", send: true })).status, 400);
  assert.equal(await task(), null);
  assert.equal((await request(input)).status, 202);
  assert.equal((await task()).state, "pending");
});
test("concurrent explicit requests and processing use a single draft; no external descriptions copied", async () => {
  let calls = 0;
  mock(async (r) => {
    calls++;
    const body = (await r.json()) as any;
    assert.equal(body.packageId, packageId);
    assert.ok(!JSON.stringify(body).includes("NEVER TRANSFER"));
    return Response.json({
      ...studioResult,
      adminUrl: env.STUDIO_ORIGIN + "/editor/test",
    });
  });
  const [a, b] = (await Promise.all([
    requestStudio(env, packageId, input),
    requestStudio(env, packageId, input),
  ])) as any[];
  assert.equal(a.id, b.id);
  await Promise.all([processTask(env, a.id), processTask(env, a.id)]);
  assert.equal(calls, 1);
  assert.equal((await task()).state, "completed");
  assert.equal(
    (await rows(env.DB, "SELECT * FROM integration_links")).length,
    1,
  );
  assert.equal(
    (
      await rows(
        env.DB,
        "SELECT * FROM integration_events WHERE type='studio.draft.created'",
      )
    ).length,
    1,
  );
});
test("timeout after remote acceptance retries safely with same origin key and sanitizes errors", async () => {
  let calls = 0;
  mock(async () => {
    calls++;
    if (calls === 1) throw Error("SECRET_VALUE MUST NOT LEAK");
    return Response.json({
      ...studioResult,
      adminUrl: env.STUDIO_ORIGIN + "/editor/test",
    });
  });
  const t = (await requestStudio(env, packageId, input)) as any;
  await processTask(env, t.id);
  assert.equal((await task()).state, "error");
  assert.equal((await task()).error, "service_unavailable");
  await retryTask(env, t.id);
  await processTask(env, t.id);
  assert.equal((await task()).attempts, 2);
  assert.equal((await task()).state, "completed");
  assert.ok(
    !JSON.stringify(await integrationOverview(env)).includes("SECRET_VALUE"),
  );
});
test("unconfirmed or scheduled publications never call CRM and remain pending", async () => {
  await articleTask();
  let calls = 0;
  mock(() => {
    calls++;
    return Response.json({
      version: VERSION,
      state: "scheduled",
      publishAt: "2099-01-01T10:00",
    });
  });
  await processTask(env, "article-task");
  assert.equal(calls, 1);
  assert.equal((await task()).state, "pending");
  assert.ok((await task()).next_at > Date.now() + 86400000);
  assert.equal(
    (await rows(env.DB, "SELECT * FROM integration_links")).length,
    0,
  );
});
test("confirmed publication creates only a newsletter draft and links the exact version", async () => {
  await articleTask();
  let crmCalls = 0;
  mock(async (r) => {
    if (r.url.startsWith(env.STUDIO_ORIGIN!))
      return Response.json({ version: VERSION, state: "available", article });
    crmCalls++;
    assert.ok(r.url.endsWith("/integration/v1/newsletter-drafts"));
    assert.deepEqual(await r.json(), article);
    return Response.json({
      version: VERSION,
      id: "newsletter-test",
      adminUrl: env.CRM_ORIGIN + "/editor/newsletter-test",
    });
  });
  await Promise.all([
    processTask(env, "article-task"),
    processTask(env, "article-task"),
  ]);
  assert.equal(crmCalls, 1);
  assert.equal((await task()).state, "completed");
  const overview = await integrationOverview(env);
  assert.equal(overview.newsletters.length, 1);
  assert.equal(overview.withoutNewsletter.length, 0);
  assert.deepEqual(
    (
      await rows<any>(
        env.DB,
        "SELECT type FROM integration_events ORDER BY type",
      )
    ).map((e) => e.type),
    ["blog.article.published", "crm.newsletter.draft.created"],
  );
});
test("network retries are bounded and expired final leases recover to intervention", async () => {
  await articleTask();
  mock(() => {
    throw Error("network");
  });
  for (let i = 0; i < 8; i++) {
    await stmt(
      env.DB,
      "UPDATE integration_tasks SET next_at=0 WHERE id=?",
      "article-task",
    ).run();
    await processTask(env, "article-task");
  }
  assert.equal((await task()).state, "intervention");
  assert.equal((await task()).attempts, 8);
  await stmt(
    env.DB,
    "UPDATE integration_tasks SET state='processing',lease_until=0",
  ).run();
  mock(() => Response.json({ version: VERSION, posts: [], drafts: [] }));
  await reconcile(env);
  assert.equal((await task()).state, "intervention");
});
test("catalogue throttles polling and does not replace edited drafts; unknown metrics stay null", async () => {
  assert.equal((await weeklySummary(env)).metrics.publishedArticles, null);
  let calls = 0;
  mock(() => {
    calls++;
    return Response.json({ version: VERSION, posts: [], drafts: [] });
  });
  await Promise.all([reconcile(env), reconcile(env)]);
  assert.equal(calls, 1);
  assert.equal((await weeklySummary(env)).metrics.publishedArticles, 0);
});
test("wrong version is rejected without preparing newsletter; browser signatures are rejected", async () => {
  await articleTask();
  let calls = 0;
  mock(() => {
    calls++;
    return Response.json({
      version: VERSION,
      state: "available",
      article: { ...article, sha: "b".repeat(40) },
    });
  });
  await processTask(env, "article-task");
  assert.equal(calls, 1);
  assert.equal(
    (await rows(env.DB, "SELECT * FROM integration_links")).length,
    0,
  );
  const r = await sign(
    new Request("https://example.test/integration/v1/drafts", {
      method: "POST",
      headers: { Origin: "https://example.test" },
      body: "{}",
    }),
    env.STUDIO_INTEGRATION_SECRET!,
  );
  await assert.rejects(
    () => verify(r, env.STUDIO_INTEGRATION_SECRET),
    (e) => e instanceof Response && e.status === 403,
  );
});
test(
  "versioned protocol copies match across all services",
  {
    skip:
      !existsSync(
        new URL(
          "../../ADM/studio-editorial/src/ecosystem-contract.ts",
          import.meta.url,
        ),
      ) ||
      !existsSync(
        new URL(
          "../../crm-ecosystem-integration/shared/ecosystem-contract.ts",
          import.meta.url,
        ),
      )
        ? "Companion checkouts required"
        : false,
  },
  async () => {
    const source = await readFile(
      new URL("../packages/contracts/ecosystem.ts", import.meta.url),
      "utf8",
    );
    for (const path of [
      "../../ADM/studio-editorial/src/ecosystem-contract.ts",
      "../../crm-ecosystem-integration/shared/ecosystem-contract.ts",
    ])
      assert.equal(
        await readFile(new URL(path, import.meta.url), "utf8"),
        source,
      );
  },
);

test(
  "real handlers interoperate across three isolated D1 databases without sending or GitHub writes",
  {
    skip:
      !existsSync(
        new URL(
          "../../ADM/studio-editorial/src/ecosystem-contract.ts",
          import.meta.url,
        ),
      ) ||
      !existsSync(
        new URL(
          "../../crm-ecosystem-integration/shared/ecosystem-contract.ts",
          import.meta.url,
        ),
      )
        ? "Companion checkouts required"
        : false,
  },
  async () => {
    const studioDb = await mf.getD1Database("STUDIO_DB"),
      crmDb = await mf.getD1Database("CRM_DB");
    for (const [db, dir, names] of [
      [
        studioDb,
        "../../ADM/studio-editorial/migrations",
        ["0001_studio.sql", "0002_publish_lock.sql", "0003_ecosystem.sql"],
      ],
      [
        crmDb,
        "../../crm-ecosystem-integration/migrations",
        ["0001_editorial_documents.sql", "0005_editorial_originals.sql"],
      ],
    ] as const) {
      for (const name of names) {
        let sql = await readFile(
          new URL(`${dir}/${name}`, import.meta.url),
          "utf8",
        );
        sql = sql.replace(/^--.*$/gm, "");
        const triggers = sql.match(/CREATE TRIGGER[\s\S]*?END;/g) || [];
        sql = sql.replace(/CREATE TRIGGER[\s\S]*?END;/g, "");
        for (const command of [
          ...sql.split(";").filter((s) => s.trim()),
          ...triggers,
        ])
          await db.prepare(command).run();
      }
    }
    const studioModule = new URL(
      "../../ADM/studio-editorial/src/integration.ts",
      import.meta.url,
    ).href;
    const crmModule = new URL(
      "../../crm-ecosystem-integration/functions/_integration.ts",
      import.meta.url,
    ).href;
    const studio = await import(studioModule),
      crm = await import(crmModule);
    const markdown =
      "---\ntitle: Artigo\nsummary: Resumo\ncategory: processo\nstatus: published\npublish_at: 2026-01-01T10:00\n---\nTexto que não será transferido";
    const calls: string[] = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.startsWith(env.STUDIO_ORIGIN!))
        return studio.integrationRoute(input, {
          DB: studioDb,
          STUDIO_ORIGIN: env.STUDIO_ORIGIN,
          ECOSYSTEM_SECRET: env.STUDIO_INTEGRATION_SECRET,
          GITHUB_REF: "main",
          GITHUB_TOKEN: "isolated-github-token",
        });
      if (url.startsWith(env.CRM_ORIGIN!))
        return crm.integrationRoute(input, {
          DB: crmDb,
          ECOSYSTEM_SECRET: env.CRM_INTEGRATION_SECRET,
        });
      assert.ok(
        !init?.method || ["GET", "HEAD"].includes(init.method),
        "No external write permitted",
      );
      if (url.includes("/contents/"))
        return Response.json({
          type: "file",
          encoding: "base64",
          sha,
          size: 200,
          content: Buffer.from(markdown).toString("base64"),
        });
      if (url.includes("/check-runs"))
        return Response.json({
          check_runs: [
            {
              name: "Cloudflare Pages",
              status: "completed",
              conclusion: "success",
            },
          ],
        });
      if (url.includes("/commits/"))
        return Response.json({ sha: "b".repeat(40) });
      if (url === article.url) return new Response(null, { status: 200 });
      throw Error("Unexpected external service");
    }) as typeof fetch;
    const t = (await requestStudio(env, packageId, input)) as any;
    await processTask(env, t.id);
    assert.equal((await task()).state, "completed");
    assert.equal(
      (await studioDb.prepare("SELECT COUNT(*) n FROM drafts").first<any>()).n,
      1,
    );
    await articleTask();
    await processTask(env, "article-task");
    const newsletter = await crmDb
      .prepare("SELECT payload FROM editorial_documents WHERE kind='draft'")
      .first<any>();
    assert.ok(newsletter);
    const payload = JSON.parse(newsletter.payload);
    assert.equal(payload.schemaVersion, 3);
    assert.equal(payload.status, "draft");
    assert.equal(payload.buttondownId, undefined);
    assert.ok(!payload.content.includes("Texto que não será transferido"));
    assert.ok(!calls.some((c) => c.includes("buttondown")));
    assert.equal(
      (
        await first<any>(
          env.DB,
          "SELECT state FROM integration_tasks WHERE id='article-task'",
        )
      )?.state,
      "completed",
    );
  },
);

test("historical publication waits for explicit individual approval before CRM creation", async () => {
  await stmt(
    env.DB,
    "INSERT OR REPLACE INTO integration_control(id,next_at) VALUES ('activation',?)",
    Date.now(),
  ).run();
  await articleTask();
  let crmCalls = 0;
  mock((r) => {
    if (r.url.startsWith(env.STUDIO_ORIGIN!))
      return Response.json({ version: VERSION, state: "available", article });
    crmCalls++;
    return Response.json({
      version: VERSION,
      id: "historical-newsletter",
      adminUrl: env.CRM_ORIGIN + "/editor/historical-newsletter",
    });
  });
  await processTask(env, "article-task");
  assert.equal(crmCalls, 0);
  assert.equal((await task()).error, "backlog_review");
  assert.equal((await task()).state, "intervention");
  await retryTask(env, "article-task");
  await processTask(env, "article-task");
  assert.equal(crmCalls, 1);
  assert.equal((await task()).state, "completed");
});

test("CRM Service Auth credentials stay on CRM requests and never enter the response", async () => {
  await articleTask();
  const isolated = {
    ...env,
    CRM_ACCESS_CLIENT_ID: "isolated-access-client",
    CRM_ACCESS_CLIENT_SECRET: "isolated-access-secret",
  };
  let calls = 0;
  mock((r) => {
    if (r.url.startsWith(env.STUDIO_ORIGIN!)) {
      assert.equal(r.headers.get("CF-Access-Client-Secret"), null);
      return Response.json({ version: VERSION, state: "available", article });
    }
    calls++;
    assert.equal(
      r.headers.get("CF-Access-Client-Id"),
      isolated.CRM_ACCESS_CLIENT_ID,
    );
    assert.equal(
      r.headers.get("CF-Access-Client-Secret"),
      isolated.CRM_ACCESS_CLIENT_SECRET,
    );
    return Response.json({
      version: VERSION,
      id: "scoped-access-draft",
      adminUrl: env.CRM_ORIGIN + "/editor/scoped-access-draft",
    });
  });
  await processTask(isolated, "article-task");
  assert.equal(calls, 1);
  assert.equal((await task()).state, "completed");
  assert.ok(
    !JSON.stringify(await integrationOverview(isolated)).includes(
      isolated.CRM_ACCESS_CLIENT_SECRET!,
    ),
  );
});

test("invalid and expired service signatures are rejected without outgoing calls", async () => {
  const secret = env.STUDIO_INTEGRATION_SECRET!;
  const time = String(Date.now() - 600000);
  const url = "https://studio.marioserafim.com.br/integration/v1/catalogue";
  const expired = await signature(
    secret,
    `${time}\nGET\n/integration/v1/catalogue\n`,
  );
  for (const sig of ["0".repeat(64), expired]) {
    const request = new Request(url, {
      headers: { "X-Ecosystem-Time": time, "X-Ecosystem-Signature": sig },
    });
    await assert.rejects(
      () => verify(request, secret),
      (e) => e instanceof Response && e.status === 401,
    );
  }
});

test("staging destinations require explicit staging flag and exact Lastro origin", async () => {
  const staged = {
    ...env,
    ENVIRONMENT: "production",
    ALLOWED_ORIGIN:
      "https://lastro-ecosystem-staging.marioserafim-da.workers.dev",
    STUDIO_ORIGIN:
      "https://studio-ecosystem-staging.marioserafim-da.workers.dev",
    CRM_ORIGIN: "https://crm-ecosystem-staging.pages.dev",
  };
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({
      ...studioResult,
      adminUrl: staged.STUDIO_ORIGIN + "/editor/test",
    });
  }) as typeof fetch;
  const t = (await requestStudio(staged, packageId, input)) as any;
  await processTask(staged, t.id);
  assert.equal(calls, 0);
  await retryTask(staged, t.id);
  await processTask({ ...staged, ECOSYSTEM_STAGING: "true" }, t.id);
  assert.equal(calls, 1);
  assert.equal((await task()).state, "completed");
});
