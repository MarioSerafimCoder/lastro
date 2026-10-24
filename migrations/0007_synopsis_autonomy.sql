ALTER TABLE sources ADD COLUMN synopsis_permission_version INTEGER NOT NULL DEFAULT 1;
-- statement-breakpoint
ALTER TABLE ingestion_queue ADD COLUMN canonical_url TEXT;
-- statement-breakpoint
ALTER TABLE content_synopses ADD COLUMN block_code TEXT;
-- statement-breakpoint
ALTER TABLE content_synopses ADD COLUMN evidence_key TEXT;
-- statement-breakpoint
ALTER TABLE content_synopses ADD COLUMN observed_evidence_key TEXT;
-- statement-breakpoint
ALTER TABLE content_synopses ADD COLUMN observed_permission_version INTEGER NOT NULL DEFAULT 0;
-- statement-breakpoint
ALTER TABLE content_synopses ADD COLUMN technical_retries INTEGER NOT NULL DEFAULT 0;
-- statement-breakpoint
ALTER TABLE content_synopses ADD COLUMN retry_at TEXT;
-- statement-breakpoint
ALTER TABLE content_synopses ADD COLUMN inference_started INTEGER NOT NULL DEFAULT 0;
-- statement-breakpoint
CREATE TABLE synopsis_evidence_cache (
 source_id TEXT NOT NULL REFERENCES sources(id),
 canonical_url TEXT NOT NULL,
 evidence_json TEXT,
 material_key TEXT NOT NULL,
 permission_version INTEGER NOT NULL,
 block_code TEXT,
 item_rights TEXT,
 observed_at TEXT NOT NULL,
 PRIMARY KEY(source_id,canonical_url)
);
-- statement-breakpoint
CREATE TABLE synopsis_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 content_id TEXT REFERENCES contents(id),
 source_id TEXT NOT NULL REFERENCES sources(id),
 event TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
-- statement-breakpoint
CREATE INDEX synopsis_history_content ON synopsis_history(content_id,id);
-- statement-breakpoint
CREATE TRIGGER synopsis_preserve_history BEFORE UPDATE ON content_synopses
WHEN OLD.status IS NOT NEW.status OR OLD.text IS NOT NEW.text OR OLD.evidence_json IS NOT NEW.evidence_json
 OR OLD.metadata_json IS NOT NEW.metadata_json OR OLD.validation_json IS NOT NEW.validation_json OR OLD.block_code IS NOT NEW.block_code
BEGIN
 INSERT INTO synopsis_history(content_id,source_id,event,snapshot_json,created_at)
 SELECT OLD.content_id,c.source_id,'synopsis',json_object(
  'status',OLD.status,'text',OLD.text,'metadata',OLD.metadata_json,'evidence',OLD.evidence_json,
  'validation',OLD.validation_json,'validationMode',OLD.validation_mode,'note',OLD.validation_note,
  'blockCode',OLD.block_code,'evidenceKey',OLD.evidence_key,'generator',OLD.generator_version,
  'model',OLD.model,'attempts',OLD.attempts,'technicalRetries',OLD.technical_retries,'retryAt',OLD.retry_at,
  'inferenceStarted',OLD.inference_started,'validatedAt',OLD.validated_at,'updatedAt',OLD.updated_at),
  strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM contents c WHERE c.id=OLD.content_id;
END;
-- statement-breakpoint
CREATE TRIGGER synopsis_capture_history BEFORE UPDATE ON synopsis_evidence_cache
WHEN OLD.material_key IS NOT NEW.material_key
BEGIN
 INSERT INTO synopsis_history(content_id,source_id,event,snapshot_json,created_at)
 VALUES(NULL,OLD.source_id,'discovery',json_object('url',OLD.canonical_url,'evidence',OLD.evidence_json,
 'materialKey',OLD.material_key,'permissionVersion',OLD.permission_version,'blockCode',OLD.block_code,
 'itemRights',OLD.item_rights,'observedAt',OLD.observed_at),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
-- statement-breakpoint
CREATE TRIGGER synopsis_permission_change AFTER UPDATE OF config_json,url,connector ON sources
WHEN OLD.url IS NOT NEW.url OR OLD.connector IS NOT NEW.connector OR
 json_array(json_extract(OLD.config_json,'$.metadataAllowed'),json_extract(OLD.config_json,'$.synopsisAllowed'),
 json_extract(OLD.config_json,'$.summaryAllowed'),json_extract(OLD.config_json,'$.synopsisRightsNote'),json_extract(OLD.config_json,'$.synopsisLicenseUrl'))
 IS NOT json_array(json_extract(NEW.config_json,'$.metadataAllowed'),json_extract(NEW.config_json,'$.synopsisAllowed'),
 json_extract(NEW.config_json,'$.summaryAllowed'),json_extract(NEW.config_json,'$.synopsisRightsNote'),json_extract(NEW.config_json,'$.synopsisLicenseUrl'))
BEGIN
 UPDATE sources SET synopsis_permission_version=OLD.synopsis_permission_version+1 WHERE id=NEW.id;
 UPDATE content_synopses SET status='blocked',block_code='rights',lease_until=NULL,lease_token=NULL,retry_at=NULL,technical_retries=0,
 validation_note='Permissões da fonte alteradas: exige evidência com autorização atual.',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE content_id IN (SELECT id FROM contents WHERE source_id=NEW.id)
 AND COALESCE(block_code,'')<>'editorial'
 AND COALESCE(json_extract(evidence_json,'$.kind'),'')<>'editorial_evidence';
END;
-- statement-breakpoint
UPDATE content_synopses SET evidence_json=json_set(evidence_json,
 '$.sourceId',(SELECT source_id FROM contents WHERE id=content_id),
 '$.originUrl',(SELECT s.url FROM sources s JOIN contents c ON c.source_id=s.id WHERE c.id=content_id),
 '$.permissionVersion',1,'$.url',(SELECT canonical_url FROM contents WHERE id=content_id))
WHERE json_extract(evidence_json,'$.kind') IN ('authorized_feed_description','authorized_abstract')
AND EXISTS(SELECT 1 FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.id=content_id
 AND json_extract(s.config_json,'$.metadataAllowed')=1 AND json_extract(s.config_json,'$.synopsisAllowed')=1
 AND json_extract(evidence_json,'$.rightsNote')=json_extract(s.config_json,'$.synopsisRightsNote')
 AND COALESCE(json_extract(evidence_json,'$.licenseUrl'),'')=COALESCE(json_extract(s.config_json,'$.synopsisLicenseUrl'),''));
-- statement-breakpoint
UPDATE content_synopses SET
 evidence_key=CASE WHEN evidence_json IS NOT NULL THEN json_array(json_extract(evidence_json,'$.kind'),json_extract(evidence_json,'$.text'),
 json_extract(evidence_json,'$.url'),json_extract(evidence_json,'$.rightsNote'),json_extract(evidence_json,'$.licenseUrl'),
 json_extract(evidence_json,'$.sourceId'),json_extract(evidence_json,'$.originUrl'),json_extract(evidence_json,'$.permissionVersion'),json_extract(evidence_json,'$.itemRights')) END,
 observed_permission_version=(SELECT s.synopsis_permission_version FROM sources s JOIN contents c ON c.source_id=s.id WHERE c.id=content_id),
 block_code=CASE WHEN status='blocked' AND EXISTS(SELECT 1 FROM synopsis_decisions d WHERE d.content_id=content_synopses.content_id AND d.decision='rejected') THEN 'editorial'
 WHEN status='blocked' THEN CASE WHEN EXISTS(SELECT 1 FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.id=content_id AND json_extract(s.config_json,'$.synopsisAllowed')=1) THEN 'insufficient_evidence' ELSE 'rights' END
 WHEN status='failed' THEN 'technical' WHEN status='review' THEN 'editorial_review' END;
-- statement-breakpoint
UPDATE content_synopses SET observed_evidence_key=evidence_key,inference_started=CASE WHEN attempts>0 THEN 1 ELSE 0 END;
