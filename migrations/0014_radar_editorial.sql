-- Additive only. Apply to an isolated copy first. Remote application is a later phase.
ALTER TABLE contents ADD COLUMN first_seen_at TEXT;
ALTER TABLE contents ADD COLUMN approved_at TEXT;
ALTER TABLE contents ADD COLUMN expired_at TEXT;
ALTER TABLE contents ADD COLUMN purged_at TEXT;
ALTER TABLE contents ADD COLUMN radar_category TEXT;
UPDATE contents SET first_seen_at=collected_at,
 approved_at=(SELECT MIN(created_at) FROM editorial_decisions e WHERE e.content_id=contents.id AND e.decision='approved');
ALTER TABLE ingestion_queue ADD COLUMN first_seen_at TEXT;
ALTER TABLE ingestion_runs ADD COLUMN new_references INTEGER;
-- Legacy queue did not record arrival: use the earliest known fetch conservatively.
UPDATE ingestion_queue SET first_seen_at=COALESCE(
 (SELECT MIN(started_at) FROM ingestion_runs r WHERE r.source_id=ingestion_queue.source_id AND r.discovery=1),
 (SELECT created_at FROM sources s WHERE s.id=ingestion_queue.source_id));
CREATE TABLE radar_seen (
 source_id TEXT NOT NULL REFERENCES sources(id), canonical_url TEXT NOT NULL,
 first_seen_at TEXT NOT NULL, PRIMARY KEY(source_id,canonical_url)
);
INSERT OR IGNORE INTO radar_seen
 SELECT source_id,json_extract(payload_json,'$.url'),MIN(created_at) FROM ingestion_candidates
 WHERE json_extract(payload_json,'$.url') LIKE 'http%' GROUP BY source_id,json_extract(payload_json,'$.url');
INSERT OR IGNORE INTO radar_seen SELECT source_id,canonical_url,first_seen_at FROM contents;
CREATE TABLE radar_scheduler (
 id INTEGER PRIMARY KEY CHECK(id=1), last_started_at TEXT, last_finished_at TEXT,
 last_status TEXT, last_error TEXT, last_retention_at TEXT,
 expired INTEGER NOT NULL DEFAULT 0, purged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX radar_publication ON contents(editorial_status,kind,published_at DESC,id);
CREATE INDEX radar_expiration ON contents(expired_at,first_seen_at);
CREATE INDEX candidates_content ON ingestion_candidates(content_id);
CREATE INDEX radar_candidates_window ON ingestion_candidates(source_id,created_at,outcome);
