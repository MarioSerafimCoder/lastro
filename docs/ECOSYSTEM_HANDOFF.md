# Ecossistema — integração 01

Backend preparado em `codex/ecosystem-integration-01` nos três repositórios alterados. Sem push, migração remota ou deploy. CRM e portfólio são sistemas estáveis em produção; alterações locais preexistentes não foram incorporadas nem interpretadas como trabalho incompleto. Portfólio não exige mudança.

## Arquitetura e arquivos

Lastro coordena; cada aplicativo conserva seu D1. `src/integration.ts`, `migrations/0008_ecosystem.sql` e `packages/contracts/{integration,ecosystem}.ts` implementam tarefas, eventos, vínculos e leituras. Oficina registra `research.package.created` na transação de criação do pacote.

Studio (`../ADM/studio-editorial`): `src/integration.ts`, `src/ecosystem-contract.ts`, alteração aditiva em `src/drafts.ts` e migration `0003_ecosystem.sql`. Reutiliza `createDraft`, `listPosts`, `readPost` e `publicationStatus`. Índice único por pacote protege até contra alteração posterior do slug. Não grava no GitHub.

CRM (`../crm-ecosystem-integration`, worktree de `mais-um-cafezinho-crm`): `functions/_integration.ts`, `shared/ecosystem-contract.ts`, middleware e testes. Reutiliza `getTemplate('blog')`, `htmlToDocument`, o PUT existente de rascunhos e seu compare-and-swap. Não requer migration. ID determinístico por slug/SHA impede sobrescrita em repetição, inclusive após edição humana. Não importa cliente Buttondown nem rotas de envio.

Contrato `ecosystem-1.0` com validação de execução e cópias idênticas, verificadas por teste. Zod no Lastro; validadores TypeScript sem dependências adicionais nos adaptadores. Datas ISO; apresentação deve usar `America/Fortaleza`.

## Endpoints e fluxos

Todas as rotas `/api` abaixo mantêm autenticação de proprietário e proteções atuais do Lastro.

| Método / rota | Contrato / efeito |
| --- | --- |
| POST `/api/research-packages/:id/studio-draft` | `{title,argument?,outline?}`; retorna 202 com tarefa. Ação explícita obrigatória. Mesmo pacote conserva primeira intenção e mesmo rascunho. |
| POST `/api/integrations/reconcile` | Descobre versões e processa até 3 tarefas vencidas, se habilitado. |
| POST `/api/integrations/tasks/:id/retry` | Reabre erro/intervenção por ação humana, preservando tentativas totais e eventos. |
| GET `/api/integrations/overview` | Rascunhos vinculados, artigos/agenda, newsletters, artigos sem newsletter, tarefas, eventos, recomendações e última sincronização. Listas limitadas a 100; seleção de referências até 20. |
| GET `/api/integrations/weekly` | Janela móvel de sete dias; contagens reais de referências aprovadas, pacotes, publicações confirmadas, newsletters e erros; estoque atual de rascunhos pendentes. Métricas externas sem sincronização são `null`. |

Servidor-servidor, assinatura obrigatória:

- Studio: POST `/integration/v1/drafts` (`DraftInput` → ID/revisão/URL administrativa); GET `/integration/v1/catalogue` (slugs/SHA e rascunhos vinculados); GET `/integration/v1/articles/:slug/:sha` (estado, metadados somente se disponível).
- CRM: POST `/integration/v1/newsletter-drafts` (`Article` → ID/URL administrativa). Exclusivamente rascunho privado, sem sincronização Buttondown, agendamento, assinantes ou envio.

Oficina transfere título fornecido, objetivo, argumento, notas, estrutura, títulos/URLs/notas das referências e ID de origem. Não transfere descrições nem textos integrais externos. Studio mantém frontmatter `draft` com resumo a preencher manualmente.

Blog → CRM exige o verificador existente do Studio: SHA do arquivo, head exato da branch principal, check Cloudflare Pages concluído com sucesso, data vencida e URL pública HTTP 200. Usa metadados da versão publicada, nunca alterações privadas posteriores. Sem confirmação, conserva pendência; alterações remotas exigem revisão da tarefa antiga enquanto nova SHA entra separadamente. Artigos demo não geram newsletters. A primeira reconciliação também considera artigos existentes. Na Fase 02, publicações anteriores ao início da ativação são retidas em `intervention/backlog_review`; a retentativa individual existente registra aprovação explícita para preparar o rascunho. Nenhuma newsletter histórica é preparada sem essa ação.

Estados: `pending`, `processing`, `completed`, `error`, `intervention`. Leases de 120 segundos, conclusão protegida por token, oito tentativas por ciclo; intervalo mínimo de 30 minutos, agendados aguardam a data. Recupera lease expirado. Falhas não guardam corpos, cabeçalhos nem mensagens externas. Eventos principais e vínculos usam chaves únicas. Eventos de erro preservam número total de tentativa mesmo após reabertura manual.

Catálogo consulta a cada 30 minutos, inclusive diante de POSTs repetidos. Limites explícitos: 50 artigos e 500 rascunhos vinculados; exceder retorna erro de capacidade, sem alegar catálogo completo. `freshness` informa última sincronização; não apresentar snapshots como leituras instantâneas. Resumo cobre integrações observadas, não histórico completo anterior à instalação. Referência “utilizada” nas recomendações significa encaminhada a rascunho vinculado. Sem IA ou chatbot novo.

## Configuração pendente — somente após autorização futura

1. Aplicar migrations **aditivas** Lastro 0008 e Studio 0003 antes de implantar os respectivos Workers. CRM não muda banco. Backups e homologação devem seguir procedimentos existentes; não executar migrations remotas nesta entrega.
2. Criar dois Secrets independentes aleatórios (mínimo 32 caracteres): Studio `ECOSYSTEM_SECRET` ↔ Lastro `STUDIO_INTEGRATION_SECRET`; CRM `ECOSYSTEM_SECRET` ↔ Lastro `CRM_INTEGRATION_SECRET`. Não reutilizar senha ADM, cookie, token GitHub ou credenciais entre destinatários.
3. Lastro: `STUDIO_ORIGIN=https://studio.marioserafim.com.br`, `CRM_ORIGIN=https://crm.marioserafim.com.br`; preferir binding Worker `STUDIO` → `studio-editorial`. O fallback HTTPS usa a mesma assinatura HMAC-SHA256 de método, caminho/query, corpo e timestamp, com validade de cinco minutos. Cookies e Origin são rejeitados nas rotas de serviço; replay de escrita permanece idempotente.
4. CRM mantém Cloudflare Access. Preparar aplicação/política de serviço restrita a `/integration/v1/*`, sem alterar a política humana do restante do CRM. Lastro suporta Secrets `CRM_ACCESS_CLIENT_ID` e `CRM_ACCESS_CLIENT_SECRET` para token exclusivo desse destino. Identidades de serviço sem e-mail não acessam APIs humanas; `ECOSYSTEM_ACCESS_SUB` pode fixar bloqueio adicional do sujeito. Testar política de borda em ambiente isolado antes de habilitar. Nenhuma configuração Access foi alterada.
5. Depois de validar os três serviços em ambiente isolado, definir `INTEGRATION_ENABLED=true` e adicionar cron Lastro `17,47 * * * *`, preservando os crons existentes. Configuração local inclui cron e flag **false**; configuração de produção permanece intacta. Desativar flag interrompe reconciliação sem apagar eventos ou vínculos.

## Para o Sol

Consumir os contratos, adicionar ação explícita “Criar rascunho no Studio” na Oficina e apresentar a tarefa retornada. Ler `overview` para Jarvis/calendário, incluindo `freshness`, estados pendentes/intervenção e URLs administrativas. `studioDrafts` usa estado sincronizado e reflete a criação confirmada imediatamente. Usar `Intl.DateTimeFormat` com `timeZone: 'America/Fortaleza'`; não converter `null` em zero. Sem botão de envio ou automação de campanha nesta integração.

Checkout Lastro atual, Studio em `../ADM/studio-editorial`, CRM isolado em `../crm-ecosystem-integration`. Testes de compatibilidade entre repositórios usam esses caminhos e são marcados como indisponíveis se os companions não existem; aqui ambos foram executados. Manter cópias do contrato sincronizadas ao mudar versão. Não incorporar alterações preexistentes das cópias originais CRM/portfólio.

## Validação

- Lastro: suíte completa de 90 testes aprovada; após ajuste final de projeção, os 10 testes de integração passaram, incluindo um novo teste entre handlers reais com **três D1 locais isolados** (91 testes distintos no projeto).
- Studio: 39 testes aprovados. CRM: 192 testes aprovados, incluindo rejeição de identidade de serviço nas rotas humanas.
- Cobertura: autenticação/escopo, payload inválido, concorrência, idempotência, timeout, erro sanitizado, tentativas limitadas, lease expirado, data futura/publicação não confirmada, versões distintas, preservação de edição humana e bloqueio de chamadas de envio.
- TypeScript dos três projetos e frontend Lastro/Studio; builds Vite; Workers Lastro/Studio em `--dry-run`; compilação Pages Functions CRM aprovados. Avisos de tamanho dos bundles do Studio/CRM permanecem, sem refatoração de frontend.
- Nenhuma dependência declarada adicionada, lockfile alterado, artigo real escrito, campanha disparada, assinante modificado ou recurso compartilhado implantado. Homologação de rede/Secrets/Access reais continua pendente de ativação autorizada.

## Fase 02 — experiência preparada para homologação

Branch `codex/ecosystem-experience-02`. `apps/web/src/Ecosystem.tsx` reúne Oficina → Studio, snapshots de Publicações, calendário e resumo; `experience.ts` prioriza recomendações reais do Jarvis. Cliente autenticado tipado ampliado com os endpoints existentes. Consulta de tarefa pendente a cada 15 segundos, limitada a 20 consultas e suspensa com aba oculta; atualização manual continua disponível. A confirmação de vínculo libera o link administrativo. Nenhuma consulta de estado aciona reconciliação.

Proteção do backlog: primeira reconciliação registra o instante de ativação em `integration_control` existente, sem migration nova. Antes de criar no CRM, artigo confirmado com data anterior a esse instante fica retido para revisão individual. O POST de retentativa já existente grava aprovação somente para `backlog_review`. UI apresenta “Aprovar rascunho para este artigo”. Permanecem pendentes configurações e homologação isolada descritas acima; nenhuma ativação real executada.

Validação Fase 02: 93 testes de backend/contratos aprovados; 35 testes Playwright aprovados (desktop, mobile, autenticação, acessibilidade, Jarvis e integrações); uma demonstração opcional ignorada. TypeScript backend/frontend, build Vite e bundle Worker em dry-run aprovados. Nenhuma alteração em Studio, CRM ou produção nesta fase.

## Fase 03 — homologação bloqueada por permissão Cloudflare (03/11/2026)

Estado: **homologação remota não aprovada; ativação não autorizada**. A Fase 02 contém integralmente `6ca5eff` (ancestral de `5c4ceec`). Branches remotas preparadas: Lastro `codex/ecosystem-integration-01`/`codex/ecosystem-experience-02`, Studio `codex/ecosystem-integration-01` (`4cee358`), CRM mesma branch (`fb72622`). Correção de homologação no Lastro: `codex/ecosystem-homologation-03`. Nenhuma branch de produção recebeu merge.

A sessão OAuth Wrangler existente autoriza Workers/D1/Pages, mas a consulta da organização Access e a criação de **token exclusivo de staging** retornaram HTTP 403 (código 10000). A consulta do plano/subscriptions também recebeu 403. Não foram criados bancos, tokens, aplicações Access, Workers ou configurações de staging, nem executadas migrations remotas. A lista de apps/tokens respondeu 200 vazia, mas isso não comprova permissão de escrita. Retomar exige uma credencial, fornecida por entrada protegida, autorizada a gerenciar aplicações/políticas e service tokens Access na conta e consultar o plano. Não alterar organização, políticas humanas ou serviços compartilhados para contornar o bloqueio.

O push da branch CRM gerou automaticamente um registro Pages **preview** no projeto existente: `https://48d2c07c.mais-um-cafezinho-crm.pages.dev`, estado observado `idle`. Não é staging isolado homologado: bindings/Access não foram aprovados e não recebeu testes de escrita. O deployment de produção continua na `main`, commit `c2684c9`, status success. Studio staging preexistente não foi alterado ou reutilizado.

Incompatibilidades confirmadas antes de implantação: (1) cliente Lastro declarava Secrets Access, mas não enviava cabeçalhos; corrigido somente no destino CRM, com regressão de escopo/ausência de vazamento; (2) allowlists de origem e links administrativos atuais fixam domínios de produção e precisam de configuração explícita de staging; (3) `publicationStatus` recusa branch isolada. Ao retomar, usar simulação remota controlada de publicação em staging, sem relaxar o verificador de produção. Nenhum fluxo foi apontado a bancos definitivos.

Backlog: portfólio `origin/main` no SHA `263eb79f5a9eba0ce22397ac42a4329099e1ee12`; **2 artigos** published, data vencida e não-demo. URLs públicas responderam HEAD 200; check Cloudflare Pages desse head estava completed/success:

- “Designers em tempos de IA: estamos terceirizando até o pensamento?” — `designers-em-tempos-de-ia-estamos-terceirizando-ate-o-pensamento` — 26/10/2026 12:29 Fortaleza.
- “Teste 03” — `teste-03` — 03/11/2026 12:13 Fortaleza.

Dois demos e um rascunho excluídos. Nenhuma newsletter histórica criada. Política permanece: instante inicial em `integration_control.activation`; publicação anterior fica `intervention/backlog_review`; somente aprovação individual via retentativa prepara rascunho. Recalcular inventário antes da ativação definitiva.

Validação nesta fase: 13 testes de integração + 3 de experiência Lastro, 39 Studio, 192 CRM e 6 smoke tests Playwright com fixtures locais aprovados. Cobrem comunicação entre handlers reais com D1 locais, assinaturas inválidas/expiradas, concorrência, retentativas, template e preservação manual; **não equivalem a comunicação entre serviços remotos implantados**. TypeScript e builds dos três projetos, dry-run Workers e compilação Pages Functions aprovados. Warnings de tamanho de bundles existentes preservados. A autenticação humana não foi alterada.

Retomada/ativação: [ ] liberar credencial Access de escopo apropriado; [ ] conferir plano/limites; [ ] três bancos exclusivos e configurações staging sem IDs de produção; [ ] migrations somente nesses bancos; [ ] Secrets distintos e binding Lastro→Studio; [ ] Access exclusivo nas rotas staging CRM e rejeição de serviço nas rotas humanas; [ ] homologação remota completa e smoke integrado desktop/mobile; [ ] revisar backlog; [ ] autorização separada para produção. Custos não confirmados por falta de leitura do plano; nenhum serviço pago contratado. Referência pública: [limites D1](https://developers.cloudflare.com/d1/platform/limits/) e [Workers](https://developers.cloudflare.com/workers/platform/limits/); prever apenas dados sintéticos e crons desativados no staging.

Rollback: não há alterações remotas desta fase a reverter. Não apagar o preview do projeto compartilhado nem modificar políticas/recursos preexistentes. Na retomada, registrar IDs e versões dos novos recursos, desativar `INTEGRATION_ENABLED` primeiro em caso de falha e reverter somente Workers/bancos staging identificados; preservar evidências e nunca limpar bancos definitivos.

SSO futuro: viável em princípio com uma única identidade/allowlist no Access para os três domínios. O Better Auth do Studio verifica sua própria sessão; acrescentar Access sozinho não elimina o segundo login. Será necessário definir uma ponte de identidade validada ou um provedor comum, tratando logout, expiração e associação ao ADM. Migrar gradualmente, preservar sessões/acesso atual e testar recuperação antes de retirar login anterior; nenhum cookie ou senha deve virar Secret de serviço. [Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [sessões Better Auth](https://better-auth.com/docs/reference/security), [planos Cloudflare](https://www.cloudflare.com/plans/). Uma identidade cabe no Free anunciado de até 50 usuários, sujeito ao plano/condições efetivos da conta. Nenhuma migração SSO implementada.

## Fase 03 retomada — staging remoto validado (03/11/2026)

Esta seção substitui o bloqueio de permissão anterior. O token temporário foi recebido pelo prompt nativo do Windows, armazenado com DPAPI em `.wrangler` ignorado pelo Git e validado antes da criação de recursos. Nenhum valor de credencial foi registrado ou versionado.

Recursos exclusivos, todos na conta existente e sem contratação/alteração de plano:

| Aplicação | URL | D1 exclusivo |
| --- | --- | --- |
| Lastro | https://lastro-ecosystem-staging.marioserafim-da.workers.dev | `lastro-ecosystem-stage03` / `02b2c69e-3780-484c-a0d2-034ebf15ea7a` |
| Studio | https://studio-ecosystem-staging.marioserafim-da.workers.dev | `studio-ecosystem-stage03` / `454412aa-c5fb-469d-9072-89f6a849de1d` |
| CRM | https://crm-ecosystem-staging.pages.dev | `crm-ecosystem-stage03` / `ae493a72-27d6-4219-9b55-cf1be0d835fe` |

Configs: `wrangler.ecosystem-staging.json` no Lastro/Studio; `wrangler.ecosystem-staging.toml` no CRM. Todas as migrations de bases novas foram aplicadas somente nesses IDs (Lastro 8, incluindo 0008; Studio 3, incluindo 0003; CRM 6). Configurações e bancos de produção não foram usados em testes de escrita. O campo `deployment_configs.production` na API Pages refere-se à branch padrão **do novo projeto `crm-ecosystem-staging`**, não ao projeto definitivo `mais-um-cafezinho-crm`.

Lastro usa o mesmo mecanismo existente de autenticação por senha/sessão; a variável lógica `ENVIRONMENT=production` habilita esse mecanismo sem alterar `auth.ts`, mas Worker, URL e D1 são exclusivos de staging. `ECOSYSTEM_STAGING=true` e origem exata do Lastro de staging habilitam somente os dois destinos de staging conhecidos. O cliente aceita links de staging apenas quando está no Lastro de staging. Nenhuma autenticação humana de produção foi alterada.

Secrets HMAC independentes Studio/CRM, senhas humanas distintas e binding `STUDIO` → `studio-ecosystem-staging` configurados. Token de serviço Access exclusivo, duração 24h, ID `048097ae-501b-429e-9469-479f96a73d19`. Aplicação Access somente `/integration/v1/*`: `30bea574-784b-482c-855b-a41215727d6a`; política aceita somente esse token. Aplicação separada no hostname raiz permite apenas `marioserafim.da@gmail.com` para o staging do CRM. As políticas preexistentes não foram modificadas.

Correção comprovada remotamente: Access acrescenta cookie de autorização à requisição de serviço, inicialmente recusada pelo contrato HMAC. CRM agora, quando `ECOSYSTEM_ACCESS_AUD` está configurado, verifica criptograficamente o JWT com audiência específica de integração e rejeita identidade humana antes de remover o cookie e verificar HMAC. A audiência humana `CF_ACCESS_AUD` permanece separada. Testes locais e remotos confirmaram serviço bloqueado nas APIs humanas. Configurar essa audiência específica também na futura ativação; não usar a audiência humana como substituta.

`Studio/staging/worker.ts` é uma entrada **exclusiva** de homologação. Fornece somente artigo/versão/check/HEAD sintéticos em memória e bloqueia todos os fetches externos de escrita. O endpoint de confirmação usa essa simulação, nunca a main real. A entrada de produção continua `src/index.ts`. Não transportar esse wrapper para produção. O slug `ecosystem-stage03-fixture` responde **404 no blog público real**. Não há token GitHub real no Studio de staging.

Resultados remotos:

- Oficina → Studio: pacote sintético, POST explícito 202, processamento por Service Binding, abertura do rascunho privado via API e editor no navegador, repetição sem duplicação e concorrência aprovados.
- Blog → CRM: confirmação simulada em Worker remoto; artigo retido para revisão histórica antes de aprovação individual; rascunho GrapesJS schema 3/template blog confirmado no D1 exclusivo. Repetição concorrente retornou mesmo ID e preservou edição manual **simulada por SQL no D1 de staging**, incluindo versão do documento.
- Segurança: Lastro sem sessão bloqueado; Access sem token bloqueado; identidade de serviço bloqueada em campaign-delivery/subscribers; assinaturas inválidas e expiradas recusadas. Nenhuma chamada de envio. Tabelas `campaign_send_attempts` e `editorial_tests` do CRM de staging com **zero registros**.
- Indisponibilidade: falha 503 induzida apenas no wrapper Studio de staging; tarefa ficou em erro e concluiu após retentativa, com duas tentativas. `STAGING_FAULT` terminou `disabled`. Seis tarefas sintéticas terminaram concluídas após recuperação.
- Navegador real apontado ao Lastro implantado: Oficina/criação, link e editor privado do Studio, Publicações, Jarvis, calendário Fortaleza, resumo semanal, desktop 1440 e mobile 390 sem overflow; feedback de API indisponível validado por interrupção de request no navegador.

Testes locais finais: suíte Lastro de 95 testes aprovada e regressão adicional de isolamento aprovada (96 testes distintos); Studio 39; CRM 193. TypeScript dos três projetos e frontend Lastro, builds Vite e Workers/Pages aprovados. Smoke remoto não substitui homologação humana do envio, que permanece fora desta fase.

Scripts reproduzíveis sem credenciais literais: `scripts/ecosystem-staging-smoke.ts`, `scripts/ecosystem-staging-browser.mjs`, `scripts/ecosystem-staging-fault.ts`. Usam variáveis de processo `STAGING_LASTRO_PASSWORD`, `STAGING_STUDIO_PASSWORD`, `STAGING_STUDIO_SECRET`, `STAGING_CRM_SECRET`, `STAGING_ACCESS_ID`, `STAGING_ACCESS_SECRET`, `STAGING_CF_OAUTH`; não passar valores como argumentos. Metadados dos IDs ficam em `.wrangler/ecosystem-staging-resources.json`, resultados sanitizados em `ecosystem-{remote,browser,fault,audit}-results.json` e evidência de bindings/versões em `ecosystem-infrastructure-evidence.json`. Os arquivos `.credential.xml` locais só podem ser descriptografados pelo mesmo usuário Windows. Não imprimir seu conteúdo. Respeitar o limite de tentativas de login ao repetir os scripts.

Estado da produção observado por leitura: Lastro Worker ainda versão `e08e3fe8-d3e4-4d63-a007-d33677d0cad5` (24/10); Studio `6cf1defd-f26c-47f7-afa4-fcf8a41a9b93` (03/11 15:36 UTC, anterior a esta retomada); Pages CRM deployment `9eba6119-a5f9-4d8a-b26d-354db89cbde8`, branch main, D1 definitivo preservado. Nenhuma migration, Secret, política ou deploy foi aplicado nesses serviços.

Custo previsto: três bancos novos somando cerca de 0,65 MiB na verificação, sete bancos no total da conta; duas Workers e um projeto Pages isolados, tráfego sintético pontual. Nenhum cron, binding AI, chave Buttondown ou envio configurado em staging. Conta com usage model `standard` preexistente, sem alteração de plano. Esses recursos e esse volume são inferiores aos limites públicos básicos; a consulta da assinatura/faturamento global continua sem permissão, portanto não se afirma custo global zero. Token de serviço temporário expira em 24h; renovar com escopo equivalente apenas se necessário.

Rollback: definir primeiro `INTEGRATION_ENABLED=false` apenas em `lastro-ecosystem-staging`; remover/desabilitar somente as duas aplicações Access novas e revogar somente o token indicado, se for desativar staging; reverter Workers de staging para versões registradas ou remover exclusivamente esses dois Workers e o projeto Pages `crm-ecosystem-staging`. Preservar os três D1 de staging/evidências até aceite; apagar esses IDs somente em limpeza posterior autorizada. Não remover o staging antigo do Studio, previews do projeto CRM definitivo ou qualquer recurso de produção. A falha induzida deve permanecer desativada.

Backlog definitivo permanece **2 artigos elegíveis** da consulta anterior, sem newsletters históricas preparadas. Reconsultar títulos/versões imediatamente antes da ativação, manter o instante inicial e aprovação individual dos antigos. Próximo checklist: [ ] revisão humana dos recursos de staging; [ ] confirmar consumo/limites da conta; [ ] retirar wrapper sintético do plano de produção; [ ] configurar duas audiências Access e Secrets próprios de produção, somente após autorização; [ ] planejar migrations aditivas, backup e rollback definitivos; [ ] rever backlog; [ ] obter autorização explícita para produção. SSO futuro continua apenas avaliado, sem migração implementada.
