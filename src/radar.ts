import type { Env } from "./env";
import { first, rows } from "./db";
import type {
  RadarStatus,
  RadarSourceStatus,
} from "../packages/contracts/index";

export async function radarStatus(
  env: Env,
  since: string | null = null,
): Promise<RadarStatus> {
  const at = new Date().toISOString();
  const data = await rows<any>(
    env.DB,
    `SELECT s.*,
    (SELECT COUNT(*) FROM ingestion_queue q WHERE q.source_id=s.id) queued,
    (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND editorial_status='approved') approved,
    (SELECT COUNT(*) FROM contents c WHERE c.source_id=s.id AND editorial_status='pending') pending,
    (SELECT COUNT(*) FROM ingestion_candidates c WHERE c.source_id=s.id AND outcome='rejected') rejected,
    (SELECT COUNT(*) FROM ingestion_candidates c WHERE c.source_id=s.id AND outcome='duplicate') duplicates,
    (SELECT COUNT(*) FROM ingestion_candidates c WHERE c.source_id=s.id) processed,
    (SELECT SUM(received) FROM ingestion_runs r WHERE r.source_id=s.id) received,
    (SELECT received FROM ingestion_runs r WHERE r.source_id=s.id AND discovery=1 ORDER BY started_at DESC,rowid DESC LIMIT 1) last_received,
    (SELECT error FROM ingestion_runs r WHERE r.source_id=s.id ORDER BY started_at DESC,rowid DESC LIMIT 1) error
    FROM sources s ORDER BY s.name`,
  );
  const sources: RadarSourceStatus[] = data.map((s) => {
    const authorized = JSON.parse(s.config_json).metadataAllowed === true;
    return {
      id: s.id,
      name: s.name,
      cycle: s.connector === "openalex" ? "bimonthly" : "daily",
      lastCycleKey: s.last_cycle_key,
      lastAttemptAt: s.last_attempt_at,
      lastSuccessAt: s.last_success_at,
      nextDiscoveryAt:
        s.status === "approved" && authorized && env.INGEST_ENABLED === "true"
          ? ([s.next_fetch_at, s.retry_at].filter(Boolean).sort().at(-1) ?? at)
          : null,
      queued: s.queued,
      approved: s.approved,
      pending: s.pending,
      rejected: s.rejected,
      duplicates: s.duplicates,
      processed: s.processed,
      received: s.received,
      consecutiveFailures: s.consecutive_failures,
      error: s.error,
      state:
        s.status !== "approved"
          ? s.status
          : !authorized
            ? "unauthorized"
            : s.consecutive_failures > 0
              ? "failed"
              : s.lease_until > at
                ? "processing"
                : s.queued > 0
                  ? "queued"
                  : !s.last_success_at
                    ? "unverified"
                    : s.last_received === 0
                      ? "no_new_entries"
                      : "checked",
    };
  });
  const count = await first<{ count: number }>(
    env.DB,
    `SELECT COUNT(*) count FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.editorial_status='approved' AND s.status='approved' AND EXISTS(SELECT 1 FROM editorial_decisions e WHERE e.content_id=c.id AND e.decision='approved' AND e.created_at>?)`,
    since ?? at,
  );
  const last = (cycle: string) =>
    sources
      .filter((s) => s.cycle === cycle)
      .map((s) => s.lastSuccessAt)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? null;
  return {
    checkedAt: at,
    timezone: "UTC",
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
    newApprovals: since ? count!.count : null,
  };
}
