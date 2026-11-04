import { first, stmt } from "./db";
import { RETENTION_MS } from "./schedule";

// Citations, personal curation and audit foreign keys stay valid. No content row is deleted.
const unprotected = `NOT EXISTS(SELECT 1 FROM favorites f WHERE f.content_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM workshop_selection w WHERE w.content_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM research_package_items p WHERE p.content_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM output_sources o WHERE o.content_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM collection_items k WHERE k.content_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM notes n WHERE n.content_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM knowledge_annotations a WHERE a.content_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM content_synopses sy WHERE sy.content_id=c.id AND sy.status='processing')`;

export async function expireRadar(db: D1Database, clock = Date.now()) {
  const at = new Date(clock).toISOString(),
    cutoff = new Date(clock - RETENTION_MS).toISOString();
  const minimal = `json_object('title','Referência expirada','url',c.canonical_url,'authors',json('[]'),
    'publication',NULL,'publishedAt',c.published_at,'kind',c.kind,'language',c.language,
    'description',NULL,'imageUrl',NULL,'identifiers',json('[]'),'topics',json('[]'),
    'access','unknown','license',NULL,'accessNote','Referência expirada; metadados temporários removidos.',
    'isPrimary',NULL,'retracted',json('false'),'evergreen',json('false'))`;
  const marked = `SELECT c.id FROM contents c WHERE c.purged_at=? AND ${unprotected}`;
  const result = await db.batch([
    stmt(
      db,
      `UPDATE contents SET expired_at=? WHERE id IN(SELECT c.id FROM contents c WHERE c.kind<>'paper'
      AND c.expired_at IS NULL AND COALESCE(c.first_seen_at,c.collected_at)<=?
      AND NOT EXISTS(SELECT 1 FROM favorites f WHERE f.content_id=c.id) ORDER BY c.first_seen_at,c.id LIMIT 50)`,
      at,
      cutoff,
    ),
    stmt(
      db,
      `UPDATE contents AS c SET purged_at=?,title='Referência expirada',metadata_json=${minimal}
      WHERE c.id IN(SELECT c.id FROM contents c WHERE c.expired_at IS NOT NULL AND c.purged_at IS NULL
      AND ${unprotected} ORDER BY c.first_seen_at,c.id LIMIT 25) AND ${unprotected}`,
      at,
    ),
    stmt(
      db,
      `UPDATE content_synopses SET text=NULL,evidence_json=NULL,validation_json=NULL,status='blocked',
      block_code='expired',validated_at=NULL,metadata_json=(SELECT metadata_json FROM contents WHERE id=content_id)
      WHERE content_id IN(${marked})`,
      at,
    ),
    stmt(
      db,
      `UPDATE ingestion_candidates SET payload_json=(SELECT metadata_json FROM contents WHERE id=content_id)
      WHERE content_id IN(${marked})`,
      at,
    ),
    stmt(
      db,
      `DELETE FROM synopsis_evidence_cache WHERE EXISTS(SELECT 1 FROM contents c WHERE c.source_id=synopsis_evidence_cache.source_id
      AND c.canonical_url=synopsis_evidence_cache.canonical_url AND c.purged_at=? AND ${unprotected})`,
      at,
    ),
    stmt(db, `DELETE FROM content_authors WHERE content_id IN(${marked})`, at),
    stmt(
      db,
      `DELETE FROM content_taxonomies WHERE content_id IN(${marked})`,
      at,
    ),
    stmt(
      db,
      `INSERT OR IGNORE INTO radar_seen SELECT q.source_id,q.canonical_url,q.first_seen_at FROM ingestion_queue q
      JOIN sources s ON s.id=q.source_id WHERE s.connector='rss' AND q.canonical_url IS NOT NULL AND q.first_seen_at<=? ORDER BY q.id LIMIT 25`,
      cutoff,
    ),
    stmt(
      db,
      `DELETE FROM ingestion_queue WHERE id IN(SELECT q.id FROM ingestion_queue q JOIN sources s ON s.id=q.source_id
      WHERE s.connector='rss' AND q.first_seen_at<=? ORDER BY q.id LIMIT 25)`,
      cutoff,
    ),
    stmt(
      db,
      "UPDATE radar_scheduler SET last_retention_at=?,expired=expired+?,purged=purged+? WHERE id=1",
      at,
      0,
      0,
    ),
  ]);
  const expired = result[0].meta.changes ?? 0,
    purged = result[1].meta.changes ?? 0;
  await stmt(
    db,
    "UPDATE radar_scheduler SET expired=expired+?,purged=purged+? WHERE id=1",
    expired,
    purged,
  ).run();
  return { expired, purged };
}

export async function retentionDue(db: D1Database, clock = Date.now()) {
  const row = await first<{ last_retention_at: string | null }>(
    db,
    "SELECT last_retention_at FROM radar_scheduler WHERE id=1",
  );
  return (
    !row?.last_retention_at ||
    clock - Date.parse(row.last_retention_at) >= 1800000
  );
}
