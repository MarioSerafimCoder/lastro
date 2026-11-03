CREATE TABLE analytics_cache (id TEXT PRIMARY KEY, body_json TEXT, fetched_at INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE TABLE analytics_oauth_states (id TEXT PRIMARY KEY, nonce_hash TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL);
