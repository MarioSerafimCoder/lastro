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
