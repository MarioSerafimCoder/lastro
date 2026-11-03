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

Blog → CRM exige o verificador existente do Studio: SHA do arquivo, head exato da branch principal, check Cloudflare Pages concluído com sucesso, data vencida e URL pública HTTP 200. Usa metadados da versão publicada, nunca alterações privadas posteriores. Sem confirmação, conserva pendência; alterações remotas exigem revisão da tarefa antiga enquanto nova SHA entra separadamente. Artigos demo não geram newsletters. A primeira reconciliação também considera artigos existentes.

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
