CREATE TABLE ingestion_queue (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 source_id TEXT NOT NULL REFERENCES sources(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 UNIQUE(source_id,payload_json)
);
CREATE INDEX ingestion_queue_source ON ingestion_queue(source_id,id);
ALTER TABLE ingestion_runs ADD COLUMN queued_remaining INTEGER NOT NULL DEFAULT 0;
