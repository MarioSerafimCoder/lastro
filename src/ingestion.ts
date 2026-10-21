import {
  candidateSchema,
  type Candidate,
  type Quality,
  type Source,
  type IngestionRun,
} from "../packages/contracts/index";
import { collect, type Fetcher } from "./connectors";
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
import { evaluate, prefilter, matchedTopics } from "./quality";

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
): Promise<{ outcome: string; contentId: string | null; candidateId: string }> {
  let c = normalizeCandidate(raw);
  if (!s.summaryAllowed) c = { ...c, description: null };
  c.topics = [...new Set([...c.topics, ...matchedTopics(c, s)])].slice(0, 30);
  const p = await policy(db),
    reasons = prefilter(c, s, at);
  let contentId: string | null = null,
    outcome = "rejected";
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
    if (contentId) {
      outcome = "duplicate";
      reasons.push("duplicate_identifier");
    } else {
      const q = evaluate(c, s, p, at);
      const approved =
        s.autoApprove &&
        c.kind !== "paper" &&
        !!c.language &&
        !!c.publishedAt &&
        c.authors.length > 0 &&
        q.score >= p.approvalThreshold;
      outcome = approved ? "approved" : "pending";
      if (!approved)
        reasons.push(
          q.score < p.approvalThreshold
            ? "below_auto_threshold"
            : "manual_review_required",
        );
      try {
        contentId = await saveContent(
          db,
          c,
          s,
          q,
          approved ? "approved" : "pending",
        );
      } catch (e) {
        const concurrent = await duplicate(db, c, s);
        if (!concurrent) throw e;
        contentId = concurrent;
        outcome = "duplicate";
        reasons.push("concurrent_duplicate");
      }
    }
  }
  const candidateId = id();
  await stmt(
    db,
    "INSERT INTO ingestion_candidates VALUES (?,?,?,?,?,?,?,?)",
    candidateId,
    runId,
    s.id,
    contentId,
    JSON.stringify(c),
    outcome,
    JSON.stringify(reasons),
    now(),
  ).run();
  return { outcome, contentId, candidateId };
}
export async function ingestSource(
  env: Env,
  sourceId: string,
  fetcher?: Fetcher,
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
  const at = now(),
    leaseToken = id();
  const locked = await stmt(
    env.DB,
    `UPDATE sources SET lease_until=?,lease_token=? WHERE id=? AND status='approved' AND (lease_until IS NULL OR lease_until<?) AND (next_fetch_at IS NULL OR next_fetch_at<=? OR EXISTS(SELECT 1 FROM ingestion_queue WHERE source_id=sources.id))`,
    new Date(Date.now() + 300000).toISOString(),
    leaseToken,
    sourceId,
    at,
    at,
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
  let fetched = false;
  try {
    await stmt(
      env.DB,
      "UPDATE ingestion_runs SET status='failed',error='interrupted_run',finished_at=? WHERE source_id=? AND status='running'",
      at,
      sourceId,
    ).run();
    await stmt(
      env.DB,
      "INSERT INTO ingestion_runs (id,source_id,started_at,status) VALUES (?,?,?,?)",
      run.id,
      sourceId,
      at,
      "running",
    ).run();
    const hasQueue = await first(
      env.DB,
      "SELECT id FROM ingestion_queue WHERE source_id=? LIMIT 1",
      sourceId,
    );
    if (!hasQueue) {
      fetched = true;
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
          "UPDATE sources SET etag=?,last_modified=? WHERE id=?",
          collected.etag,
          collected.lastModified,
          sourceId,
        ),
      ]);
      if (collected.notModified) run.status = "not_modified";
    }
    const queued = await rows<{ id: number; payload_json: string }>(
      env.DB,
      "SELECT id,payload_json FROM ingestion_queue WHERE source_id=? ORDER BY id LIMIT 2",
      sourceId,
    );
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
    run.status = "failed";
    run.error =
      e instanceof Error &&
      /^(upstream_\d+|invalid_[a-z_]+|unsupported_feed|response_too_large|network_or_parse_error|fetch_host_not_allowed|credential_in_source_url)$/.test(
        e.message,
      )
        ? e.message
        : "ingestion_failed";
  } finally {
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
        "UPDATE sources SET lease_until=NULL,lease_token=NULL,next_fetch_at=? WHERE id=? AND lease_token=?",
        fetched
          ? new Date(Date.now() + source.intervalMinutes * 60000).toISOString()
          : row.next_fetch_at,
        sourceId,
        leaseToken,
      ),
    ]);
  }
  return run;
}
export async function scheduledIngest(env: Env): Promise<void> {
  if (env.INGEST_ENABLED !== "true") return;
  const due = await rows<{ id: string }>(
    env.DB,
    "SELECT id FROM sources WHERE status='approved' AND (next_fetch_at IS NULL OR next_fetch_at<=? OR EXISTS(SELECT 1 FROM ingestion_queue WHERE source_id=sources.id)) ORDER BY COALESCE(next_fetch_at,'') ASC,id LIMIT 1",
    now(),
  );
  for (const s of due) {
    try {
      await ingestSource(env, s.id);
    } catch (e) {
      if (!(e instanceof ApiFault && e.status === 409))
        console.error("scheduled_ingestion_failed");
    }
  }
  await env.DB.batch([
    stmt(env.DB, "DELETE FROM feed_snapshots WHERE expires_at<?", now()),
    stmt(
      env.DB,
      "DELETE FROM request_budgets WHERE expires_at<?",
      Math.floor(Date.now() / 1000),
    ),
  ]);
}
