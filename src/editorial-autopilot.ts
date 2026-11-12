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
import { remote } from "./integration";
import { editorialDay } from "./schedule";
import {
  editorialCandidates,
  inspectEditorialCandidates,
  repeatsArticle,
  selectEditorialSources,
  sourceFingerprint,
  type SelectedSource,
} from "./editorial-sources";
import {
  editorialPayload,
  EDITORIAL_MODEL,
  EDITORIAL_RESERVATION,
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
    "O Radar ainda não tem três referências autorizadas, independentes e conectadas.",
  memory: "O Studio não conseguiu fornecer a memória editorial.",
  budget: "Orçamento de Workers AI indisponível.",
  repeat: "Título ou argumento muito próximo de um texto recente.",
  generation:
    "A IA falhou ou a execução foi interrompida após o início da inferência.",
  length:
    "O corpo editorial ficou fora do intervalo de 1.900 a 2.000 caracteres.",
  verification:
    "O artigo não passou nas verificações de formato, originalidade ou suporte factual.",
  permission: "Uma referência perdeu autorização ou mudou durante a execução.",
  studio: "Envio ao Studio indisponível. O artigo foi preservado para reenvio.",
  contract:
    "O Studio recusou o contrato ou o rascunho correspondente foi excluído.",
  technical: "Falha técnica durante a pesquisa.",
  expired: "A data editorial encerrou antes da geração.",
};
type Reason = keyof typeof reasons;
type RunRow = {
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
  run.attempts < maxAttempts &&
  (run.status === "failed" || run.status === "skipped") &&
  (run.payload
    ? run.reason === "studio" || run.reason === "contract"
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
  const [setting, history, lastDraft] = await Promise.all([
    first<{ enabled: number }>(
      env.DB,
      "SELECT enabled FROM editorial_autopilot_settings WHERE id=1",
    ),
    rows<RunRow>(
      env.DB,
      "SELECT * FROM editorial_autopilot_runs ORDER BY editorial_date DESC LIMIT 30",
    ),
    first<RunRow>(
      env.DB,
      "SELECT * FROM editorial_autopilot_runs WHERE status='draft_created' ORDER BY editorial_date DESC LIMIT 1",
    ),
  ]);
  const enabled = !!setting?.enabled,
    configured = available(env),
    today = editorialDay(at);
  return {
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
    (id,editorial_date,status,started_at,updated_at,next_at)
    SELECT ?,?,'scheduled',?,?,? WHERE ?=0 OR (SELECT enabled FROM editorial_autopilot_settings WHERE id=1)=1
    ON CONFLICT(editorial_date) DO NOTHING RETURNING *`,
    id(),
    date,
    at,
    at,
    at,
    Number(automatic),
  );
  return (
    queued ??
    first<RunRow>(
      env.DB,
      "SELECT * FROM editorial_autopilot_runs WHERE editorial_date=?",
      date,
    )
  );
}

export async function queueEditorialRun(env: Env, at = Date.now()) {
  checkAvailable(env);
  const run = await enqueue(env, at, false);
  return runView(run!, editorialDay(at));
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
      `UPDATE editorial_autopilot_runs SET status='scheduled',updated_at=?,next_at=?,reason=NULL
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
  await runEditorialQueue(env, Date.now(), run.date);
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
  const [inspected, memory] = await Promise.all([
    inspectEditorialCandidates(env.DB, at),
    savedEditorialMemory(env),
  ]);
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
  );
  return {
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
  targetDate?: string,
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
    reason=CASE WHEN status IN ('generating','validating') THEN 'generation'
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
      lease_token=?,lease_until=?,updated_at=?,attempts=attempts+1,reason=NULL
    WHERE id=(SELECT id FROM editorial_autopilot_runs r WHERE r.next_at<=? AND r.lease_until<=? AND r.attempts<?
      AND (r.editorial_date=? OR r.payload IS NOT NULL) AND (? IS NULL OR r.editorial_date=?)
      AND r.status IN ('scheduled','researching','sending','failed')
      AND NOT EXISTS(SELECT 1 FROM editorial_autopilot_runs active WHERE active.lease_until>?)
      ORDER BY r.editorial_date DESC LIMIT 1) RETURNING *`,
    token,
    at + leaseMs,
    at,
    at,
    at,
    maxAttempts,
    today,
    targetDate ?? null,
    targetDate ?? null,
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
  const finish = (
    status: EditorialRunStatus,
    reason: Reason | null = null,
    retry = false,
  ) =>
    update(
      "status=?,reason=?,next_at=?,lease_token=NULL,lease_until=0",
      status,
      reason,
      retry && run.attempts < maxAttempts ? Date.now() + 15 * 60_000 : null,
    );

  let payload: EditorialArticle | null = run.payload
    ? JSON.parse(run.payload)
    : null;
  let selected: SelectedSource[] = run.sources_json
    ? JSON.parse(run.sources_json)
    : [];
  let inference = false;
  try {
    if (!payload) {
      const candidates = await editorialCandidates(env.DB, at);
      if (candidates.length < 3) return await finish("skipped", "sources");
      let memory;
      try {
        memory = await editorialMemory(env);
      } catch {
        return await finish("failed", "memory", true);
      }
      const group = selectEditorialSources(
        candidates,
        memory.history,
        memory.sources,
        at,
      );
      if (!group) return await finish("skipped", "sources");
      selected = await Promise.all(
        group.sources.map(async (s) => ({
          reference: s.reference,
          fingerprint: await sourceFingerprint(s),
        })),
      );
      await update(
        "theme=?,sources_json=?",
        group.theme,
        JSON.stringify(selected),
      );
      const utcDay = iso(Date.now()).slice(0, 10);
      if (!(await reserveEditorialBudget(env.DB, utcDay)))
        return await finish("failed", "budget");
      const claimed = await update(
        "status='generating',model=?,reserved_neurons=?",
        EDITORIAL_MODEL,
        EDITORIAL_RESERVATION,
      );
      if (!claimed.meta.changes) return;
      inference = true;
      const generation = await generateEditorialArticle(
        env,
        group.theme,
        group.sources,
        utcDay,
      );
      const bodyCharacters = generation.value
        ? editorialBodyCharacters(generation.value.markdown)
        : null;
      await update(
        "status='validating',generation_usage=?,body_characters=?",
        JSON.stringify(generation.usage),
        bodyCharacters,
      );
      if (
        bodyCharacters !== null &&
        (bodyCharacters < EDITORIAL_MIN_CHARACTERS ||
          bodyCharacters > EDITORIAL_MAX_CHARACTERS)
      )
        return await finish("needs_review", "length");
      const article = validateGeneratedArticle(generation.value, group.sources);
      if (!article) return await finish("needs_review", "verification");
      if (repeatsArticle(article, memory.history))
        return await finish("needs_review", "repeat");
      if (iso(Date.now()).slice(0, 10) !== utcDay)
        return await finish("needs_review", "budget");
      const verification = await verifyEditorialArticle(
        env,
        article,
        group.sources,
        utcDay,
      );
      await update("verification_usage=?", JSON.stringify(verification.usage));
      if (!validateEditorialReport(verification.value, article, group.sources))
        return await finish("needs_review", "verification");
      payload = editorialPayload(
        run.id,
        run.editorial_date,
        group.category,
        article,
        group.sources,
      );
      const saved = await update(
        "status='sending',payload=?",
        JSON.stringify(payload),
      );
      if (!saved.meta.changes) return;
    }
    const sources = await editorialCandidates(
      env.DB,
      Date.now(),
      selected.map((s) => s.reference.contentId),
    );
    const fingerprints = await Promise.all(sources.map(sourceFingerprint));
    if (
      selected.length !== 3 ||
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
  } catch (error) {
    if (payload) {
      const rejected = error instanceof ApiFault && error.status === 422;
      return finish("failed", rejected ? "contract" : "studio", !rejected);
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
  if (
    date !== editorialDay(at) ||
    scheduledTime !== Date.parse(date + "T08:00:00-03:00")
  )
    return;
  const run = await enqueue(env, scheduledTime, true);
  if (run) await runEditorialQueue(env, at, date);
}
