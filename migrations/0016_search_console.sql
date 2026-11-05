CREATE TABLE search_console_connection (
  id INTEGER PRIMARY KEY CHECK (id=1),
  generation TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  property TEXT NOT NULL,
  token_cipher TEXT NOT NULL,
  error TEXT
);
CREATE TABLE search_console_oauth (
  id INTEGER PRIMARY KEY CHECK (id=1),
  state_hash TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  verifier_cipher TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
