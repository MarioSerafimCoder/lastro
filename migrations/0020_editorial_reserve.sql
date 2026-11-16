ALTER TABLE editorial_autopilot_runs ADD COLUMN release_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE editorial_autopilot_runs ADD COLUMN relevance TEXT;
CREATE TABLE editorial_topic_reserve (
  id TEXT PRIMARY KEY,
  theme TEXT NOT NULL,
  category TEXT NOT NULL,
  relevance TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
