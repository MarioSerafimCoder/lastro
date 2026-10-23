import {
  candidateSchema,
  type Candidate,
  type Quality,
  type Policy,
  type Source,
  type IngestionRun,
} from "../packages/contracts/index";
import { collect, UpstreamError, type Fetcher } from "./connectors";
import { cycleKey, nextCycle, retryAt } from "./schedule";
import {
  first,
  rows,
  stmt,
  id,
  now,
  policy,
  sourceView,
  type SourceRow,
} from "./db";
import { ApiFault, must } from "./errors";
import type { Env } from "./env";
import { canonicalUrl, normalizeCandidate, folded } from "./normalize";
import {
  automaticReviewReasons,
  evaluate,
  prefilter,
  matchedTopics,
} from "./quality";

export function identifierKey(
  i: Candidate["identifiers"][number],
  s: Source,
): string {
  return i.scheme === "source_guid" ? `${s.id}:${i.value}` : i.value;
}
export async function duplicate(
  db: D1Database,
  c: Candidate,
  s: Source,
): Promise<string | null> {
  let url = "";
  try {
    url = canonicalUrl(c.url);
  } catch {
    /* invalid candidates still audited */
  }
  const found = await first<{ id: string }>(
    db,
    `SELECT id FROM contents WHERE canonical_url=? UNION SELECT content_id id FROM content_identifiers WHERE (scheme,value) IN (SELECT json_extract(value,'$.scheme'),json_extract(value,'$.value') FROM json_each(?)) LIMIT 1`,
    url,
    JSON.stringify(
      c.identifiers.map((i) => ({ ...i, value: identifierKey(i, s) })),
    ),
  );
  return found?.id ?? null;
}
export async function saveContent(
  db: D1Database,
  c: Candidate,
  s: Source,
  q: Quality,
  status: "approved" | "pending",
  existingId?: string,
  reviewer: "owner" | "heuristic" = "heuristic",
): Promise<string> {
  const contentId = existingId ?? id(),
    at = now(),
    publicationId = c.publication ? `pub:${folded(c.publication)}` : null;
  const statements: D1PreparedStatement[] = [];
  if (publicationId)
    statements.push(
      stmt(
        db,
        "INSERT OR IGNORE INTO publications VALUES (?,?)",
        publicationId,
        c.publication,
      ),
    );
  statements.push(
    stmt(
      db,
      `INSERT INTO contents (id,source_id,publication_id,canonical_url,title,metadata_json,published_at,collected_at,kind,language,editorial_status,quality_score,quality_json)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET publication_id=excluded.publication_id, canonical_url=excluded.canonical_url,title=excluded.title,metadata_json=excluded.metadata_json,published_at=excluded.published_at,kind=excluded.kind,language=excluded.language,editorial_status=excluded.editorial_status,quality_score=excluded.quality_score,quality_json=excluded.quality_json`,
      contentId,
      s.id,
      publicationId,
      canonicalUrl(c.url),
      c.title,
      JSON.stringify(c),
      c.publishedAt,
      at,
      c.kind,
      c.language,
      status,
      q.score,
      JSON.stringify(q),
    ),
  );
  if (existingId)
    statements.push(
      stmt(db, "DELETE FROM content_authors WHERE content_id=?", contentId),
      stmt(db, "DELETE FROM content_taxonomies WHERE content_id=?", contentId),
      stmt(db, "DELETE FROM content_identifiers WHERE content_id=?", contentId),
    );
  statements.push(
    stmt(
      db,
      `INSERT INTO content_synopses(content_id,metadata_json,updated_at) VALUES (?,?,?)
      ON CONFLICT(content_id) DO UPDATE SET metadata_json=excluded.metadata_json,status='pending',text=NULL,evidence_json=NULL,attempts=0,validated_at=NULL,validation_json=NULL,validation_mode=NULL,lease_token=NULL,updated_at=excluded.updated_at,validation_note='Metadados alterados: exige nova revisão'
      WHERE content_synopses.metadata_json<>excluded.metadata_json`,
      contentId,
      JSON.stringify(c),
      at,
    ),
  );
  statements.push(
    stmt(
      db,
      "INSERT INTO content_identifiers SELECT ?,json_extract(value,'$.scheme'),json_extract(value,'$.value') FROM json_each(?)",
      contentId,
      JSON.stringify(
        c.identifiers.map((i) => ({ ...i, value: identifierKey(i, s) })),
      ),
    ),
  );
  const authors = c.authors.map((a, pos) => {
    // Never merge same-name authors without a persistent identifier.
    const identity = a.orcid ?? a.openalex ?? `${contentId}:${pos}`,
      authorId = `author:${identity}`;
    return {
      id: authorId,
      identity,
      name: a.name,
      pos,
      identifiers: [
        { scheme: "orcid", value: a.orcid },
        { scheme: "openalex", value: a.openalex },
      ].filter((i) => i.value !== null),
    };
  });
  const authorJson = JSON.stringify(authors);
  statements.push(
    stmt(
      db,
      "INSERT OR IGNORE INTO authors SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.identity') FROM json_each(?)",
      authorJson,
    ),
  );
  if (authors.some((a) => a.identifiers.length))
    statements.push(
      stmt(
        db,
        "INSERT OR IGNORE INTO author_identifiers SELECT json_extract(a.value,'$.id'),json_extract(i.value,'$.scheme'),json_extract(i.value,'$.value') FROM json_each(?) a,json_each(a.value,'$.identifiers') i",
        authorJson,
      ),
    );
  statements.push(
    stmt(
      db,
      "INSERT OR IGNORE INTO content_authors SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.pos') FROM json_each(?)",
      contentId,
      authorJson,
    ),
  );
  const topics = JSON.stringify([
    ...new Set([...c.topics, ...matchedTopics(c, s)].map(folded)),
  ]);
  statements.push(
    stmt(
      db,
      "INSERT OR IGNORE INTO taxonomies SELECT 'topic:'||value,'topic',value FROM json_each(?)",
      topics,
    ),
  );
  statements.push(
    stmt(
      db,
      "INSERT OR IGNORE INTO content_taxonomies SELECT ?,'topic:'||value FROM json_each(?)",
      contentId,
      topics,
    ),
  );
  statements.push(
    stmt(
      db,
      "INSERT INTO quality_evaluations VALUES (?,?,?,?,?,?)",
      id(),
      contentId,
      q.version,
      JSON.stringify(q),
      reviewer,
      at,
    ),
  );
  await db.batch(statements);
  return contentId;
}
export async function processCandidate(
  db: D1Database,
  raw: Candidate,
  s: Source,
  runId: string,
  at = Date.now(),
  activePolicy?: Policy,
): Promise<{ outcome: string; contentId: string | null; candidateId: string }> {
  let c = normalizeCandidate(raw);
  if (!s.summaryAllowed) c = { ...c, description: null };
  if (!s.imageAllowed) c = { ...c, imageUrl: null };
  c.topics = [...new Set([...c.topics, ...matchedTopics(c, s)])].slice(0, 30);
  const p = activePolicy ?? (await policy(db)),
    reasons = prefilter(c, s, at);
  let contentId: string | null = null,
    outcome = "rejected",
    autoApproved = false;
  // A later withdrawal must remove the existing reference from the index.
  if (s.status === "approved" && (c.retracted || c.access === "unavailable")) {
    contentId = await duplicate(db, c, s);
    if (contentId) {
      const change = {
        ...(c.retracted ? { retracted: true } : {}),
        ...(c.access === "unavailable"
          ? { access: "unavailable", accessNote: c.accessNote }
          : {}),
      };
      await stmt(
        db,
        "UPDATE contents SET editorial_status='rejected',metadata_json=json_patch(metadata_json,?) WHERE id=?",
        JSON.stringify(change),
        contentId,
      ).run();
    }
  }
  if (!reasons.length) {
    contentId = await duplicate(db, c, s);
    const existing = contentId
      ? await first<{ editorial_status: string; source_id: string }>(
          db,
          "SELECT editorial_status,source_id FROM contents WHERE id=?",
          contentId,
        )
      : null;
    if (
      !contentId ||
      (existing?.editorial_status === "pending" && existing.source_id === s.id)
    ) {
      const q = evaluate(c, s, p, at);
      const similar = await first<{ id: string }>(
        db,
        "SELECT id FROM contents WHERE source_id=? AND lower(trim(title))=lower(trim(?)) AND id<>? LIMIT 1",
        s.id,
        c.title,
        contentId ?? "",
      );
      const reviewReasons = automaticReviewReasons(c, s, p, q, at, !!similar);
      const approved = reviewReasons.length === 0;
      if (similar) reasons.push(`possible_title_duplicate:${similar.id}`);
      if (!approved) reasons.push(...reviewReasons);
      outcome = approved ? "approved" : contentId ? "duplicate" : "pending";
      try {
        if (!contentId || approved) {
          contentId = await saveContent(
            db,
            c,
            s,
            q,
            approved ? "approved" : "pending",
            contentId ?? undefined,
          );
          autoApproved = approved;
        }
      } catch (e) {
        const concurrent = await duplicate(db, c, s);
        if (!concurrent) throw e;
        contentId = concurrent;
        outcome = "duplicate";
        reasons.push("concurrent_duplicate");
        autoApproved = false;
      }
    } else {
      outcome = "duplicate";
      reasons.push("duplicate_identifier");
    }
  }
  const candidateId = id();
  const recordedAt = now();
  const statements = [
    stmt(
      db,
      "INSERT INTO ingestion_candidates VALUES (?,?,?,?,?,?,?,?)",
      candidateId,
      runId,
      s.id,
      contentId,
      JSON.stringify(c),
      outcome,
      JSON.stringify(reasons),
      recordedAt,
    ),
  ];
  if (autoApproved)
    statements.push(
      stmt(
        db,
        "INSERT INTO editorial_decisions VALUES (?,?,?,?,?,?)",
        id(),
        candidateId,
        contentId,
        "approved",
        `Aprovação automática: fonte autorizada, política ${p.version}, metadados e qualidade verificados.`,
        recordedAt,
      ),
    );
  if (statements.length === 1) await statements[0].run();
  else await db.batch(statements);
  return { outcome, contentId, candidateId };
}
export async function ingestSource(
  env: Env,
  sourceId: string,
  fetcher?: Fetcher,
  clock = Date.now(),
): Promise<IngestionRun> {
  const row = must(
      await first<SourceRow>(
        env.DB,
        "SELECT * FROM sources WHERE id=?",
        sourceId,
      ),
    ),
    source = sourceView(row);
  if (source.status !== "approved")
    throw new ApiFault(
      409,
      "source_not_approved",
      "A fonte precisa estar aprovada.",
    );
  if (!source.metadataAllowed)
    throw new ApiFault(
      409,
      "metadata_not_authorized",
      "Coleta não autorizada.",
    );
  const at = new Date(clock).toISOString(),
    leaseToken = id();
  const locked = await stmt(
    env.DB,
    `UPDATE sources SET lease_until=?,lease_token=?,last_processed_at=? WHERE id=? AND status='approved' AND (retry_at IS NULL OR retry_at<=?) AND (lease_until IS NULL OR lease_until<?) AND (EXISTS(SELECT 1 FROM ingestion_queue WHERE source_id=sources.id) OR ((next_fetch_at IS NULL OR next_fetch_at<=?) AND (last_cycle_key IS NULL OR last_cycle_key<>?)))`,
    new Date(clock + 300000).toISOString(),
    leaseToken,
    at,
    sourceId,
    at,
    at,
    at,
    cycleKey(source, clock),
  ).run();
  if (!locked.meta.changes)
    throw new ApiFault(
      409,
      "source_busy_or_not_due",
      "Fonte em coleta ou aguardando intervalo mínimo.",
    );
  const run: IngestionRun = {
    id: id(),
    sourceId,
    status: "running",
    received: 0,
    accepted: 0,
    pending: 0,
    rejected: 0,
    duplicates: 0,
    queuedRemaining: 0,
    error: null,
  };
  let retryAfter = 0;
  try {
    await stmt(
      env.DB,
      "UPDATE ingestion_runs SET status='failed',error='interrupted_run',finished_at=? WHERE source_id=? AND status='running'",
      at,
      sourceId,
    ).run();
    await stmt(
      env.DB,
      "INSERT INTO ingestion_runs (id,source_id,started_at,status,cycle_key) VALUES (?,?,?,?,?)",
      run.id,
      sourceId,
      at,
      "running",
      row.last_cycle_key,
    ).run();
    const hasQueue = await first(
      env.DB,
      "SELECT id FROM ingestion_queue WHERE source_id=? LIMIT 1",
      sourceId,
    );
    if (!hasQueue) {
      await env.DB.batch([
        stmt(
          env.DB,
          "UPDATE sources SET last_attempt_at=? WHERE id=?",
          at,
          sourceId,
        ),
        stmt(
          env.DB,
          "UPDATE ingestion_runs SET discovery=1,cycle_key=? WHERE id=?",
          cycleKey(source, clock),
          run.id,
        ),
      ]);
      const collected = await collect(source, env, row, fetcher);
      run.received = collected.items.length;
      await env.DB.batch([
        stmt(
          env.DB,
          "INSERT OR IGNORE INTO ingestion_queue (source_id,payload_json) SELECT ?,value FROM json_each(?)",
          sourceId,
          JSON.stringify(collected.items),
        ),
        stmt(
          env.DB,
          "UPDATE sources SET etag=?,last_modified=?,last_cycle_key=?,last_success_at=?,next_fetch_at=? WHERE id=? AND lease_token=?",
          collected.etag,
          collected.lastModified,
          cycleKey(source, clock),
          at,
          nextCycle(source, clock),
          sourceId,
          leaseToken,
        ),
      ]);
      if (collected.notModified) run.status = "not_modified";
    }
    const queued = await rows<{ id: number; payload_json: string }>(
      env.DB,
      "SELECT id,payload_json FROM ingestion_queue WHERE source_id=? ORDER BY id LIMIT ?",
      sourceId,
      env.INGEST_BATCH_SIZE === "1" ? 1 : 2,
    );
    const activePolicy = queued.length ? await policy(env.DB) : null;
    for (const queuedItem of queued) {
      const current = await first<{ status: string }>(
        env.DB,
        "SELECT status FROM sources WHERE id=?",
        sourceId,
      );
      if (current?.status !== "approved") {
        run.status = "partial";
        run.error = "source_approval_revoked";
        break;
      }
      const result = await processCandidate(
        env.DB,
        JSON.parse(queuedItem.payload_json),
        source,
        run.id,
        clock,
        activePolicy ?? undefined,
      );
      if (result.outcome === "approved") run.accepted++;
      else if (result.outcome === "pending") run.pending++;
      else if (result.outcome === "duplicate") run.duplicates++;
      else run.rejected++;
      await stmt(
        env.DB,
        "DELETE FROM ingestion_queue WHERE id=?",
        queuedItem.id,
      ).run();
    }
    run.queuedRemaining = (await first<{ count: number }>(
      env.DB,
      "SELECT COUNT(*) count FROM ingestion_queue WHERE source_id=?",
      sourceId,
    ))!.count;
    if (run.status === "running")
      run.status = run.queuedRemaining ? "partial" : "completed";
  } catch (e) {
    if (e instanceof UpstreamError) retryAfter = e.retryAt;
    run.status = "failed";
    run.error =
      e instanceof Error &&
      /^(upstream_\d+|invalid_[a-z_]+|unsupported_feed|response_too_large|network_or_parse_error|fetch_host_not_allowed|credential_in_source_url)$/.test(
        e.message,
      )
        ? e.message
        : "ingestion_failed";
  } finally {
    if (run.status === "failed")
      run.queuedRemaining = (await first<{ count: number }>(
        env.DB,
        "SELECT COUNT(*) count FROM ingestion_queue WHERE source_id=?",
        sourceId,
      ))!.count;
    await env.DB.batch([
      stmt(
        env.DB,
        "UPDATE ingestion_runs SET status=?,finished_at=?,accepted=?,pending=?,rejected=?,duplicates=?,queued_remaining=?,error=?,received=? WHERE id=?",
        run.status,
        now(),
        run.accepted,
        run.pending,
        run.rejected,
        run.duplicates,
        run.queuedRemaining,
        run.error,
        run.received,
        run.id,
      ),
      stmt(
        env.DB,
        "UPDATE sources SET lease_until=NULL,lease_token=NULL,retry_at=?,consecutive_failures=? WHERE id=? AND lease_token=?",
        run.status === "failed"
          ? retryAt(row.consecutive_failures, clock, retryAfter)
          : null,
        run.status === "failed" ? row.consecutive_failures + 1 : 0,
        sourceId,
        leaseToken,
      ),
    ]);
  }
  return run;
}
export async function scheduledIngest(
  env: Env,
  fetcher?: Fetcher,
  clock = Date.now(),
): Promise<void> {
  if (env.INGEST_ENABLED !== "true") return;
  const due = await rows<{ id: string }>(
    env.DB,
    "SELECT id FROM sources WHERE status='approved' AND json_extract(config_json,'$.metadataAllowed')=1 AND (retry_at IS NULL OR retry_at<=?) AND (lease_until IS NULL OR lease_until<?) AND (EXISTS(SELECT 1 FROM ingestion_queue WHERE source_id=sources.id) OR ((next_fetch_at IS NULL OR next_fetch_at<=?) AND (last_cycle_key IS NULL OR last_cycle_key<>CASE WHEN connector='openalex' THEN ? ELSE ? END))) ORDER BY COALESCE(last_processed_at,'') ASC,id LIMIT 1",
    new Date(clock).toISOString(),
    new Date(clock).toISOString(),
    new Date(clock).toISOString(),
    cycleKey({ connector: "openalex" }, clock),
    cycleKey({ connector: "rss" }, clock),
  );
  for (const s of due) {
    try {
      await ingestSource(env, s.id, fetcher, clock);
    } catch (e) {
      if (!(e instanceof ApiFault && e.status === 409))
        console.error("scheduled_ingestion_failed");
    }
  }
  if (!due.length)
    await env.DB.batch([
      stmt(env.DB, "DELETE FROM feed_snapshots WHERE expires_at<?", now()),
      stmt(
        env.DB,
        "DELETE FROM request_budgets WHERE expires_at<?",
        Math.floor(Date.now() / 1000),
      ),
    ]);
}
