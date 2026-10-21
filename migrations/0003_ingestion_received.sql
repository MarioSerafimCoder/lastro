-- NULL preserves the unknown count of historical runs.
ALTER TABLE ingestion_runs ADD COLUMN received INTEGER CHECK(received IS NULL OR received >= 0);
