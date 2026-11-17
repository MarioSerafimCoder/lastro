ALTER TABLE editorial_autopilot_runs ADD COLUMN dispatch_hash TEXT;
ALTER TABLE editorial_autopilot_runs ADD COLUMN dispatch_expires_at INTEGER;
ALTER TABLE editorial_autopilot_runs ADD COLUMN verification_findings TEXT;
