CREATE TABLE jarvis_brain (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL DEFAULT 'owner' CHECK(owner='owner'),
 body_json TEXT NOT NULL CHECK(json_valid(body_json)),
 state TEXT NOT NULL CHECK(state IN ('proposta','confirmada','arquivada')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 drive_id TEXT, drive_version INTEGER,
 sync TEXT NOT NULL DEFAULT 'local' CHECK(sync IN ('local','pendente','sincronizada','erro'))
);
CREATE INDEX jarvis_brain_state ON jarvis_brain(owner,state,updated_at);
CREATE TABLE jarvis_brain_budget (day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0);
CREATE TABLE jarvis_brain_oauth (state_hash TEXT PRIMARY KEY, nonce_hash TEXT NOT NULL, verifier_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE jarvis_brain_drive (owner TEXT PRIMARY KEY CHECK(owner='owner'), token_cipher TEXT NOT NULL, root_id TEXT, memories_id TEXT, lock_id TEXT, lock_until INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0);

CREATE TABLE jarvis_brain_commit_guard (ok INTEGER NOT NULL CHECK(ok=1));
