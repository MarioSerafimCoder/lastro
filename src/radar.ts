import type { Env } from "./env";
import { first, rows } from "./db";
import type { RadarStatus, RadarSourceStatus } from "../packages/contracts";
import { defaultPolicy } from "../packages/contracts";
import { dailyWindowSql, dailyWindowArgs } from "./radar-feed";
import { EDITORIAL_TIMEZONE, editorialWeek, RETENTION_MS } from "./schedule";

export async function radarStatus(
  env: Env,
  since: string | null = null,
  clock = Date.now(),
): Promise<RadarStatus> {
  const at = new Date(clock).toISOString(),
    week = editorialWeek(clock),
    cutoff = new Date(clock - RETENTION_MS).toISOString();
  const data = await rows<any>(
    env.DB,
    `SELECT s.*,
 (SELECT COUNT(*) FROM ingestion_queue q WHERE q.source_id=s.id) queued,
 (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND editorial_status='approved' AND ${dailyWindowSql}) approved,
 (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND editorial_status='pending' AND c.expired_at IS NULL) pending,
 (SELECT COUNT(*) FROM ingestion_candidates ic WHERE ic.source_id=s.id AND outcome='rejected' AND ic.created_at>=?) rejected,
 (SELECT COUNT(*) FROM ingestion_candidates ic WHERE ic.source_id=s.id AND outcome='duplicate' AND ic.created_at>=?) duplicates,
 (SELECT COUNT(*) FROM ingestion_candidates ic WHERE ic.source_id=s.id AND ic.created_at>=?) processed,
 (SELECT SUM(received) FROM ingestion_runs r WHERE r.source_id=s.id AND r.started_at>=?) received,
 (SELECT new_references FROM ingestion_runs r WHERE r.source_id=s.id AND discovery=1 ORDER BY started_at DESC,rowid DESC LIMIT 1) last_new,
 (SELECT error FROM ingestion_runs r WHERE r.source_id=s.id ORDER BY started_at DESC,rowid DESC LIMIT 1) error,
 (SELECT MAX(first_seen_at) FROM radar_seen r WHERE r.source_id=s.id) last_new_at,
 (SELECT COUNT(*) FROM radar_seen r WHERE r.source_id=s.id AND r.first_seen_at>=? AND r.first_seen_at<?) discovered_week,
 (SELECT COUNT(*) FROM content_synopses sy JOIN contents c ON c.id=sy.content_id WHERE c.source_id=s.id AND sy.status IN('blocked','review','failed') AND c.expired_at IS NULL) blocked,
 (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND c.kind<>'paper' AND COALESCE(c.first_seen_at,c.collected_at)<=? AND NOT EXISTS(SELECT 1 FROM favorites f WHERE f.content_id=c.id)) expired
 FROM sources s ORDER BY s.name`,
    ...dailyWindowArgs(clock),
    cutoff,
    cutoff,
    cutoff,
    cutoff,
    week.start,
    week.end,
    cutoff,
  );
  const sources: RadarSourceStatus[] = data.map((s) => {
    const authorized = JSON.parse(s.config_json).metadataAllowed === true;
    const active = s.status === "approved" && authorized;
    const stale =
      active &&
      (s.connector === "rss"
        ? clock - Date.parse(s.last_success_at ?? s.created_at) > 48 * 3600000
        : !!s.next_fetch_at &&
          clock - Date.parse(s.next_fetch_at) > 48 * 3600000);
    return {
      id: s.id,
      name: s.name,
      cycle: s.connector === "openalex" ? "bimonthly" : "daily",
      lastCycleKey: s.last_cycle_key,
      lastAttemptAt: s.last_attempt_at,
      lastSuccessAt: s.last_success_at,
      lastNewReferenceAt: s.last_new_at,
      discoveredThisWeek: s.discovered_week,
      nextDiscoveryAt:
        active && env.INGEST_ENABLED === "true"
          ? ([s.next_fetch_at, s.retry_at].filter(Boolean).sort().at(-1) ?? at)
          : null,
      queued: s.queued,
      approved: active ? s.approved : 0,
      pending: s.pending,
      rejected: s.rejected,
      duplicates: s.duplicates,
      processed: s.processed,
      received: s.received,
      synopsisBlocked: s.blocked,
      expired: s.expired,
      staleOver48h: stale,
      alerts: [
        ...(stale ? ["stale_over_48h" as const] : []),
        ...(s.consecutive_failures > 0 ? ["collection_failed" as const] : []),
      ],
      consecutiveFailures: s.consecutive_failures,
      error: s.error,
      state: !active
        ? s.status === "approved"
          ? "unauthorized"
          : s.status
        : s.consecutive_failures > 0
          ? "failed"
          : s.lease_until > at
            ? "processing"
            : s.queued > 0
              ? "queued"
              : !s.last_success_at
                ? "unverified"
                : s.last_new === 0
                  ? "no_new_entries"
                  : "checked",
    };
  });
  const entries = since
    ? await rows<{ id: string; metadata_json: string }>(
        env.DB,
        `SELECT c.id,c.metadata_json FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.editorial_status='approved' AND s.status='approved'
  AND json_extract(s.config_json,'$.metadataAllowed')=1 AND c.approved_at>? AND ${dailyWindowSql} ORDER BY c.approved_at,c.id LIMIT 500`,
        since,
        ...dailyWindowArgs(clock),
      )
    : [];
  const topics = new Map<string, number>();
  const approvalCount =
    since && entries.length === 500
      ? await first<{ n: number }>(
          env.DB,
          `SELECT COUNT(*) n FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.editorial_status='approved' AND s.status='approved'
        AND json_extract(s.config_json,'$.metadataAllowed')=1 AND c.approved_at>? AND ${dailyWindowSql}`,
          since,
          ...dailyWindowArgs(clock),
        )
      : null;
  for (const e of entries)
    for (const t of new Set<string>(JSON.parse(e.metadata_json).topics ?? []))
      topics.set(t, (topics.get(t) ?? 0) + 1);
  const last = (cycle: string) =>
    sources
      .filter((s) => s.cycle === cycle)
      .map((s) => s.lastSuccessAt)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? null;
  const visible = await first<{ editorial: number; scientific: number }>(
    env.DB,
    `SELECT SUM(c.kind<>'paper') editorial,SUM(c.kind='paper') scientific FROM contents c JOIN sources s ON s.id=c.source_id
  WHERE c.editorial_status='approved' AND s.status='approved' AND json_extract(s.config_json,'$.metadataAllowed')=1 AND ${dailyWindowSql}
  AND c.quality_score>=COALESCE((SELECT json_extract(config_json,'$.minimumQuality') FROM quality_policies WHERE active=1 LIMIT 1),${defaultPolicy.minimumQuality})
  AND (EXISTS(SELECT 1 FROM favorites f WHERE f.content_id=c.id AND f.user_id='owner') OR NOT EXISTS(SELECT 1 FROM interactions i WHERE i.content_id=c.id AND i.user_id='owner' AND i.type='dismissed' AND i.active=1))
  AND (COALESCE((SELECT json_array_length(preferences_json,'$.languages') FROM users WHERE id='owner'),0)=0 OR c.language IN(SELECT value FROM users u,json_each(u.preferences_json,'$.languages') WHERE u.id='owner'))`,
    ...dailyWindowArgs(clock),
  );
  const rejections = await rows<{ reason: string; count: number }>(
    env.DB,
    `SELECT j.value reason,COUNT(*) count FROM ingestion_candidates ic,json_each(ic.reasons_json) j
  WHERE ic.created_at>=? AND ic.outcome='rejected' AND j.value NOT LIKE '% %' GROUP BY j.value ORDER BY count DESC,j.value LIMIT 20`,
    cutoff,
  );
  const scheduler = await first<{
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    status: string | null;
    error: string | null;
  }>(
    env.DB,
    `SELECT last_started_at lastStartedAt,last_finished_at lastFinishedAt,last_status status,last_error error FROM radar_scheduler WHERE id=1`,
  );
  return {
    checkedAt: at,
    timezone: EDITORIAL_TIMEZONE,
    ingestEnabled: env.INGEST_ENABLED === "true",
    sources,
    lastEditorialCheck: last("daily"),
    lastScientificRound: last("bimonthly"),
    approved: sources
      .filter(
        (s) =>
          !["paused", "pending", "rejected", "unauthorized"].includes(s.state),
      )
      .reduce((n, s) => n + s.approved, 0),
    newApprovalsSince: since,
    newApprovals: since ? (approvalCount?.n ?? entries.length) : null,
    newContentIds: entries.map((e) => e.id),
    recentTopics: [...topics]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
    health: {
      week,
      activeSources: sources.filter(
        (s) =>
          !["paused", "pending", "rejected", "unauthorized"].includes(s.state),
      ).length,
      failedSources: sources.filter((s) => s.consecutiveFailures > 0).length,
      staleSourceIds: sources.filter((s) => s.staleOver48h).map((s) => s.id),
      discoveredThisWeek: sources.reduce(
        (n, s) => n + (s.discoveredThisWeek ?? 0),
        0,
      ),
      visibleEditorial: visible?.editorial ?? 0,
      visibleScientific: visible?.scientific ?? 0,
      pending: sources.reduce((n, s) => n + s.pending + s.queued, 0),
      synopsisBlocked: sources.reduce(
        (n, s) => n + (s.synopsisBlocked ?? 0),
        0,
      ),
      expired: sources.reduce((n, s) => n + (s.expired ?? 0), 0),
      rejections,
      scheduler,
    },
  };
}
