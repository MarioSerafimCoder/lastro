# Inteligência comercial e newsletter

Branches: Lastro `codex/commercial-newsletter`, CRM `codex/newsletter-attribution`, portfólio `codex/commercial-intake`.
Na preparação original, nenhum serviço ou dado real foi alterado. O registro de ativação autorizada e suas evidências está na última seção.

## Contratos e limites

- Apps Script preserva MailApp e somente depois encaminha POST para `/integration/v1/opportunities`. Script Properties: `LASTRO_OPPORTUNITIES_SECRET`; Worker: `PORTFOLIO_INTEGRATION_SECRET`. Mesmo segredo exclusivo, aleatório, mínimo de 32 caracteres. Nunca versionar seu valor.
- HMAC-SHA256 hexadecimal de `timestamp + "\nPOST\n/integration/v1/opportunities\n" + corpo JSON literal`. Headers `X-Portfolio-Time` (milissegundos), `X-Portfolio-Signature`. Tolerância de cinco minutos, corpo máximo 8 KiB, data de entrada em até 24h. ID UUID gerado no servidor. Duplicatas são ignoradas em transação; recibo de sete dias impede recriação após exclusão manual durante a janela de replay.
- Falha Lastro registra apenas código sanitizado e não muda o sucesso do e-mail. Não existe fila persistente de retentativas: se o encaminhamento falhar, o e-mail preservado é a recuperação manual. Evita duplicar PII em Script Properties e novas tarefas agendadas.
- Campos opcionais via formulário: WhatsApp, área, orçamento e resumo. O e-mail mantém o briefing anterior. Dados comerciais não entram na newsletter nem no GA4.
- APIs `/api/opportunities` e `/api/commercial/recommendations` usam autenticação de administrador existente. Lista até 1.000 registros recentes, busca/filtros locais; notas até 4.000 caracteres. Retenção `OPPORTUNITIES_RETENTION_DAYS`: padrão 365, 1–3650 dias, limpeza na entrada/leitura, sem cron novo. E-mails na caixa postal seguem política própria.
- UTMs somente em links HTTPS do blog, inclusive `/en/blog`, nos hosts públicos autorizados. Parâmetros existentes prevalecem. Exportação HTML e preparação Buttondown recebem marcação; documento editável e exportação original permanecem intactos. Campanha usa slug do assunto; assuntos iguais compartilham slug, e mudanças no assunto mudam a marcação. Não há identificador pessoal adicionado.
- Newsletter GA4 reutiliza OAuth, relatórios, cache, lease, backoff e janela 7/30 dias, com filtro exato `mais_um_cafezinho`/`email` e cache separado. Páginas/dias incluem dimensão de campanha; até 100 linhas. Dados de abertura/cliques pagos não são consultados.
- CRM `/integration/v1/newsletter-summary` reutiliza HMAC e Access existentes, lista a página recente de envios, assunto, slug, data e destinatários quando informados pelo provedor; ausente é `null`. Lastro guarda snapshot por 12h, falha recua 1h. Associações ambíguas não são inferidas.
- Jarvis usa contagens atuais e snapshots recentes para recomendações determinísticas, com ações para os painéis. Não envia mensagens e não chama modelos.

## Ativação — somente após autorização única de produção

1. Revisar commits e testes; conferir cotas gratuitas e planos existentes. Não ativar faturamento nem excedentes pagos. Os limites do código restringem chamadas, mas não substituem o acompanhamento das cotas compartilhadas.
2. Exportar backup do D1 existente com Wrangler para arquivo local ignorado e protegido. Verificar arquivo não vazio, SHA-256 e `PRAGMA integrity_check` em uma restauração SQLite isolada. Registrar versão atual do Worker, Pages e Apps Script. Não copiar backup para Git.
3. Aplicar exclusivamente `0010_opportunities.sql` ao D1 Lastro existente. Conferir tabela e índices. Não reaplicar GA4 ou migrations antigas, não criar banco ou Worker.
4. Provisionar o segredo exclusivo pelos canais protegidos, com o mesmo valor em Script Properties e Worker. Nunca incluir credenciais no cliente. Configurar retenção conforme decisão do administrador.
5. Implantar apenas Lastro, CRM e portfólio alterados. Atualizar Apps Script no web app existente, preservando URL, proprietário, acesso e limites antiabuso. O uso de UrlFetchApp pode exigir autorização pessoal Google para `script.external_request`: solicitar somente essa ação ao proprietário.
6. Verificar leitura autenticada, rejeição anônima e ausência de PII em respostas públicas. Testes de escrita somente locais/sintéticos isolados; não criar contatos ou campanhas artificiais em produção.
7. Painéis após ativação: `/oportunidades` e `/newsletters` no Lastro. Campanhas antigas sem os novos UTMs não são retroativamente rastreadas. Consentimento e limites de relatórios afetam a cobertura; zero não prova ausência de visitas.

## Rollback

Reverter os três códigos e o Apps Script para as versões registradas. Remover somente a configuração da integração comercial para interromper encaminhamentos. Preservar a tabela aditiva e os registros privados; não restaurar backup sobre dados posteriores sem análise e autorização. GA4 e integrações editoriais permanecem independentes. Não remover Secrets ou dados preexistentes.

Custo contratado incremental: R$ 0; nenhuma dependência, plano ou recurso pago novo. Ativação posteriormente autorizada e registrada na última seção. Push das branches com `[CI Skip]` evita implantação automática do Pages.

## Verificação local

- CRM: 197 testes, TypeScript/build e compilação Pages Functions aprovados.
- Portfólio: 100 testes, TypeScript e build/exportação aprovados. Aviso de privacidade atualizado em português e inglês, por tradução editorial offline; nenhuma API de tradução chamada.
- Lastro: 20 testes direcionados de Analytics/oportunidades aprovados após os ajustes de ativação; TypeScript backend/frontend e build/dry-run aprovados; navegador desktop 1280 e mobile 390 aprovados.
- A suíte completa do Lastro revelou uma falha preexistente no teste de orçamento diário das sinopses (`tests/synopsis-autonomy.test.ts:806`): ele simula mais dez minutos a partir do relógio real e pode atravessar meia-noite UTC. A mesma falha `validated` versus `pending` foi reproduzida no commit original `a8888d8`, em checkout separado, sem as alterações desta entrega. Nenhum módulo de sinopses foi modificado. Duas verificações da suíte ficam ignoradas pelas condições já existentes.
- Não houve homologação remota de escrita, deploy ou alteração de dados reais. O Apps Script usa mocks de MailApp/UrlFetchApp nos testes; os relatórios usam respostas sintéticas.

## Produção ativada — 03/11/2026, horário de São Paulo

Autorização explícita recebida para backup, migration 0010, segredo exclusivo, deploys e atualização do Apps Script. Nenhuma contratação, mudança de plano ou faturamento foi realizada; plano Workers Free confirmado no painel. Custo incremental R$ 0.

Backup protegido e ignorado em `.wrangler/commercial-activation/lastro-before-0010.sql`: 5.734.554 bytes, SHA-256 `bc2e933bca97cc4d46b55ede25474ae22f3941e11cc968d69c488c13900a7b7c`. Restaurado em SQLite em memória, `integrity_check=ok`, 48 tabelas e migrations 0001–0009. Versões anteriores registradas antes das alterações: Lastro `9f866461-4f69-40c9-a1e1-b1cb2d851472`, CRM `22f85053-8c48-48b7-b201-0ea44b9406ed` / `34f72d3`, portfólio `bdd952a8-712a-4e72-b958-1afd8bffa48d` / `263eb79`, Apps Script versão 2.

Aplicada exclusivamente `0010_opportunities.sql`; `quick_check=ok`. Zero oportunidades e zero recibos após a homologação remota. O segredo exclusivo foi gerado aleatoriamente, provisionado por stdin no Worker e em Script Properties; recuperação local cifrada por DPAPI CurrentUser, diretório com ACL restrita. A transferência temporária foi removida. Os 24 bindings anteriores do Lastro foram preservados exatamente; acrescentado somente `PORTFOLIO_INTEGRATION_SECRET`. Crons preservados.

A primeira verificação encontrou resposta 405 no intake, interceptado pelo serviço de assets. Foi executado rollback imediato à versão anterior, sem restaurar ou remover dados. Ajuste mínimo de implantação: `/integration/*` em `assets.run_worker_first`, verificado localmente antes da reativação. Nenhuma funcionalidade nova foi criada nesta etapa.

O relatório filtrado retornou a forma legítima do GA4 de relatório vazio apenas com metadados, sem cabeçalhos. O parser da nova modalidade newsletter foi corrigido para aceitar somente essa forma identificada (`kind=analyticsData#runReport`, metadados, nenhuma linha e contagem ausente/zero), mantendo listas vazias e sem fabricar métricas zero. Resposta arbitrária `{}` continua rejeitada. Cache da modalidade corrigida é `newsletter-v2`, independente do GA4 anterior. Vinte testes direcionados aprovados; TypeScript aprovado. A integração GA4 geral permaneceu funcionando.

Versões finais:

- Lastro Worker `ac6536e7-845b-4b9b-9145-3c42474d4ea4`, branch `codex/commercial-newsletter`, contendo os ajustes de ativação registrados neste documento.
- CRM commit `4592a13`, produção Pages `11c17df0-1be0-4bf0-8fe7-a9070e49499a`.
- Portfólio commit `714588c`, produção Pages `a2912205-4085-4fbc-9777-833f0d924c9c`.
- Apps Script existente atualizado à versão 3, mesma URL `/exec`, proprietário e acesso. Secret salvo em Script Properties. Execução de `doGet` no editor concluiu sem novo consentimento. GET público e POST inválido retornaram 200, com rejeição de campos no segundo caso; nenhum MailApp foi acionado na homologação. O caminho de envio e a tolerância à falha do Lastro foram testados com mocks, preservando a proibição de e-mail real.

Verificações remotas: health 200; APIs oportunidades, newsletter e Analytics anônimas 401; intake sem assinatura 401, assinatura válida com contrato inválido 400 sem escrita. Painel Oportunidades autenticado mostra zero registros; newsletters 7/30 dias disponíveis sem erro e sem sessões sob a nova marcação, com quatro envios antigos do CRM disponíveis. Quantidade de destinatários ausente permanece indisponível. GA4 geral exibe os relatórios existentes; Jarvis oferece consulta às campanhas reais; Publicações carrega catálogo/calendário e registra zero falhas de integração, mantendo as cinco pendências históricas sem aprovação ou reprocessamento. Página inicial, contato e privacidade PT/EN do portfólio responderam 200. Cloudflare Access do CRM preservado.

Painéis: https://lastro.marioserafim.com.br/oportunidades e https://lastro.marioserafim.com.br/newsletters. CRM: https://crm.marioserafim.com.br. Portfólio: https://marioserafim.com.br/contato. Não foram criados contatos artificiais, alterados assinantes, enviados e-mails/campanhas ou aprovados artigos durante os testes remotos. A ressalva preexistente de horário das sinopses permanece documentada acima.

Verificação final de UTMs sem editar campanhas: o CRM autenticado serviu `index-DNE6D5EK.js`, correspondente ao build local aprovado; esse entrypoint referencia `EditorPage-DRQ3WF2J.js`, contendo `utm_source`, `utm_medium`, `utm_campaign` e `mais_um_cafezinho`. Os testes de preservação de parâmetros, fragmentos, HTML e links externos foram feitos localmente no mesmo código; nenhuma campanha real foi exportada ou alterada para essa conferência. Login humano do CRM pelo provedor Cloudflare existente concluiu e a interface confirmou Buttondown conectada. Código final do Lastro registrado no commit `23530ee`; os commits `4592a13` e `714588c` acionaram os builds de produção Pages sem modificar as árvores homologadas.
