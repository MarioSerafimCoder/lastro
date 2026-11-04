CREATE TABLE jarvis_conversations (
  session_hash TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  snapshot_json TEXT NOT NULL CHECK(length(snapshot_json) <= 16384),
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX jarvis_conversation_expiry ON jarvis_conversations(expires_at);
