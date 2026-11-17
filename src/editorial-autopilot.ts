import { z } from "zod";
import {
  EDITORIAL_ARTICLES,
  EDITORIAL_MEMORY,
  EDITORIAL_VERSION,
  editorialId,
  editorialBodyCharacters,
  editorialReferences,
  EDITORIAL_MIN_CHARACTERS,
  EDITORIAL_MAX_CHARACTERS,
  editorialUrl,
  type EditorialArticle,
  type EditorialMemory,
  type EditorialReceipt,
  type EditorialReference,
} from "../packages/contracts/editorial-article";
import type {
  EditorialEligibility,
  EditorialOverview,
  EditorialRun,
  EditorialRunStatus,
} from "../packages/contracts/editorial-autopilot";
import { first, id, rows, stmt } from "./db";
import type { Env } from "./env";
import { ApiFault } from "./errors";
import { remote, RemoteIntegrationFault } from "./integration";
import { editorialDay } from "./schedule";
import { googleTrends, googleTrendsStatus } from "./google-trends";
import {
  editorialCandidates,
  inspectEditorialCandidates,
  repeatsArticle,
  selectEditorialSources,
  sourceFingerprint,
  type SelectedSource,
  terms,
} from "./editorial-sources";
import {
  editorialPayload,
  EDITORIAL_MODEL,
  EDITORIAL_RESERVATION,
  completeEditorialArticle,
  measuredEditorialCost,
  editorialReportHasFormat,
  editorialVerificationFindings,
  generateEditorialArticle,
  reserveEditorialBudget,
  validateEditorialReport,
  validateGeneratedArticle,
  verifyEditorialArticle,
} from "./editorial-generation";

export const EDITORIAL_CRON = "0,13,17,43,47 * * * *";
const maxAttempts = 4;
const leaseMs = 16 * 60_000; // Scheduled Workers can live up to 15 minutes.
const reasons = {
  sources:
    "O Radar ainda não encontrou referências autorizadas de publicações independentes que sustentem a mesma pauta.",
  memory: "O Studio não conseguiu fornecer a memória editorial.",
  budget: "Orçamento de Workers AI indisponível.",
  repeat: "Título ou argumento muito próximo de um texto recente.",
  generation: "A chamada à IA falhou.",
  interrupted: "A execução foi interrompida após iniciar a inferência.",
  generation_format: "O modelo não devolveu os campos exigidos.",
  verification_format: "O verificador devolveu uma resposta inválida.",
  length:
    "O corpo editorial ficou fora do intervalo de 1.900 a 2.000 caracteres.",
  length_long: "O corpo editorial excedeu 2.000 caracteres.",
  verification:
    "O artigo não passou nas verificações de formato, originalidade ou suporte factual.",
  permission: "Uma referência perdeu autorização ou mudou durante a execução.",
  studio: "Envio ao Studio indisponível. O artigo foi preservado para reenvio.",
  authentication:
    "O Studio recusou a autenticação da integração. Revise a configuração antes de reenviar.",
  conflict:
    "O Studio encontrou um conflito com esse rascunho. Revise a execução antes de tentar novamente.",
  deleted: "O rascunho associado foi excluído no Studio.",
  contract:
    "O Studio recusou o contrato ou o rascunho correspondente foi excluído.",
  technical: "Falha técnica durante a pesquisa.",
  expired: "A data editorial encerrou antes da geração.",
};
type Reason = keyof typeof reasons;
type RunRow = {
  kind: "daily" | "homologation";
  verified_payload_sha256: string | null;
  release_at: number;
  relevance: EditorialRun["relevance"] | null;
  id: string;
  editorial_date: string;
  status: EditorialRunStatus;
  started_at: number;
  updated_at: number;
  attempts: number;
  next_at: number | null;
  lease_token: string | null;
  lease_until: number;
  reason: Reason | null;
  theme: string | null;
  sources_json: string | null;
  payload: string | null;
  receipt: string | null;
  body_characters: number | null;
};
const memorySchema = z.strictObject({
  version: z.literal(EDITORIAL_VERSION),
  items: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(160),
        summary: z.string().max(300),
        argument: z.string().max(600),
      }),
    )
    .max(30),
});
const receiptSchema = z.strictObject({
  version: z.literal(EDITORIAL_VERSION),
  id: z.string().regex(editorialId),
  revision: z.number().int().positive(),
  adminUrl: z.string(),
});
const available = (env: Env) =>
  env.EDITORIAL_AUTOPILOT_FREE_CONFIRMED === "true" &&
  !!env.AI &&
  env.INTEGRATION_ENABLED === "true" &&
  !!env.STUDIO_ORIGIN &&
  (env.STUDIO_INTEGRATION_SECRET?.length ?? 0) >= 32;
const iso = (at: number) => new Date(at).toISOString();
const payloadDigest = async (payload: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
export function nextEditorialExecution(at: number) {
  const today = Date.parse(editorialDay(at) + "T08:00:00-03:00");
  return today > at ? today : today + 86400000;
}
function checkAvailable(env: Env) {
  if (!available(env))
    throw new ApiFault(
      503,
      "editorial_unavailable",
      "Configure Workers AI, franquia e integração com o Studio para usar o autopiloto.",
    );
}
const canRetry = (run: RunRow, today: string) =>
  (run.status === "failed" || run.status === "skipped") &&
  (run.attempts < maxAttempts || run.reason === "sources") &&
  (run.payload
    ? ["studio", "authentication", "conflict"].includes(run.reason ?? "")
    : run.editorial_date === today &&
      ["sources", "memory", "budget", "technical"].includes(run.reason ?? ""));

function runView(run: RunRow, today: string): EditorialRun {
  const sources: SelectedSource[] = run.sources_json
    ? JSON.parse(run.sources_json)
    : [];
  const article: EditorialArticle | null = run.payload
    ? JSON.parse(run.payload)
    : null;
  return {
    kind: run.kind,
    relevance: run.relevance ?? undefined,
    id: run.id,
    bodyCharacters:
      run.body_characters ??
      (article
        ? editorialBodyCharacters(
            article.markdown.slice(
              0,
              -editorialReferences(article.references).length,
            ),
          )
        : null),
    date: run.editorial_date,
    updatedAt: iso(run.updated_at),
    status: run.status,
    title: article?.title ?? null,
    theme: run.theme,
    sources: sources.map(({ reference }) => reference),
    studio: run.receipt ? JSON.parse(run.receipt) : null,
    attempts: run.attempts,
    reason: run.reason ? reasons[run.reason] : null,
    retryAt:
      run.next_at !== null && run.status === "failed" ? iso(run.next_at) : null,
    canRetry: canRetry(run, today),
  };
}

export async function editorialOverview(
  env: Env,
  at = Date.now(),
): Promise<EditorialOverview> {
  const [setting, history, lastDraft, reserve] = await Promise.all([
    first<{ enabled: number }>(
      env.DB,
      "SELECT enabled FROM editorial_autopilot_settings WHERE id=1",
    ),
    rows<RunRow>(
      env.DB,
      "SELECT * FROM editorial_autopilot_runs ORDER BY editorial_date DESC,updated_at DESC,id DESC LIMIT 30",
    ),
    first<RunRow>(
      env.DB,
      "SELECT * FROM editorial_autopilot_runs WHERE status='draft_created' ORDER BY editorial_date DESC,updated_at DESC,id DESC LIMIT 1",
    ),
    rows<{
      id: string;
      theme: string;
      category: string;
      relevance: string;
      created_at: number;
      expires_at: number;
      sources_json: string;
    }>(
      env.DB,
      "SELECT * FROM editorial_topic_reserve WHERE expires_at>? ORDER BY created_at,id",
      at,
    ),
  ]);
  const enabled = !!setting?.enabled,
    configured = available(env),
    today = editorialDay(at);
  const topics = reserve.map((item) => ({
    id: item.id,
    theme: item.theme,
    category: item.category,
    relevance: item.relevance,
    validatedAt: iso(item.created_at),
    expiresAt: iso(item.expires_at),
    sources: JSON.parse(item.sources_json) as EditorialReference[],
  }));
  const reservedIds = topics.flatMap(({ sources }) =>
    sources.map((s) => s.contentId),
  );
  const validIds = new Set(
    reservedIds.length
      ? (await editorialCandidates(env.DB, at, reservedIds)).map(
          (s) => s.reference.contentId,
        )
      : [],
  );
  return {
    reserve: topics.map((topic) => ({
      ...topic,
      blockedReason: topic.sources.every((s) => validIds.has(s.contentId))
        ? undefined
        : "Uma referência da reserva perdeu elegibilidade.",
    })),
    available: configured,
    enabled,
    nextExecution:
      enabled && configured ? iso(nextEditorialExecution(at)) : null,
    history: history.map((run) => runView(run, today)),
    latestDraft: lastDraft ? runView(lastDraft, today) : null,
  };
}

export async function setEditorialAutomation(env: Env, enabled: boolean) {
  if (enabled) checkAvailable(env);
  await stmt(
    env.DB,
    "UPDATE editorial_autopilot_settings SET enabled=? WHERE id=1",
    Number(enabled),
  ).run();
  return { enabled };
}

async function enqueue(env: Env, at: number, automatic: boolean) {
  const date = editorialDay(at);
  const queued = await first<RunRow>(
    env.DB,
    `INSERT INTO editorial_autopilot_runs
    (id,editorial_date,status,started_at,updated_at,next_at,release_at)
    SELECT ?,?,'scheduled',?,?,?,? WHERE ?=0 OR (SELECT enabled FROM editorial_autopilot_settings WHERE id=1)=1
    ON CONFLICT(editorial_date) WHERE kind='daily' DO NOTHING RETURNING *`,
    id(),
    date,
    at,
    at,
    at,
    automatic ? Date.parse(date + "T08:00:00-03:00") : 0,
    Number(automatic),
  );
  return (
    queued ??
    first<RunRow>(
      env.DB,
      "SELECT * FROM editorial_autopilot_runs WHERE editorial_date=? AND kind='daily'",
      date,
    )
  );
}

export async function queueEditorialRun(env: Env, at = Date.now()) {
  checkAvailable(env);
  const run = await enqueue(env, at, false);
  return runView(run!, editorialDay(at));
}

export async function queueEditorialHomologation(
  env: Env,
  runId: string,
  at = Date.now(),
) {
  checkAvailable(env);
  const date = editorialDay(at);
  const run =
    (await first<RunRow>(
      env.DB,
      `INSERT INTO editorial_autopilot_runs
      (id,editorial_date,kind,status,started_at,updated_at,next_at)
      VALUES (?,?,'homologation','scheduled',?,?,?)
      ON CONFLICT(id) DO NOTHING RETURNING *`,
      runId,
      date,
      at,
      at,
      at,
    )) ??
    (await first<RunRow>(
      env.DB,
      "SELECT * FROM editorial_autopilot_runs WHERE id=? AND kind='homologation'",
      runId,
    ));
  if (!run)
    throw new ApiFault(
      409,
      "editorial_run_conflict",
      "Identificador de execução indisponível.",
    );
  return runView(run, date);
}

export async function dispatchEditorialHomologation(
  env: Env,
  runId: string,
  authorization: string | undefined,
) {
  const token = authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!editorialId.test(runId) || !token)
    throw new ApiFault(
      401,
      "editorial_dispatch_denied",
      "Autorização de despacho inválida.",
    );
  checkAvailable(env);
  const at = Date.now();
  const row = await first<RunRow>(
    env.DB,
    `UPDATE editorial_autopilot_runs SET dispatch_hash=NULL,dispatch_expires_at=NULL
     WHERE id=? AND kind='homologation' AND status='scheduled' AND attempts=0
       AND editorial_date=? AND dispatch_hash=? AND dispatch_expires_at>? RETURNING *`,
    runId,
    editorialDay(at),
    await payloadDigest(token),
    at,
  );
  if (!row)
    throw new ApiFault(
      401,
      "editorial_dispatch_denied",
      "Autorização de despacho inválida.",
    );
  return processRequestedEditorial(env, runView(row, editorialDay(at)));
}

export async function retryEditorialRun(
  env: Env,
  runId: string,
  at = Date.now(),
) {
  checkAvailable(env);
  const current = await first<RunRow>(
    env.DB,
    "SELECT * FROM editorial_autopilot_runs WHERE id=?",
    runId,
  );
  const result =
    current &&
    canRetry(current, editorialDay(at)) &&
    (await first<RunRow>(
      env.DB,
      `UPDATE editorial_autopilot_runs SET status='scheduled',updated_at=?,next_at=?
      WHERE id=? AND status=? AND attempts=? AND lease_token IS NULL RETURNING *`,
      at,
      at,
      runId,
      current.status,
      current.attempts,
    ));
  if (!result)
    throw new ApiFault(
      409,
      "editorial_not_retryable",
      "Execução indisponível para reprocessamento.",
    );
  return runView(result, editorialDay(at));
}

export async function processRequestedEditorial(env: Env, run: EditorialRun) {
  if (run.status !== "scheduled") return run;
  await runEditorialQueue(env, Date.now(), run.id);
  const current = await first<RunRow>(
    env.DB,
    "SELECT * FROM editorial_autopilot_runs WHERE id=?",
    run.id,
  );
  return current ? runView(current, editorialDay()) : run;
}

async function savedEditorialMemory(env: Env) {
  const past = await rows<{ sources_json: string; memory: string | null }>(
    env.DB,
    `
    SELECT sources_json,CASE WHEN status<>'draft_created' THEN json_object('title',json_extract(payload,'$.title'),
      'summary',json_extract(payload,'$.summary'),'argument',json_extract(payload,'$.argument')) END memory
    FROM editorial_autopilot_runs WHERE payload IS NOT NULL ORDER BY editorial_date DESC LIMIT 30`,
  );
  const privateMemory: EditorialMemory[] = past.flatMap((row) =>
    row.memory ? [JSON.parse(row.memory)] : [],
  );
  const sources: EditorialReference[] = past.flatMap((row) =>
    (JSON.parse(row.sources_json) as SelectedSource[]).map(
      ({ reference }) => reference,
    ),
  );
  return { history: privateMemory, sources };
}

async function editorialMemory(env: Env) {
  const [external, local] = await Promise.all([
    remote(env, "studio", EDITORIAL_MEMORY),
    savedEditorialMemory(env),
  ]);
  return {
    ...local,
    history: [...memorySchema.parse(external).items, ...local.history],
  };
}

export async function editorialEligibility(
  env: Env,
  at = Date.now(),
): Promise<EditorialEligibility> {
  const [inspected, memory, trendResult, collection] = await Promise.all([
    inspectEditorialCandidates(env.DB, at),
    savedEditorialMemory(env),
    googleTrendsStatus(at),
    rows<{ name: string; last_success: string | null; error: string | null }>(
      env.DB,
      `SELECT s.name,s.last_success_at last_success,r.error
       FROM sources s LEFT JOIN ingestion_runs r ON r.id=(
         SELECT id FROM ingestion_runs WHERE source_id=s.id
         ORDER BY started_at DESC,id DESC LIMIT 1)
       WHERE s.status='approved' AND json_extract(s.config_json,'$.metadataAllowed')=1
       ORDER BY s.name`,
    ),
  ]);
  const trends = trendResult.items;
  const candidates = inspected.flatMap(({ candidate }) =>
    candidate ? [candidate] : [],
  );
  const recent = inspected.filter((item) => item.recent);
  const exclusions = new Map<
    string,
    EditorialEligibility["exclusions"][number]
  >();
  for (const { reason, title, publication, url } of recent) {
    if (!reason) continue;
    const group = exclusions.get(reason) ?? { reason, count: 0, examples: [] };
    group.count++;
    if (group.examples.length < 2)
      group.examples.push({
        title,
        publication,
        url: editorialUrl(url) ? url : null,
      });
    exclusions.set(reason, group);
  }
  const group = selectEditorialSources(
    candidates,
    memory.history,
    memory.sources,
    at,
    trends.map((trend) => trend.title),
    true,
  );
  return {
    trendsAvailable: trendResult.regions.some((region) => region.available),
    trendsError: trendResult.regions.every((region) => region.available)
      ? null
      : "Consulta indisponível em um ou mais países.",
    trendRegions: trendResult.regions,
    collection: {
      active: collection.length,
      functional: collection.filter(
        (source) => source.last_success && !source.error,
      ).length,
      issues: collection
        .filter((source) => source.error || !source.last_success)
        .map((source) => ({
          name: source.name,
          reason:
            source.error === "upstream_403"
              ? "O provedor recusou a coleta (HTTP 403)."
              : source.error
                ? "A última tentativa de coleta falhou."
                : "Aguardando a primeira coleta bem-sucedida.",
        })),
    },
    trends,
    recent: {
      references: recent.length,
      rssDescriptions: recent.filter(({ hasDescription }) => hasDescription)
        .length,
      eligible: recent.filter(({ candidate }) => candidate).length,
    },
    eligible: candidates.length,
    publications: new Set(candidates.map(({ reference }) => reference.sourceId))
      .size,
    exclusions: [...exclusions.values()].sort((a, b) => b.count - a.count),
    selection: group
      ? {
          theme: group.theme,
          sources: group.sources.map(({ reference }) => reference),
        }
      : null,
  };
}

export async function runEditorialQueue(
  env: Env,
  at = Date.now(),
  targetRun?: string,
) {
  if (!available(env)) return;
  const today = editorialDay(at),
    token = id();
  // The two expired states are ambiguous: the provider may already have billed
  // a call. Only research and delivery can be replayed automatically.
  await stmt(
    env.DB,
    `UPDATE editorial_autopilot_runs SET status=CASE WHEN status IN ('generating','validating')
      THEN 'needs_review' WHEN payload IS NULL AND editorial_date<? THEN 'skipped' ELSE 'failed' END,
    reason=CASE WHEN status IN ('generating','validating') THEN 'interrupted'
      WHEN payload IS NULL AND editorial_date<? THEN 'expired'
      WHEN payload IS NOT NULL THEN 'studio' ELSE 'technical' END,
    next_at=NULL,lease_token=NULL,lease_until=0,updated_at=?
    WHERE (lease_token IS NOT NULL AND lease_until<=? AND (status IN ('generating','validating') OR attempts>=?))
      OR (payload IS NULL AND editorial_date<? AND next_at IS NOT NULL AND lease_until<=?)`,
    today,
    today,
    at,
    at,
    maxAttempts,
    today,
    at,
  ).run();
  const run = await first<RunRow>(
    env.DB,
    `UPDATE editorial_autopilot_runs
    SET status=CASE WHEN payload IS NULL THEN 'researching' ELSE 'sending' END,
      lease_token=?,lease_until=?,updated_at=?,attempts=attempts+1,reason=NULL,
      dispatch_hash=NULL,dispatch_expires_at=NULL
    WHERE id=(SELECT id FROM editorial_autopilot_runs r WHERE r.lease_until<=?
      AND ((r.next_at<=? AND (r.attempts<? OR (r.status='scheduled' AND r.reason='sources')))
        OR (r.status='failed' AND r.reason='sources' AND r.next_at IS NULL AND EXISTS (
          SELECT 1 FROM synopsis_evidence_cache e
          JOIN sources s ON s.id=e.source_id
          JOIN contents c ON c.source_id=e.source_id AND c.canonical_url=e.canonical_url
          WHERE e.evidence_json IS NOT NULL AND e.block_code IS NULL
            AND e.permission_version=s.synopsis_permission_version AND s.status='approved'
            AND c.editorial_status='approved' AND c.purged_at IS NULL
            AND e.observed_at>strftime('%Y-%m-%dT%H:%M:%fZ',r.updated_at/1000.0,'unixepoch')
        )))
      AND (r.editorial_date=? OR r.payload IS NOT NULL) AND (? IS NULL OR r.id=?)
      AND r.status IN ('scheduled','researching','sending','failed')
      AND NOT EXISTS(SELECT 1 FROM editorial_autopilot_runs active WHERE active.lease_until>?)
      ORDER BY r.editorial_date DESC,r.release_at DESC,r.started_at,r.id LIMIT 1) RETURNING *`,
    token,
    at + leaseMs,
    at,
    at,
    at,
    maxAttempts,
    today,
    targetRun ?? null,
    targetRun ?? null,
    at,
  );
  if (!run) return;
  const update = (sql: string, ...params: unknown[]) =>
    stmt(
      env.DB,
      `UPDATE editorial_autopilot_runs SET ${sql},updated_at=? WHERE id=? AND lease_token=?`,
      ...params,
      Date.now(),
      run.id,
      token,
    ).run();
  let measuredSpend: number | null = null;
  const finish = (
    status: EditorialRunStatus,
    reason: Reason | null = null,
    retry = false,
  ) =>
    update(
      "status=?,reason=?,next_at=?,settlement_neurons=COALESCE(settlement_neurons,?),lease_token=NULL,lease_until=0",
      status,
      reason,
      retry && run.attempts < maxAttempts ? Date.now() + 15 * 60_000 : null,
      measuredSpend !== null && measuredSpend <= EDITORIAL_RESERVATION
        ? measuredSpend
        : null,
    );

  let payload: EditorialArticle | null = run.payload
    ? JSON.parse(run.payload)
    : null;
  let selected: SelectedSource[] = run.sources_json
    ? JSON.parse(run.sources_json)
    : [];
  let inference = false;
  let verifiedHash = run.verified_payload_sha256;
  try {
    if (!payload) {
      const candidates = await editorialCandidates(env.DB, at);
      if (candidates.length < 2) return await finish("failed", "sources", true);
      const trends = await googleTrends(at);
      let memory;
      try {
        memory = await editorialMemory(env);
      } catch {
        return await finish("failed", "memory", true);
      }
      let group = selectEditorialSources(
        candidates,
        memory.history,
        memory.sources,
        at,
        trends.map((trend) => trend.title),
      );
      // Revalidate stored topics against current permissions and publication memory.
      // A newly available current topic always takes precedence over the reserve.
      if (!group) {
        const reserve = await rows<{ sources_json: string }>(
          env.DB,
          "SELECT sources_json FROM editorial_topic_reserve WHERE expires_at>? ORDER BY created_at,id",
          at,
        );
        for (const topic of reserve) {
          const ids = new Set(
            (JSON.parse(topic.sources_json) as EditorialReference[]).map(
              (s) => s.contentId,
            ),
          );
          group = selectEditorialSources(
            candidates.filter((s) => ids.has(s.reference.contentId)),
            memory.history,
            memory.sources,
            at,
            [],
            true,
          );
          if (group) break;
        }
      }
      group ??= selectEditorialSources(
        candidates,
        memory.history,
        memory.sources,
        at,
        [],
        true,
      );
      if (!group) return await finish("failed", "sources", true);
      selected = await Promise.all(
        group.sources.map(async (s) => ({
          reference: s.reference,
          fingerprint: await sourceFingerprint(s),
        })),
      );
      await update(
        "theme=?,sources_json=?,relevance=?",
        group.theme,
        JSON.stringify(selected),
        topicRelevance(
          group.sources.map((s) => s.reference),
          trends.map((t) => t.title),
          at,
        ),
      );
      const utcDay = iso(Date.now()).slice(0, 10);
      if (!(await reserveEditorialBudget(env.DB, utcDay, run.kind)))
        return await finish("failed", "budget");
      const claimed = await update(
        "status='generating',model=?,reserved_neurons=?,budget_day=?",
        EDITORIAL_MODEL,
        EDITORIAL_RESERVATION,
        utcDay,
      );
      if (!claimed.meta.changes) return;
      inference = true;
      const generation = await generateEditorialArticle(
        env,
        group.theme,
        group.sources,
        utcDay,
      );
      measuredSpend = measuredEditorialCost(generation.usage);
      let generated = generation.value;
      let bodyCharacters = generated
        ? editorialBodyCharacters(generated.markdown)
        : null;
      await update(
        "status='validating',generation_usage=?,body_characters=?",
        JSON.stringify(generation.usage),
        bodyCharacters,
      );
      if (
        generated &&
        bodyCharacters !== null &&
        bodyCharacters >= 1500 &&
        bodyCharacters < EDITORIAL_MIN_CHARACTERS &&
        measuredSpend !== null
      ) {
        if (iso(Date.now()).slice(0, 10) !== utcDay)
          return await finish("needs_review", "budget");
        const firstCost = measuredSpend;
        measuredSpend = null;
        const completion = await completeEditorialArticle(
          env,
          generated,
          group.sources,
          utcDay,
        );
        const completionCost = measuredEditorialCost(completion.usage);
        measuredSpend =
          completionCost === null ? null : firstCost + completionCost;
        generated = completion.value;
        bodyCharacters = editorialBodyCharacters(generated.markdown);
        await update(
          "completion_usage=?,body_characters=?",
          JSON.stringify(completion.usage),
          bodyCharacters,
        );
      }
      if (bodyCharacters === null)
        return await finish("needs_review", "generation_format");
      if (bodyCharacters < EDITORIAL_MIN_CHARACTERS)
        return await finish("needs_review", "length");
      if (bodyCharacters > EDITORIAL_MAX_CHARACTERS)
        return await finish("needs_review", "length_long");
      const article = validateGeneratedArticle(generated, group.sources);
      if (!article) return await finish("needs_review", "verification");
      if (repeatsArticle(article, memory.history))
        return await finish("needs_review", "repeat");
      if (iso(Date.now()).slice(0, 10) !== utcDay)
        return await finish("needs_review", "budget");
      const preparationCost = measuredSpend;
      measuredSpend = null;
      const verification = await verifyEditorialArticle(
        env,
        article,
        group.sources,
        utcDay,
      );
      const verificationCost = measuredEditorialCost(verification.usage);
      if (preparationCost !== null && verificationCost !== null)
        measuredSpend = preparationCost + verificationCost;
      await update(
        "verification_usage=?,verification_findings=?",
        JSON.stringify(verification.usage),
        JSON.stringify(editorialVerificationFindings(verification.value)),
      );
      if (!editorialReportHasFormat(verification.value))
        return await finish("needs_review", "verification_format");
      if (!validateEditorialReport(verification.value, article, group.sources))
        return await finish("needs_review", "verification");
      const approvedPayload = editorialPayload(
        run.id,
        run.editorial_date,
        group.category,
        article,
        group.sources,
      );
      const serialized = JSON.stringify(approvedPayload);
      verifiedHash = await payloadDigest(serialized);
      const saved = await update(
        "status='sending',payload=?,verified_payload_sha256=?,settlement_neurons=?",
        serialized,
        verifiedHash,
        measuredSpend !== null && measuredSpend <= EDITORIAL_RESERVATION
          ? measuredSpend
          : null,
      );
      if (!saved.meta.changes) return;
      payload = approvedPayload;
    }
    if (
      verifiedHash &&
      verifiedHash !== (await payloadDigest(JSON.stringify(payload)))
    )
      return await finish("needs_review", "verification");
    if (run.release_at > Date.now()) {
      await update(
        "status='sending',next_at=?,lease_token=NULL,lease_until=0",
        run.release_at,
      );
      return;
    }
    const sources = await editorialCandidates(
      env.DB,
      Date.now(),
      selected.map((s) => s.reference.contentId),
    );
    const fingerprints = await Promise.all(sources.map(sourceFingerprint));
    if (
      selected.length !== payload.references.length ||
      !selected.every((s) => fingerprints.includes(s.fingerprint))
    )
      return await finish("needs_review", "permission");
    const receipt: EditorialReceipt = receiptSchema.parse(
      await remote(env, "studio", EDITORIAL_ARTICLES, payload),
    );
    if (receipt.adminUrl !== `${env.STUDIO_ORIGIN}/editor/${receipt.id}`)
      throw Error("invalid_studio_receipt");
    await update(
      "status='draft_created',receipt=?,next_at=NULL,lease_token=NULL,lease_until=0",
      JSON.stringify(receipt),
    );
    await stmt(
      env.DB,
      `DELETE FROM editorial_topic_reserve WHERE EXISTS
      (SELECT 1 FROM json_each(sources_json) WHERE json_extract(value,'$.contentId') IN
        (SELECT value FROM json_each(?)))`,
      JSON.stringify(selected.map((s) => s.reference.contentId)),
    ).run();
  } catch (error) {
    if (payload) {
      const status =
        error instanceof RemoteIntegrationFault ? error.remoteStatus : null;
      if (status === 401 || status === 403)
        return finish("failed", "authentication");
      if (status === 409) return finish("failed", "conflict");
      if (status === 410) return finish("failed", "deleted");
      if (status === 400 || status === 422) return finish("failed", "contract");
      return finish("failed", "studio", true);
    }
    return inference
      ? finish("needs_review", "generation")
      : finish("failed", "technical", true);
  }
}

export async function scheduledEditorial(
  env: Env,
  scheduledTime: number,
  at = Date.now(),
) {
  if (!available(env)) return;
  const date = editorialDay(scheduledTime);
  if (date !== editorialDay(at)) return;
  if (scheduledTime >= Date.parse(date + "T07:00:00-03:00"))
    await enqueue(env, scheduledTime, true);
  await runEditorialQueue(env, at);
}

function topicRelevance(
  sources: EditorialReference[],
  trends: string[],
  at: number,
): NonNullable<EditorialRun["relevance"]> {
  const recent = sources.filter(
    (s) => at - Date.parse(s.publishedAt) <= 7 * 86400000,
  );
  const words = terms(recent.map((s) => s.title).join(" "));
  if (trends.some((title) => [...terms(title)].some((word) => words.has(word))))
    return "Em alta";
  return recent.length ? "Reflexão" : "Retroativo";
}

export async function refreshEditorialReserve(env: Env, at = Date.now()) {
  if (!available(env)) return;
  const [candidates, memory, trends] = await Promise.all([
    editorialCandidates(env.DB, at),
    editorialMemory(env),
    googleTrends(at),
  ]);
  const used = [...memory.sources];
  const updates = [stmt(env.DB, "DELETE FROM editorial_topic_reserve")];
  for (let index = 0; index < 7; index++) {
    const group =
      selectEditorialSources(
        candidates,
        memory.history,
        used,
        at,
        trends.map((t) => t.title),
      ) ??
      selectEditorialSources(candidates, memory.history, used, at, [], true);
    if (!group) break;
    const sources = group.sources.map((s) => s.reference);
    used.push(...sources);
    updates.push(
      stmt(
        env.DB,
        "INSERT INTO editorial_topic_reserve VALUES (?,?,?,?,?,?,?)",
        sources
          .map((s) => s.contentId)
          .sort()
          .join("/"),
        group.theme,
        group.category,
        topicRelevance(
          sources,
          trends.map((t) => t.title),
          at,
        ),
        JSON.stringify(sources),
        at,
        at + 86400000,
      ),
    );
  }
  await env.DB.batch(updates);
}
