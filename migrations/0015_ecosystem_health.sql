CREATE TABLE ecosystem_health (
  id INTEGER PRIMARY KEY CHECK (id=1),
  snapshot_json TEXT,
  refresh_failed INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO ecosystem_health(id) VALUES (1);
