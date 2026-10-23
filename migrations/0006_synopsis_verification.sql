ALTER TABLE content_synopses ADD COLUMN validation_json TEXT;
ALTER TABLE content_synopses ADD COLUMN validation_mode TEXT;
CREATE TABLE synopsis_inferences (
 id TEXT PRIMARY KEY,
 content_id TEXT NOT NULL REFERENCES contents(id),
 phase TEXT NOT NULL,
 model TEXT NOT NULL,
 prompt_tokens INTEGER,
 completion_tokens INTEGER,
 calculated_neurons REAL,
 provider_neurons REAL,
 state TEXT NOT NULL DEFAULT 'started',
 created_at TEXT NOT NULL
);
CREATE INDEX synopsis_inferences_content ON synopsis_inferences(content_id,created_at);
CREATE TABLE synopsis_scheduler (
 id INTEGER PRIMARY KEY CHECK(id=1),
 last_started_at TEXT,
 last_finished_at TEXT,
 last_status TEXT
);
