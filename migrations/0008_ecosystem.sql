CREATE TABLE integration_tasks (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('studio','article')), source_id TEXT NOT NULL, version TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','completed','error','intervention')),
 payload TEXT NOT NULL DEFAULT '{}', attempts INTEGER NOT NULL DEFAULT 0, cycle_attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(kind,source_id,version)
);
CREATE INDEX integration_due ON integration_tasks(state,next_at,lease_until);
CREATE TABLE integration_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, source TEXT NOT NULL, destination TEXT NOT NULL, source_id TEXT NOT NULL, version TEXT NOT NULL, task_id TEXT, attempt INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(type,source_id,version,attempt));
CREATE TABLE integration_links (kind TEXT NOT NULL, source_id TEXT NOT NULL, version TEXT NOT NULL, target_id TEXT NOT NULL, admin_url TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(kind,source_id,version));
CREATE TABLE integration_articles (slug TEXT PRIMARY KEY, sha TEXT NOT NULL, state TEXT NOT NULL, title TEXT, canonical_url TEXT, publish_at TEXT, checked_at TEXT NOT NULL);
CREATE TABLE integration_control (id TEXT PRIMARY KEY, next_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, token TEXT, last_success TEXT, error TEXT);
INSERT INTO integration_control(id) VALUES ('catalogue');
CREATE TABLE integration_studio_drafts (id TEXT PRIMARY KEY, package_id TEXT NOT NULL, slug TEXT NOT NULL, source_sha TEXT, private_changes INTEGER NOT NULL, revision INTEGER NOT NULL, admin_url TEXT NOT NULL, updated_at TEXT NOT NULL);
