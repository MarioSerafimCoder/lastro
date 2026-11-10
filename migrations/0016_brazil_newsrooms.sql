-- Public Brazilian RSS metadata, without summaries, images or full text.
INSERT OR IGNORE INTO sources(id,name,connector,url,status,config_json,created_at)
VALUES('c5a4f217-d7bd-4a7e-b548-41db02001b03','B9 — Criatividade','rss',
'https://www.b9.com.br/rss/','approved',
json_object('authority',75,'topics',json('["branding","design","creative","art"]'),
'autoTopics',json('[]'),'languages',json('["pt"]'),'maxAgeDays',9,'metadataAllowed',json('true'),
'summaryAllowed',json('false'),'imageAllowed',json('false'),'autoApprove',json('true'),
'rightsNote','Feed RSS público, somente título, autoria, data e link com atribuição.',
'intervalMinutes',360,'country','BR','radarCategory','graphic_design'),datetime('now'));
INSERT OR IGNORE INTO sources(id,name,connector,url,status,config_json,created_at)
VALUES('c5a4f217-d7bd-4a7e-b548-41db02001b04','Meio & Mensagem — Mercado','rss',
'https://www.meioemensagem.com.br/feed','approved',
json_object('authority',75,'topics',json('["branding","design","creative","art"]'),
'autoTopics',json('[]'),'languages',json('["pt"]'),'maxAgeDays',9,'metadataAllowed',json('true'),
'summaryAllowed',json('false'),'imageAllowed',json('false'),'autoApprove',json('true'),
'rightsNote','Feed RSS público, somente título, autoria, data e link com atribuição.',
'intervalMinutes',360,'country','BR','radarCategory','graphic_design'),datetime('now'));
