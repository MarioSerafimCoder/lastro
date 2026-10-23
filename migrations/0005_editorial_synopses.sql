CREATE TABLE content_synopses (
 content_id TEXT PRIMARY KEY REFERENCES contents(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','review','validated','blocked','failed')),
 text TEXT,
 metadata_json TEXT NOT NULL,
 evidence_json TEXT,
 generator_version TEXT,
 model TEXT,
 validation_note TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT,
 lease_token TEXT,
 updated_at TEXT NOT NULL,
 validated_at TEXT
);
CREATE INDEX synopsis_queue ON content_synopses(status,updated_at);
CREATE TABLE synopsis_usage (
 day TEXT PRIMARY KEY,
 reserved_neurons INTEGER NOT NULL DEFAULT 0,
 calls INTEGER NOT NULL DEFAULT 0,
 blocked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE synopsis_decisions (
 id TEXT PRIMARY KEY,
 content_id TEXT NOT NULL REFERENCES contents(id),
 decision TEXT NOT NULL,
 reason TEXT NOT NULL,
 previous_text TEXT,
 text TEXT,
 created_at TEXT NOT NULL
);
INSERT INTO content_synopses(content_id,metadata_json,updated_at) SELECT id,metadata_json,collected_at FROM contents;
