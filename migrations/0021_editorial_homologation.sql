ALTER TABLE synopsis_usage ADD COLUMN editorial_homologation_neurons INTEGER NOT NULL DEFAULT 0;
-- statement-breakpoint

ALTER TABLE editorial_autopilot_runs RENAME TO editorial_autopilot_runs_previous;
-- statement-breakpoint

CREATE TABLE editorial_autopilot_runs (
  id TEXT PRIMARY KEY,
  editorial_date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'daily' CHECK(kind IN ('daily','homologation')),
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
  verification_usage TEXT,
  body_characters INTEGER,
  release_at INTEGER NOT NULL DEFAULT 0,
  relevance TEXT,
  budget_day TEXT,
  completion_usage TEXT,
  verified_payload_sha256 TEXT,
  settlement_neurons INTEGER
);
-- statement-breakpoint

INSERT INTO editorial_autopilot_runs (
  id,editorial_date,status,started_at,updated_at,attempts,next_at,lease_token,
  lease_until,reason,theme,sources_json,payload,receipt,model,reserved_neurons,
  generation_usage,verification_usage,body_characters,release_at,relevance
) SELECT id,editorial_date,status,started_at,updated_at,attempts,next_at,lease_token,
  lease_until,reason,theme,sources_json,payload,receipt,model,reserved_neurons,
  generation_usage,verification_usage,body_characters,release_at,relevance
FROM editorial_autopilot_runs_previous;
-- statement-breakpoint

DROP TABLE editorial_autopilot_runs_previous;
-- statement-breakpoint
CREATE UNIQUE INDEX editorial_autopilot_daily ON editorial_autopilot_runs(editorial_date) WHERE kind='daily';
-- statement-breakpoint
CREATE INDEX editorial_autopilot_due ON editorial_autopilot_runs(next_at,lease_until);
-- statement-breakpoint
CREATE TRIGGER editorial_settle_inference
AFTER UPDATE OF settlement_neurons ON editorial_autopilot_runs
WHEN NEW.settlement_neurons IS NOT NULL AND OLD.settlement_neurons IS NULL
  AND NEW.budget_day IS NOT NULL AND NEW.reserved_neurons >= NEW.settlement_neurons
BEGIN
  UPDATE synopsis_usage SET
    editorial_neurons=editorial_neurons-CASE WHEN NEW.kind='daily'
      THEN NEW.reserved_neurons-NEW.settlement_neurons ELSE 0 END,
    editorial_homologation_neurons=editorial_homologation_neurons-CASE WHEN NEW.kind='homologation'
      THEN NEW.reserved_neurons-NEW.settlement_neurons ELSE 0 END
  WHERE day=NEW.budget_day;
END;
