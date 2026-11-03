import { z } from "zod";
import type { Env } from "./env";
import { first, rows, stmt, id, now, OWNER } from "./db";
import { ApiFault, must } from "./errors";
import {
  VERSION,
  sign,
  draftInput,
  articleInput,
} from "../packages/contracts/ecosystem";
import {
  catalogueSchema,
  integrationResultSchema,
  type IntegrationRequest,
  type IntegrationTask,
} from "../packages/contracts/integration";
import type { ResearchPackage } from "../packages/contracts";
export const INTEGRATION_CRON = "17,47 * * * *";
const delay = 30 * 60 * 1000;
export function event(
  db: D1Database,
  type: string,
  source: string,
  destination: string,
  sourceId: string,
  version: string,
  taskId: string | null = null,
  attempt = 0,
) {
  return stmt(
    db,
    "INSERT OR IGNORE INTO integration_events VALUES (?,?,?,?,?,?,?,?,?)",
    id(),
    type,
    source,
    destination,
    sourceId,
    version,
    taskId,
    attempt,
    now(),
  );
}
async function remote(
  env: Env,
  target: "studio" | "crm",
  path: string,
  input?: unknown,
) {
  const origin = target === "studio" ? env.STUDIO_ORIGIN : env.CRM_ORIGIN;
  const secret =
    target === "studio"
      ? env.STUDIO_INTEGRATION_SECRET
      : env.CRM_INTEGRATION_SECRET;
  if (!origin || !secret || secret.length < 32)
    throw new ApiFault(
      503,
      "integration_not_configured",
      "Integração não configurada.",
    );
  const allowed =
    target === "studio"
      ? "https://studio.marioserafim.com.br"
      : "https://crm.marioserafim.com.br";
  if (origin !== allowed && env.ENVIRONMENT !== "development")
    throw new ApiFault(
      503,
      "integration_not_configured",
      "Origem não autorizada.",
    );
  const request = await sign(
    new Request(origin + path, {
      method: input === undefined ? "GET" : "POST",
      headers:
        input === undefined ? {} : { "Content-Type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    }),
    secret,
  );
  const response =
    target === "studio" && env.STUDIO
      ? await env.STUDIO.fetch(request)
      : await fetch(request);
  if (!response.ok)
    throw new ApiFault(
      response.status === 429 || response.status >= 500 ? 502 : 422,
      "integration_remote_error",
      "Serviço indisponível ou contrato recusado.",
    );
  // Bounded responses; no remote errors, headers or content are logged.
  const reader = response.body?.getReader();
  let body = "",
    size = 0;
  const decoder = new TextDecoder();
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 300000) {
        await reader.cancel();
        throw Error("response_limit");
      }
      body += decoder.decode(value, { stream: true });
    }
  return JSON.parse(body + decoder.decode());
}
export async function requestStudio(
  env: Env,
  packageId: string,
  input: IntegrationRequest,
) {
  must(
    await first(
      env.DB,
      "SELECT id FROM research_packages WHERE id=? AND user_id=?",
      packageId,
      OWNER,
    ),
  );
  const time = now();
  await stmt(
    env.DB,
    "INSERT OR IGNORE INTO integration_tasks(id,kind,source_id,version,payload,created_at,updated_at) VALUES (?,'studio',?,?,?,?,?)",
    id(),
    packageId,
    VERSION,
    JSON.stringify(input),
    time,
    time,
  ).run();
  return first(
    env.DB,
    "SELECT id,state,attempts,created_at,updated_at FROM integration_tasks WHERE kind='studio' AND source_id=? AND version=?",
    packageId,
    VERSION,
  );
}
async function discover(env: Env) {
  const token = id();
  const control = await first(
    env.DB,
    "UPDATE integration_control SET lease_until=?,token=? WHERE id='catalogue' AND next_at<=? AND lease_until<? RETURNING id",
    Date.now() + 120000,
    token,
    Date.now(),
    Date.now(),
  );
  if (!control) return;
  try {
    const catalogue = catalogueSchema.parse(
      await remote(env, "studio", "/integration/v1/catalogue"),
    );
    const time = now();
    const commands: D1PreparedStatement[] = [
      stmt(env.DB, "DELETE FROM integration_studio_drafts"),
    ];
    for (const p of catalogue.posts) {
      commands.push(
        stmt(
          env.DB,
          "INSERT OR IGNORE INTO integration_tasks(id,kind,source_id,version,created_at,updated_at) VALUES (?,'article',?,?,?,?)",
          id(),
          p.slug,
          p.sha,
          time,
          time,
        ),
      );
      commands.push(
        stmt(
          env.DB,
          "INSERT INTO integration_articles VALUES (?,?,'pending',NULL,NULL,NULL,?) ON CONFLICT(slug) DO UPDATE SET sha=excluded.sha,state='pending',title=NULL,canonical_url=NULL,publish_at=NULL,checked_at=excluded.checked_at WHERE sha<>excluded.sha",
          p.slug,
          p.sha,
          time,
        ),
      );
    }
    for (const d of catalogue.drafts)
      commands.push(
        stmt(
          env.DB,
          "INSERT INTO integration_studio_drafts VALUES (?,?,?,?,?,?,?,?)",
          d.id,
          d.originPackageId,
          d.slug,
          d.sourceSha,
          Number(d.privateChanges),
          d.revision,
          d.adminUrl,
          d.updatedAt,
        ),
      );
    // A confirmed removal must not remain a recommendation for a live article.
    const slugs = catalogue.posts.map((p) => p.slug);
    commands.push(
      stmt(
        env.DB,
        `UPDATE integration_articles SET state='removed',checked_at=? WHERE slug NOT IN (${slugs.map(() => "?").join(",") || "''"})`,
        time,
        ...slugs,
      ),
    );
    commands.push(
      stmt(
        env.DB,
        "UPDATE integration_control SET lease_until=0,next_at=?,last_success=?,error=NULL WHERE id='catalogue' AND token=?",
        Date.now() + delay,
        time,
        token,
      ),
    );
    await env.DB.batch(commands);
  } catch {
    await env.DB.batch([
      stmt(
        env.DB,
        "UPDATE integration_control SET lease_until=0,next_at=?,error='catalogue_unavailable' WHERE id='catalogue' AND token=?",
        Date.now() + delay,
        token,
      ),
      event(
        env.DB,
        "integration.failed",
        "studio",
        "lastro",
        "catalogue",
        String(Math.floor(Date.now() / delay)),
      ),
    ]);
  }
}
export async function processTask(env: Env, taskId: string) {
  const token = id();
  const t = await first<IntegrationTask>(
    env.DB,
    "UPDATE integration_tasks SET state='processing',attempts=attempts+1,cycle_attempts=cycle_attempts+1,lease_until=?,lease_token=?,updated_at=? WHERE id=? AND cycle_attempts<8 AND ((state IN ('pending','error') AND next_at<=?) OR (state='processing' AND lease_until<?)) RETURNING *",
    Date.now() + 120000,
    token,
    now(),
    taskId,
    Date.now(),
    Date.now(),
  );
  if (!t) return;
  const owned = () =>
    first(
      env.DB,
      "SELECT id FROM integration_tasks WHERE id=? AND lease_token=? AND state='processing'",
      t.id,
      token,
    );
  try {
    let target: "studio" | "crm", response: unknown;
    if (t.kind === "studio") {
      const p = must(
        await first<{ body_json: string }>(
          env.DB,
          "SELECT body_json FROM research_packages WHERE id=? AND user_id=?",
          t.source_id,
          OWNER,
        ),
      );
      const pack = JSON.parse(p.body_json) as ResearchPackage,
        params = JSON.parse(t.payload) as IntegrationRequest;
      const input = draftInput({
        version: VERSION,
        packageId: pack.id,
        title: params.title,
        objective: pack.config.objective,
        argument: params.argument,
        notes: pack.config.notes || "",
        outline: params.outline,
        references: pack.sources.map((s) => ({
          title: s.title,
          url: s.canonicalUrl,
          note: s.state.note || "",
        })),
      });
      target = "studio";
      response = await remote(env, target, "/integration/v1/drafts", input);
    } else {
      const status = z
        .object({
          version: z.literal(VERSION),
          state: z.enum([
            "private",
            "remote_changed",
            "github_draft",
            "scheduled",
            "isolated_branch",
            "build_pending",
            "build_failed",
            "available",
          ]),
          publishAt: z.string().optional(),
          article: z.unknown().optional(),
        })
        .parse(
          await remote(
            env,
            "studio",
            `/integration/v1/articles/${t.source_id}/${t.version}`,
          ),
        );
      if (!(await owned())) return;
      if (status.state !== "available") {
        const scheduled = status.publishAt
          ? Date.parse(
              /(?:Z|[+-]\d\d:\d\d)$/.test(status.publishAt)
                ? status.publishAt
                : status.publishAt + "-03:00",
            )
          : NaN;
        const terminal = [
          "remote_changed",
          "github_draft",
          "isolated_branch",
          "private",
        ].includes(status.state);
        await env.DB.batch([
          stmt(
            env.DB,
            "UPDATE integration_articles SET state=?,publish_at=?,checked_at=? WHERE slug=? AND sha=?",
            status.state,
            Number.isFinite(scheduled)
              ? new Date(scheduled).toISOString()
              : null,
            now(),
            t.source_id,
            t.version,
          ),
          stmt(
            env.DB,
            "UPDATE integration_tasks SET state=?,next_at=?,lease_until=0,error=?,updated_at=? WHERE id=? AND lease_token=?",
            terminal || t.cycle_attempts >= 8 ? "intervention" : "pending",
            Math.max(
              Date.now() + delay,
              Number.isFinite(scheduled) ? scheduled : 0,
            ),
            status.state,
            now(),
            t.id,
            token,
          ),
        ]);
        return;
      }
      const article = articleInput(status.article);
      if (article.slug !== t.source_id || article.sha !== t.version)
        throw Error("version_mismatch");
      await env.DB.batch([
        stmt(
          env.DB,
          "UPDATE integration_articles SET state='available',title=?,canonical_url=?,publish_at=?,checked_at=? WHERE slug=? AND sha=?",
          article.title,
          article.url,
          article.publishAt,
          now(),
          t.source_id,
          t.version,
        ),
        event(
          env.DB,
          "blog.article.published",
          "studio",
          "lastro",
          t.source_id,
          t.version,
          t.id,
        ),
      ]);
      const activation = await first<{ next_at: number }>(
        env.DB,
        "SELECT next_at FROM integration_control WHERE id='activation'",
      );
      if (
        activation &&
        Date.parse(article.publishAt) < activation.next_at &&
        JSON.parse(t.payload).backlogApproved !== true
      ) {
        await stmt(
          env.DB,
          "UPDATE integration_tasks SET state='intervention',lease_until=0,error='backlog_review',updated_at=? WHERE id=? AND lease_token=?",
          now(),
          t.id,
          token,
        ).run();
        return;
      }
      target = "crm";
      response = await remote(
        env,
        target,
        "/integration/v1/newsletter-drafts",
        article,
      );
    }
    const result = integrationResultSchema.parse(response);
    const draft =
      target === "studio"
        ? z
            .object({
              slug: z.string().max(160),
              revision: z.number().int().positive(),
              updatedAt: z.iso.datetime(),
            })
            .parse(response)
        : null;
    const origin = target === "studio" ? env.STUDIO_ORIGIN : env.CRM_ORIGIN;
    if (new URL(result.adminUrl).origin !== origin)
      throw Error("invalid_result_origin");
    // Every local completion is fenced against a stale lease, in a single D1 transaction.
    await env.DB.batch([
      ...(draft
        ? [
            stmt(
              env.DB,
              "INSERT OR IGNORE INTO integration_studio_drafts SELECT ?,?,?,NULL,1,?,?,? WHERE EXISTS(SELECT 1 FROM integration_tasks WHERE id=? AND lease_token=? AND state='processing')",
              result.id,
              t.source_id,
              draft.slug,
              draft.revision,
              result.adminUrl,
              draft.updatedAt,
              t.id,
              token,
            ),
          ]
        : []),
      stmt(
        env.DB,
        "INSERT OR IGNORE INTO integration_links SELECT ?,?,?,?, ?,?,? WHERE EXISTS(SELECT 1 FROM integration_tasks WHERE id=? AND lease_token=? AND state='processing')",
        target,
        t.source_id,
        t.version,
        result.id,
        result.adminUrl,
        now(),
        now(),
        t.id,
        token,
      ),
      stmt(
        env.DB,
        "INSERT OR IGNORE INTO integration_events SELECT ?,?,?,?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM integration_tasks WHERE id=? AND lease_token=? AND state='processing')",
        id(),
        target === "studio"
          ? "studio.draft.created"
          : "crm.newsletter.draft.created",
        "lastro",
        target,
        t.source_id,
        t.version,
        t.id,
        now(),
        t.id,
        token,
      ),
      stmt(
        env.DB,
        "UPDATE integration_tasks SET state='completed',lease_until=0,error=NULL,payload='{}',updated_at=? WHERE id=? AND lease_token=?",
        now(),
        t.id,
        token,
      ),
    ]);
  } catch (e) {
    if (!(await owned())) return;
    const permanent =
      e instanceof z.ZodError || (e instanceof ApiFault && e.status === 422);
    await env.DB.batch([
      stmt(
        env.DB,
        "UPDATE integration_tasks SET state=?,lease_until=0,next_at=?,error=?,updated_at=? WHERE id=? AND lease_token=?",
        permanent || t.cycle_attempts >= 8 ? "intervention" : "error",
        Date.now() + delay,
        permanent ? "invalid_contract" : "service_unavailable",
        now(),
        t.id,
        token,
      ),
      event(
        env.DB,
        "integration.failed",
        "lastro",
        t.kind === "studio" ? "studio" : "crm",
        t.source_id,
        t.version,
        t.id,
        t.attempts,
      ),
    ]);
  }
}
export async function reconcile(env: Env) {
  if (env.INTEGRATION_ENABLED !== "true") return { enabled: false };
  await stmt(
    env.DB,
    "INSERT OR IGNORE INTO integration_control(id,next_at) VALUES ('activation',?)",
    Date.now(),
  ).run();
  await discover(env);
  // A crashed final attempt must not stay processing forever.
  await stmt(
    env.DB,
    "UPDATE integration_tasks SET state='intervention',error='attempts_exhausted',updated_at=? WHERE state='processing' AND lease_until<? AND cycle_attempts>=8",
    now(),
    Date.now(),
  ).run();
  const tasks = await rows<{ id: string }>(
    env.DB,
    "SELECT id FROM integration_tasks WHERE cycle_attempts<8 AND ((state IN ('pending','error') AND next_at<=?) OR (state='processing' AND lease_until<?)) ORDER BY next_at,created_at,id LIMIT 3",
    Date.now(),
    Date.now(),
  );
  for (const t of tasks) await processTask(env, t.id);
  return { enabled: true, processed: tasks.length };
}
export async function retryTask(env: Env, taskId: string) {
  const result = await first(
    env.DB,
    "UPDATE integration_tasks SET payload=CASE WHEN error='backlog_review' THEN json_set(payload,'$.backlogApproved',json('true')) ELSE payload END,state='pending',cycle_attempts=0,next_at=0,error=NULL,updated_at=? WHERE id=? AND state IN ('error','intervention') RETURNING id,state",
    now(),
    taskId,
  );
  if (!result)
    throw new ApiFault(
      409,
      "task_not_retryable",
      "Tarefa não disponível para retentativa.",
    );
  return result;
}
export async function integrationOverview(env: Env) {
  const [tasks, links, articles, events, control, unused, drafts] =
    await Promise.all([
      rows(
        env.DB,
        "SELECT id,kind,source_id,version,state,attempts,error,created_at,updated_at,next_at FROM integration_tasks ORDER BY updated_at DESC LIMIT 100",
      ),
      rows<any>(
        env.DB,
        "SELECT * FROM integration_links ORDER BY updated_at DESC LIMIT 100",
      ),
      rows<any>(
        env.DB,
        "SELECT * FROM integration_articles ORDER BY checked_at DESC LIMIT 100",
      ),
      rows(
        env.DB,
        "SELECT * FROM integration_events ORDER BY created_at DESC LIMIT 100",
      ),
      first<any>(
        env.DB,
        "SELECT last_success,error,next_at FROM integration_control WHERE id='catalogue'",
      ),
      rows(
        env.DB,
        "SELECT s.content_id FROM workshop_selection s WHERE s.user_id=? AND NOT EXISTS(SELECT 1 FROM research_package_items p JOIN integration_links l ON l.kind='studio' AND l.source_id=p.package_id WHERE p.content_id=s.content_id)",
        OWNER,
      ),
      rows<any>(
        env.DB,
        "SELECT * FROM integration_studio_drafts ORDER BY updated_at DESC LIMIT 100",
      ),
    ]);
  const withoutNewsletter = await rows(
    env.DB,
    "SELECT a.* FROM integration_articles a WHERE a.state='available' AND NOT EXISTS(SELECT 1 FROM integration_links l WHERE l.kind='crm' AND l.source_id=a.slug AND l.version=a.sha) ORDER BY a.checked_at DESC LIMIT 100",
  );
  return {
    version: VERSION,
    timeZone: "America/Fortaleza",
    enabled: env.INTEGRATION_ENABLED === "true",
    freshness: control,
    tasks,
    studioDrafts: drafts,
    newsletters: links.filter((l) => l.kind === "crm"),
    articles,
    withoutNewsletter,
    events,
    recommendations: {
      continueDraft: drafts.filter(
        (d) =>
          d.private_changes ||
          !articles.some(
            (a) =>
              a.slug === d.slug &&
              a.sha === d.source_sha &&
              a.state === "available",
          ),
      ),
      articleWithoutNewsletter: withoutNewsletter,
      unusedReferences: unused,
      integrationAttention: tasks.filter((t: any) =>
        ["error", "intervention"].includes(t.state),
      ),
    },
    limit: 100,
  };
}
export async function weeklySummary(env: Env) {
  const from = new Date(Date.now() - 7 * 86400000).toISOString(),
    to = now();
  const count = async (sql: string, ...args: unknown[]) =>
    (await first<{ n: number }>(env.DB, sql, ...args))!.n;
  const fresh = await first<{ last_success: string | null }>(
    env.DB,
    "SELECT last_success FROM integration_control WHERE id='catalogue'",
  );
  const metric = async (type: string) =>
    count(
      "SELECT COUNT(*) n FROM integration_events WHERE type=? AND created_at>=? AND created_at<=?",
      type,
      from,
      to,
    );
  return {
    version: VERSION,
    timeZone: "America/Fortaleza",
    from,
    to,
    scope: "observed_integrations",
    lastSync: fresh?.last_success || null,
    metrics: {
      approvedReferences: await count(
        "SELECT COUNT(DISTINCT content_id) n FROM editorial_decisions WHERE decision='approved' AND created_at>=? AND created_at<=?",
        from,
        to,
      ),
      researchPackages: await count(
        "SELECT COUNT(*) n FROM research_packages WHERE created_at>=? AND created_at<=?",
        from,
        to,
      ),
      publishedArticles: fresh?.last_success
        ? await count(
            "SELECT COUNT(*) n FROM integration_articles WHERE state='available' AND publish_at>=? AND publish_at<=?",
            from,
            to,
          )
        : null,
      pendingDrafts: fresh?.last_success
        ? await count(
            "SELECT COUNT(*) n FROM integration_studio_drafts d WHERE d.private_changes=1 OR NOT EXISTS (SELECT 1 FROM integration_articles a WHERE a.slug=d.slug AND a.sha=d.source_sha AND a.state='available')",
          )
        : null,
      preparedNewsletters: fresh?.last_success
        ? await metric("crm.newsletter.draft.created")
        : null,
      integrationFailures: await metric("integration.failed"),
    },
  };
}
