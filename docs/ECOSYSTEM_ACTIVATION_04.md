# Ecossistema — release de produção preparada

Estado em 03/11/2026: branches `codex/ecosystem-production-04` derivadas das branches definitivas e com os commits homologados. Nenhum serviço ou banco definitivo foi modificado nesta fase. Studio usa `src/index.ts`; a simulação `staging/worker.ts` não integra a release.

| Serviço | Versão atual | D1 definitivo | Migration pendente |
| --- | --- | --- | --- |
| Lastro | `e08e3fe8-d3e4-4d63-a007-d33677d0cad5` | `b3ab414c-bdcd-4348-a942-2cb153bc9f1b` | `0008` |
| Studio | `6cf1defd-f26c-47f7-afa4-fcf8a41a9b93` | `51669b5c-01ea-4208-b1f1-4ca36360cbbb` | `0003` |
| CRM | `9eba6119-a5f9-4d8a-b26d-354db89cbde8` | `4460ef9d-fb2b-4756-aa00-37fb0b80d056` | Nenhuma |

Após autorização explícita: exportar backups D1 definitivos Lastro e Studio para arquivos locais protegidos; verificar tamanho, esquema e integridade de leitura. Aplicar apenas as migrations pendentes e confirmar `d1_migrations`. Configurar Secrets definitivos independentes por entrada protegida: Studio `ECOSYSTEM_SECRET`; CRM `ECOSYSTEM_SECRET`; Lastro `STUDIO_INTEGRATION_SECRET`, `CRM_INTEGRATION_SECRET`, `CRM_ACCESS_CLIENT_ID`, `CRM_ACCESS_CLIENT_SECRET`. Criar Access Service Auth exclusivo para `/integration/v1/*` do CRM; configurar `ECOSYSTEM_ACCESS_AUD` diferente de `CF_ACCESS_AUD` e `ECOSYSTEM_ACCESS_SUB`. Preservar o app/política humanos.

Implantar Studio, CRM e Lastro nessa ordem, com `INTEGRATION_ENABLED=false`. O arquivo de produção do Lastro preserva AI, ingestão, sinopses e os crons existentes `2-57/5 * * * *` e `*/5 * * * *`. Confirmar rotas, assinaturas, identidade e disponibilidade antes de habilitar. Recontar backlog; então definir `INTEGRATION_ENABLED=true` e acrescentar somente `17,47 * * * *`. Testar rascunho privado do Studio, snapshots e proteção humana. Não aprovar artigos antigos nem acionar campanhas.

Rollback: desligar a integração e retirar apenas o cron adicional; preservar D1 e registros. Reverter somente a versão Worker/Pages necessária, usando os IDs acima ou os IDs lidos logo antes do deploy. Desabilitar Secrets/Access novos somente após interromper a integração; conservar políticas humanas e crons anteriores. Migrations aditivas permanecem. Não restaurar backup sobre novos dados sem análise específica.

A API da conta retornou `Cloudflare Free Plan` e `Teams Free Base`; nenhum plano novo será contratado. O portfólio público `origin/main` continua no commit `263eb79`, com dois artigos elegíveis anteriores à ativação, sujeitos a nova conferência imediatamente antes de ligar o cron.

## Execução autorizada — 03/11/2026

Backups em `Lastro/.wrangler/production-backups-04`, fora do Git e com ACL restrita: `lastro-before-0008.sql` (5.712.794 bytes; SHA-256 `7ab814a442f6988d3fa4237c2199e0e80e869659b9f4db01e131bdde93f70541`) e `studio-before-0003.sql` (55.804 bytes; SHA-256 `74867b6d57b121c717e505012c0e97c26d62c229e80f1dc61c551138160a8c10`). Ambos restaurados em SQLite local, `integrity_check=ok`. Aplicadas somente 0008/0003; `quick_check=ok` nos dois D1 após a operação.

Deploy na ordem Studio (`6086298d-69b5-4771-89e5-8e30bf028cc0`), CRM (`7a8f0719`), Lastro (final `54fd4519-6eec-4d05-9ccb-b43225ca9553`). Lastro inicialmente desligado; após testes de serviço, ativado e acrescentado apenas cron `17,47 * * * *`. Secrets HMAC distintos de staging e entre destinatários, token Access exclusivo de produção e app restrito à rota de integração. Credenciais humanas preservadas. Nenhum plano ou recurso pago contratado.

Smoke real: Studio catálogo assinado 200; CRM Access+HMAC com payload inválido 400, sem escrita; serviço nas APIs humanas 403; Lastro sem sessão 401, login humano 200, overview/weekly 200. Pacote `c7919845-e3fb-4f96-88c6-f683d24ce011`, tarefa reutilizada sem duplicação, rascunho privado Studio `bcf95e84-8fad-44aa-a6a1-4374484922f5`. Seleção original da Oficina restaurada. Dois artigos retidos em `backlog_review`, três arquivos privados em `github_draft`, zero vínculos de newsletter. Sem artigo público, campanha, assinante ou aprovação histórica alterados pela integração.

Navegador real: login Lastro, Publicações, Jarvis, calendário, resumo semanal e mobile sem overflow aprovados. A senha fornecida ao teste do Studio retornou 401; a verificação visual autenticada do editor depende de conferência pelo proprietário. O endpoint privado e o registro do rascunho foram confirmados. Nenhuma alteração de autenticação foi feita para contornar essa etapa. Evidências locais sanitizadas em `smoke-results.json`, `draft-intent.json`, screenshots e arquivos de verificação no mesmo diretório protegido dos backups.
