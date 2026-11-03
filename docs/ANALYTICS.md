# Lastro Analytics

Integração GA4 implantada em produção em 03/11/2026, na branch `codex/lastro-analytics`. Worker definitivo `lastro-api`, versão `9f866461-4f69-40c9-a1e1-b1cb2d851472`; staging existente `lastro-ecosystem-staging`, versão `6684f355-65ad-41fa-9043-f7d27afa38fc`. Nenhum Worker, D1, cron, plano ou recurso pago criado.

## OAuth e privacidade

Projeto Google `project-0472db88-3d1b-4340-925`, Data API ativada, propriedade `560757639`. App externo em produção para uso pessoal; cliente definitivo `Lastro Analytics — Produção`, ID `111592653976-ant88deecg3ucvpof8e2d2h062lfsv1k.apps.googleusercontent.com`. Somente `https://www.googleapis.com/auth/analytics.readonly`. O Google mantém aviso de app não verificado e limite de 100 usuários; o console mostrou 1 usuário. Conta de serviço e política de bloqueio de chaves preservadas.

Consentimento confirmado pelo proprietário. A primeira tentativa retornou state inválido/expirado; um novo fluxo com state, nonce HttpOnly e PKCE válidos concluiu o download. O pedido usou o cliente definitivo mantendo o callback de staging cadastrado, sem trocar as credenciais do Worker de staging. A troca do código e a renovação real de access token funcionaram; a resposta não informou `refresh_token_expires_in`, afastando a expiração de sete dias própria do modo de teste. Isso não garante validade infinita: revogação, inatividade e outras políticas podem exigir nova autorização ([Google](https://developers.google.com/identity/protocols/oauth2#expiration)).

Após validar relatórios no Worker definitivo, o callback temporário foi removido somente do cliente de produção. Callback definitivo: `https://lastro.marioserafim.com.br/api/analytics/oauth/callback`. Branding salvo com página inicial `https://lastro.marioserafim.com.br/api/analytics/info` e privacidade `https://lastro.marioserafim.com.br/api/analytics/privacy`; ambas públicas com HTTP 200. Relatórios e provisionamento exigem autenticação Lastro; leitura anônima do overview retorna 401.

Secrets definitivos: `GOOGLE_OAUTH_CLIENT_SECRET` e `GA4_REFRESH_TOKEN`. Variáveis: `ANALYTICS_ENABLED=true`, `GA4_PROPERTY_ID=560757639` e `GOOGLE_OAUTH_CLIENT_ID`. Tokens e client secret não chegam ao frontend, ao D1 ou ao Git. O provisionador temporário ignorado foi revisado para salvar recuperação criptografada com Windows DPAPI CurrentUser antes das verificações seguintes; a pasta tem ACL restrita. A instalação exigiu marcador gerado apenas depois do backup e da migration verificados. Arquivos temporários de cliente, autorização e recuperação foram removidos após a validação de produção.

## Indicadores e verificações

Painel Analytics com filtros de 7/30 dias completos até ontem, conforme fuso da propriedade. Totais próprios de usuários ativos, sessões, visualizações, taxa e duração total de engajamento; usuários do período não são somados a partir dos dias. Relatórios por data, página, origem/mídia e campanha de sessão; limite de cem linhas nas tabelas e filtro de possíveis dados pessoais. Sem coleta individual, IA ou escrita no Google Analytics.

Consultas reais de produção: sete dias, 6 usuários, 30 sessões, 287 visualizações, 76,7% de engajamento e 8.894 segundos; trinta dias, 7 usuários, 42 sessões, 354 visualizações, 76,2% e 10.030 segundos. Todos os cinco relatórios disponíveis. Snapshot de sete dias em `2026-11-03T20:14:39.648Z`; trinta dias em `2026-11-03T20:15:10.676Z`. Reconsulta de sete dias reutilizou o mesmo snapshot; D1 confirmou cache separado e próxima consulta após doze horas, sem erro. Atualização manual limitada a uma por hora por período, lease concorrente, backoff e snapshots antigos cobertos pelos testes; botão manual desabilitado durante a janela de bloqueio no painel real. Uma tentativa adicional de login de staging via CLI retornou o limite 429; ele foi respeitado, mantendo a sessão já autenticada no navegador.

Doze testes Analytics e 108 testes totais passaram; TypeScript backend/frontend, build Vite e dry-run do Worker definitivo passaram. Regressões incluem total sem `dimensionHeaders`/`dimensionValues`, respostas vazias, 7/30 dias e rejeição de cabeçalhos ausentes em relatórios com dimensão. O problema `analytics_invalid_response` foi resolvido; métricas e dimensões foram aceitas pela API real. Uso de `redirect:manual` preservado: respostas 3xx não encaminham credenciais. Erros 401/403/429, cache e concorrência testados localmente sem esgotar cotas reais ([quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas)).

Painel homologado autenticado em staging e produção, com filtros e indicadores reais. Produção inspecionada em desktop de 1280 px e mobile de 390 px; largura de documento 390 px no mobile, sem overflow da página. Emulações temporárias removidas. O controle do navegador interno se recuperou ao reinicializar a sessão da ferramenta; não foi necessário contornar restrições de acesso.

## Banco, configuração e ecossistema

Backup definitivo anterior à migration em `.wrangler/production-bootstrap/lastro-before-0009.sql`, 5.726.588 bytes, SHA-256 `c8487a5d9b99b536fad043cc358ab73e264a425501e2498762892b30af277d61`. Restaurado integralmente em SQLite em memória, `integrity_check=ok`, 46 tabelas e oito migrations anteriores. Aplicada exclusivamente `0009_analytics.sql`; duas tabelas Analytics verificadas e `quick_check=ok` no D1 remoto. Backup e evidências agregadas ficam ignorados pelo Git.

Conferência pós-deploy preservou exatamente os 19 bindings anteriores e acrescentou somente três variáveis e dois Secrets GA4. Os três crons existentes permanecem `*/5 * * * *`, `2-57/5 * * * *` e `17,47 * * * *`. Nenhum repositório de Studio/CRM foi modificado. Radar autenticado carregou 16 referências, Jarvis e Publicações carregaram. Catálogo Studio com última sincronização `2026-11-03T19:47:12.484Z`, sem erro registrado na leitura. As pendências editoriais coincidem com o backup anterior: duas `backlog_review`, três `github_draft`, uma tarefa Studio concluída; não foram aprovadas nem reprocessadas. Novo envio para CRM não foi exercitado, para preservar a restrição de não criar/enviar conteúdo nesta validação; contratos e comunicação isolada entre os três serviços passaram nos testes.

A senha foi redefinida por solicitação do proprietário somente no staging, com rotação de sua assinatura de sessão e login validado. Senha e sessões da produção preservadas; proprietário entrou pessoalmente na produção para homologação.

## Custos e rollback

Custo incremental R$ 0: projeto Google confirmado sem conta de faturamento, Data API real funcionando nesse estado, infraestrutura Cloudflare existente, sem contratação, mudança de plano, novos recursos ou cron. A integração reaproveita os limites existentes; não garante capacidade ilimitada.

Rollback funcional: definir `ANALYTICS_ENABLED=false` e reimplantar somente Lastro; conservar as tabelas e snapshots. Para voltar ao código anterior, versão pré-GA4 `54fd4519-6eec-4d05-9ccb-b43225ca9553` (avaliar os Secrets da versão ao reverter). A migration é aditiva e não precisa ser removida para desligar o módulo. O backup verificado permite recuperação do banco se necessária, sem restaurá-lo automaticamente sobre alterações posteriores.

Ressalvas: app pessoal não verificado e tokens revogáveis; cinco pendências editoriais preexistentes permanecem sob decisão do proprietário. Não houve publicação, campanha, aprovação de backlog ou mudança de política de segurança.
