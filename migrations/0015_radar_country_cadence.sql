-- Preserve source history while limiting editorial collection to verified BR/US origins.
UPDATE sources SET config_json=json_set(config_json,'$.country','US')
WHERE connector='rss' AND name='A List Apart' AND json_extract(config_json,'$.country') IS NULL;
UPDATE sources SET config_json=json_set(config_json,'$.country','BR')
WHERE connector='rss' AND name IN ('BaixaCultura','InternetLab') AND json_extract(config_json,'$.country') IS NULL;
UPDATE sources SET status='paused'
WHERE connector='rss' AND status='approved'
AND COALESCE(json_extract(config_json,'$.country'),'') NOT IN ('BR','US');
-- Only the highest-authority editorial feeds gain a six-hour window.
UPDATE sources SET config_json=json_set(config_json,'$.intervalMinutes',360),next_fetch_at=NULL
WHERE connector='rss' AND status='approved'
AND json_extract(config_json,'$.country') IN ('BR','US')
AND json_extract(config_json,'$.authority')>=80;

-- Public newsroom feeds. Metadata and links only, with editorial review gates.
INSERT OR IGNORE INTO sources(id,name,connector,url,status,config_json,created_at)
VALUES('c5a4f217-d7bd-4a7e-b548-41db02001b01','Agência Brasil — Cultura','rss',
'https://agenciabrasil.ebc.com.br/rss/cultura/feed.xml','approved',
json_object('authority',70,'topics',json('["design","branding","art","typography","creative"]'),
'autoTopics',json('[]'),'languages',json('["pt"]'),'maxAgeDays',9,'metadataAllowed',json('true'),
'summaryAllowed',json('false'),'imageAllowed',json('false'),'autoApprove',json('true'),
'rightsNote','Feed RSS oficial, somente título, autoria, data e link com atribuição.',
'intervalMinutes',1440,'country','BR','radarCategory','graphic_design'),datetime('now'));
INSERT OR IGNORE INTO sources(id,name,connector,url,status,config_json,created_at)
VALUES('c5a4f217-d7bd-4a7e-b548-41db02001b02','NPR — Arts & Life','rss',
'https://feeds.npr.org/1008/rss.xml','approved',
json_object('authority',70,'topics',json('["design","branding","art","typography","creative"]'),
'autoTopics',json('[]'),'languages',json('["en"]'),'maxAgeDays',9,'metadataAllowed',json('true'),
'summaryAllowed',json('false'),'imageAllowed',json('false'),'autoApprove',json('true'),
'rightsNote','Feed RSS público, somente título, autoria, data e link com atribuição.',
'intervalMinutes',1440,'country','US','radarCategory','graphic_design'),datetime('now'));

