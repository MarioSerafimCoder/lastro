ALTER TABLE synopsis_usage ADD COLUMN editorial_neurons INTEGER NOT NULL DEFAULT 0;
ALTER TABLE synopsis_usage ADD COLUMN editorial_reservations INTEGER NOT NULL DEFAULT 0;
CREATE TABLE editorial_autopilot_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);
INSERT INTO editorial_autopilot_settings(id) VALUES (1);
CREATE TABLE editorial_autopilot_runs (
  id TEXT PRIMARY KEY,
  editorial_date TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('scheduled','researching','generating','validating','sending','draft_created','needs_review','failed','skipped')),
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  theme TEXT,
  sources_json TEXT,
  payload TEXT,
  receipt TEXT,
  model TEXT,
  reserved_neurons INTEGER,
  generation_usage TEXT,
  verification_usage TEXT
);
CREATE INDEX editorial_autopilot_due ON editorial_autopilot_runs(next_at,lease_until);
