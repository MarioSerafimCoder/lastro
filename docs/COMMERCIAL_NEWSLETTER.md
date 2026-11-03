# Inteligência comercial e newsletter — ativação pendente

Branches: Lastro `codex/commercial-newsletter`, CRM `codex/newsletter-attribution`, portfólio `codex/commercial-intake`.
Nenhum deploy, Secret, migration remota, serviço, cron, contato ou campanha real foi alterado.

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

Custo contratado incremental: R$ 0; nenhuma dependência, plano ou recurso pago novo. Homologação remota/ativação pendentes de autorização. Push das branches com `[CI Skip]` evita implantação automática do Pages.

## Verificação local

- CRM: 197 testes, TypeScript/build e compilação Pages Functions aprovados.
- Portfólio: 100 testes, TypeScript e build/exportação aprovados. Aviso de privacidade atualizado em português e inglês, por tradução editorial offline; nenhuma API de tradução chamada.
- Lastro: 19 testes direcionados de Analytics/oportunidades aprovados; TypeScript backend/frontend e build/dry-run aprovados; navegador desktop 1280 e mobile 390 aprovados.
- A suíte completa do Lastro revelou uma falha preexistente no teste de orçamento diário das sinopses (`tests/synopsis-autonomy.test.ts:806`): ele simula mais dez minutos a partir do relógio real e pode atravessar meia-noite UTC. A mesma falha `validated` versus `pending` foi reproduzida no commit original `a8888d8`, em checkout separado, sem as alterações desta entrega. Nenhum módulo de sinopses foi modificado. Duas verificações da suíte ficam ignoradas pelas condições já existentes.
- Não houve homologação remota de escrita, deploy ou alteração de dados reais. O Apps Script usa mocks de MailApp/UrlFetchApp nos testes; os relatórios usam respostas sintéticas.
