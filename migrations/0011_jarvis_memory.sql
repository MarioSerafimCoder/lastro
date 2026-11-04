CREATE TABLE jarvis_preferences (owner TEXT PRIMARY KEY CHECK(owner='owner'), body_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE jarvis_memory (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('notice','action')), state TEXT NOT NULL, until_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX jarvis_memory_expiry ON jarvis_memory(expires_at);
CREATE TABLE jarvis_budgets (day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, last_shown INTEGER NOT NULL DEFAULT 0);
