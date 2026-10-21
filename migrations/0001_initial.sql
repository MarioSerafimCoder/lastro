PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, preferences_json TEXT NOT NULL CHECK(json_valid(preferences_json)));
INSERT INTO users VALUES ('owner', '{"interests":["design","branding","technology","cultura"],"languages":[]}');
CREATE TABLE sources (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, connector TEXT NOT NULL CHECK(connector IN ('rss','openalex')),
 url TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','paused','rejected')),
 config_json TEXT NOT NULL CHECK(json_valid(config_json)), created_at TEXT NOT NULL, next_fetch_at TEXT, etag TEXT, last_modified TEXT,
 lease_until TEXT, lease_token TEXT
);
CREATE TABLE source_decisions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), status TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE publications (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT NOT NULL, identity_key TEXT NOT NULL UNIQUE);
CREATE TABLE author_identifiers (author_id TEXT NOT NULL REFERENCES authors(id), scheme TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scheme,value));
CREATE TABLE contents (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), publication_id TEXT REFERENCES publications(id),
 canonical_url TEXT NOT NULL UNIQUE, title TEXT NOT NULL CHECK(length(title)>0), metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 published_at TEXT, collected_at TEXT NOT NULL, kind TEXT NOT NULL, language TEXT,
 editorial_status TEXT NOT NULL CHECK(editorial_status IN ('pending','approved','rejected')),
 quality_score REAL NOT NULL CHECK(quality_score BETWEEN 0 AND 100), quality_json TEXT NOT NULL CHECK(json_valid(quality_json))
);
CREATE INDEX contents_feed ON contents(editorial_status,collected_at DESC,id);
CREATE TABLE content_authors (content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES authors(id), position INTEGER NOT NULL, PRIMARY KEY(content_id,author_id));
CREATE TABLE content_identifiers (content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE, scheme TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scheme,value));
CREATE TABLE taxonomies (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('topic','category','tag')), name TEXT NOT NULL, UNIQUE(kind,name));
CREATE TABLE content_taxonomies (content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE, taxonomy_id TEXT NOT NULL REFERENCES taxonomies(id), PRIMARY KEY(content_id,taxonomy_id));
CREATE TABLE quality_policies (version TEXT PRIMARY KEY, config_json TEXT NOT NULL CHECK(json_valid(config_json)), active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), created_at TEXT NOT NULL);
CREATE UNIQUE INDEX one_active_policy ON quality_policies(active) WHERE active=1;
CREATE TABLE quality_evaluations (id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES contents(id), policy_version TEXT NOT NULL REFERENCES quality_policies(version), result_json TEXT NOT NULL CHECK(json_valid(result_json)), reviewer TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE ingestion_runs (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL CHECK(status IN ('running','completed','partial','failed','not_modified')), accepted INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, duplicates INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE TABLE ingestion_candidates (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ingestion_runs(id), source_id TEXT NOT NULL REFERENCES sources(id), content_id TEXT REFERENCES contents(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), outcome TEXT NOT NULL, reasons_json TEXT NOT NULL CHECK(json_valid(reasons_json)), created_at TEXT NOT NULL);
CREATE INDEX candidates_run ON ingestion_candidates(run_id);
CREATE TABLE editorial_decisions (id TEXT PRIMARY KEY, candidate_id TEXT REFERENCES ingestion_candidates(id), content_id TEXT REFERENCES contents(id), decision TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE knowledge_annotations (id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE, classification TEXT NOT NULL CHECK(classification IN ('scientific_evidence','editorial_interpretation','application_hypothesis')), statement TEXT, attribution TEXT, reference_url TEXT, limitations TEXT);
CREATE TABLE favorites (user_id TEXT NOT NULL REFERENCES users(id), content_id TEXT NOT NULL REFERENCES contents(id), created_at TEXT NOT NULL, PRIMARY KEY(user_id,content_id));
CREATE TABLE interactions (user_id TEXT NOT NULL REFERENCES users(id), content_id TEXT NOT NULL REFERENCES contents(id), type TEXT NOT NULL CHECK(type IN ('seen','opened','read','dismissed')), active INTEGER NOT NULL CHECK(active IN (0,1)), updated_at TEXT NOT NULL, PRIMARY KEY(user_id,content_id,type));
CREATE TABLE notes (user_id TEXT NOT NULL REFERENCES users(id), content_id TEXT NOT NULL REFERENCES contents(id), text TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,content_id));
CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE collection_items (collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, content_id TEXT NOT NULL REFERENCES contents(id), PRIMARY KEY(collection_id,content_id));
CREATE TABLE workshop_selection (user_id TEXT NOT NULL REFERENCES users(id), content_id TEXT NOT NULL REFERENCES contents(id), position INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id,content_id));
CREATE TABLE research_packages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), body_json TEXT NOT NULL CHECK(json_valid(body_json)), created_at TEXT NOT NULL);
CREATE TABLE research_package_items (package_id TEXT NOT NULL REFERENCES research_packages(id), content_id TEXT NOT NULL REFERENCES contents(id), PRIMARY KEY(package_id,content_id));
CREATE TABLE generated_prompts (id TEXT PRIMARY KEY, package_id TEXT NOT NULL UNIQUE REFERENCES research_packages(id), version TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE editorial_outputs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('article','newsletter','post','carousel')), status TEXT NOT NULL CHECK(status IN ('draft','review','published','withdrawn')), title TEXT NOT NULL, body_json TEXT CHECK(json_valid(body_json)), public_url TEXT, created_at TEXT NOT NULL);
CREATE TABLE output_sources (output_id TEXT NOT NULL REFERENCES editorial_outputs(id), content_id TEXT NOT NULL REFERENCES contents(id), PRIMARY KEY(output_id,content_id));
CREATE TABLE feed_snapshots (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), body_json TEXT NOT NULL CHECK(json_valid(body_json)), expires_at TEXT NOT NULL);
CREATE TABLE request_budgets (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
