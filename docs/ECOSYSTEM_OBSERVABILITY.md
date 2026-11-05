# Radar, integrações e observabilidade

## Inventário e baseline em 05/11/2026

| Repositório                                     | Base verificada                                                          | Papel                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Lastro `MarioSerafimCoder/lastro`               | `origin/master` em `53c2164` e estabilização local do Radar em `e682967` | Worker, D1, Radar, Jarvis, GA4 e integração editorial/comercial |
| Studio `MarioSerafimCoder/studio-editorial`     | `origin/main` em `9b22883`                                               | Worker, Better Auth, D1 e rotas de serviço HMAC                 |
| CRM `MarioSerafimCoder/mais-um-cafezinho-crm`   | `origin/main` em `4592a13`                                               | Pages, D1, Cloudflare Access humano e Access + HMAC de serviço  |
| Portfólio `MarioSerafimCoder/portfolio-oficial` | `origin/main` em `714588c`                                               | Site público, formulário e encaminhamento assinado              |

A branch local `codex/ecosystem-observability` parte da estabilização do Radar. O login unificado tem branch própria. O baseline local do Lastro passou com 186 testes, TypeScript e builds. O esquema anterior a esta entrega termina em `0014_radar_editorial.sql`. Os aplicativos usam seus bancos independentes.

Sondas anônimas de produção em 05/11 confirmaram Lastro `/health` 200 e `/api/feed` 401, Studio `/api/auth/get-session` 401, CRM `/` 302 e Portfólio `/` 200. Nos endereços de staging registrados anteriormente, Lastro `/health` respondeu 200, Studio `/api/auth/get-session` 401 e CRM `/` 302. As sondas comprovam resposta e proteção das rotas verificadas. Versões efetivamente implantadas, políticas, esquema de staging e cotas atuais exigem leitura administrativa para liberar a homologação.

## Fase 1 · Radar

O commit `9aeb037` reutiliza metadados e decisão de licença do feed entre itens, sanitiza o corpo autorizado uma vez e evita dois comandos de fila D1 em descobertas vazias ou HTTP 304. A validação de XML, a decisão por item, os limites, os vínculos e a deduplicação permanecem cobertos pelos testes existentes. O plano de 19 fontes é o registrado na última ativação. Esta branch não altera cadência, fontes ou retenção.

| Medição                               | Antes                                          | Depois                                             |
| ------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| CPU real no Worker publicado em 04/11 | P50 3,348 ms e P99 117,853 ms em 75 invocações | Pendente de nova medição com o código desta branch |
| CPU local do parser RSS               | Mediana 3,9 ms por coleta                      | Mediana 3,1 ms por coleta, com o mesmo resultado   |
| Descoberta sem itens                  | Dois comandos D1 executados sobre a fila vazia | Os dois comandos são evitados                      |

O ensaio local usou Node 24, um RSS sintético de 104.959 bytes com 25 itens e 11 pares de lotes de 20 parses, após aquecimento. O próximo ensaio no Worker deve comparar CPU P50, P95 e P99 por rotina, duração separadamente, filas, falhas e leituras/escritas D1. Usar uma janela que inclua as fontes mais pesadas e preservar a retenção desligada. O limite nominal de CPU do plano gratuito é 10 ms por invocação. [Medições da última ativação](radar2-activation.md) · [Limites do Workers](https://developers.cloudflare.com/workers/platform/limits/)

## Fase 2 · Matriz de homologação

| Fluxo                        | Esperado                                                                                     | Evidência e observação                                                                                                                                                                                                                                                             | Última verificação registrada               | Ambiente                            | Estado                       |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------- | ---------------------------- |
| A · Portfólio → Lastro       | Formulário envia e-mail e oportunidade, permite editar e aparece no Jarvis sem duplicar      | Envio e falha de encaminhamento foram simulados. A rota real recusou HMAC ausente e rejeitou contrato inválido com assinatura válida. D1 local e testes cobrem criação idempotente, atualização e acompanhamento. Falta uma submissão legítima ou um teste de produção autorizado. | Sonda em 05/11 e registros de ativação      | Local e produção                    | Parcial                      |
| B · Radar → Oficina → Studio | Pacote gera tarefa e um rascunho privado, com retentativas e versão preservada               | Rascunho privado criado e aberto no editor autenticado em produção, com repetição sem duplicação. Concorrência, indisponibilidade e retentativas foram exercitadas em ambiente isolado. Os testes locais usam handlers reais e D1 separados com upstreams simulados.               | Ativação registrada e testes desta branch   | Local, staging histórico e produção | Aprovado no escopo observado |
| C · Blog → CRM               | Artigo publicado e confirmado gera um único rascunho vinculado, com edição manual preservada | Verificador, rascunho e concorrência exercitados com fixtures no staging. Falta um artigo novo elegível em produção para comprovar o ciclo real. O backlog retido continua dependente de aprovação individual.                                                                     | Homologação histórica e testes desta branch | Local e staging histórico           | Parcial                      |
| D · CRM → Lastro → GA4       | Relatórios distinguem campanhas, atribuição, ausência e dados antigos                        | Campanhas reais foram consultadas no CRM/Lastro. O GA4 respondeu com relatório vazio para a nova marcação, sem tráfego real atribuído na amostra. Agora, em falha do CRM, o último snapshot válido fica visível com aviso de desatualização.                                       | Ativação histórica e testes desta branch    | Local e produção                    | Parcial                      |

[Integração e ensaios de staging](ECOSYSTEM_HANDOFF.md) · [Ativação editorial](ECOSYSTEM_ACTIVATION_04.md) · [Fluxos comerciais e GA4](COMMERCIAL_NEWSLETTER.md)

## Fase 3 · Saúde do Ecossistema

A área administrativa `/saude` consulta o último snapshot no D1. O botão Atualizar diagnóstico e o Cron de reconciliação existente podem gerar um novo snapshot a cada 30 minutos, com exclusão mútua. O Cron só coleta Saúde quando não processou tarefas na execução. Uma falha na montagem do snapshot preserva a última leitura e adia nova tentativa. O histórico guarda até 80 transições de 30 dias, com avisos no Jarvis que reutilizam a deduplicação, os limites e o descarte do canal atual.

Cada cartão indica a evidência disponível. Por exemplo, o HTTP público do Portfólio mede resposta e o recebimento HMAC tem indicador próprio. Um Radar sem novidades pode estar saudável. As durações de sondagem e de leitura D1 são tempo decorrido. As métricas CPU P50/P95/P99 vêm do GraphQL do Cloudflare e descrevem invocações observadas, com a unidade convertida de microssegundos.

Para habilitar em ambiente isolado, aplicar `0015_ecosystem_health.sql` e definir `ECOSYSTEM_HEALTH_ENABLED=true`. A leitura opcional de telemetria usa `HEALTH_CF_ACCOUNT_ID`, `HEALTH_CF_ANALYTICS_TOKEN` com **Account Analytics Read**, `HEALTH_CF_WORKER_NAME` e `HEALTH_CF_D1_ID`. Usar `HEALTH_CF_FREE_CONFIRMED=true` somente após confirmar a franquia da conta. Ajustar os limiares com `HEALTH_QUOTA_THRESHOLDS=70,85,95`. Métricas sem acesso, cobertura ou limite confirmado mostram Indisponível ou apenas o valor observado. Invocações amostradas não geram percentual faturável. A cota GA4 vem de `propertyQuota` de uma leitura recente. Search Console e Drive ainda carecem de fonte autorizada de consumo total do projeto. Armazenamento D1 mede o banco Lastro quando o dataset está acessível. O total da conta depende de cobertura validada.

[Métricas de D1](https://developers.cloudflare.com/d1/observability/metrics-analytics/) · [Telemetria Workers](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/observability/)

## Fase 4 · Pesquisa Orgânica

A seção em Analytics usa Search Analytics e uma conexão Google separada. Apresenta janelas de 7, 28 e 90 dias, período anterior equivalente, métricas agregadas retornadas pelo provedor, séries, páginas e consultas. Para páginas com impressões relevantes e CTR abaixo do agregado, cruza o caminho público com sessões e taxa de engajamento do Google orgânico no GA4 para as mesmas datas. A propriedade de domínio pode incluir subdomínios. O cruzamento só combina o hostname principal. Cliques e sessões têm definições diferentes, e uma associação não comprova causalidade.

O Jarvis lê os snapshots, sem chamar o Google. Exemplos de consultas incluem “Como está a pesquisa orgânica nos últimos 28 dias?” e “Qual a saúde do ecossistema?”. O Search Console usa atualização manual e cache de 24 horas por janela, com uma atualização em andamento por vez e backoff compartilhado de cota. O fluxo limita dimensões e linhas, guarda somente resultados agregados filtrados e preserva o último snapshot em falha.

Para homologar, aplicar `0016_search_console.sql` no D1 isolado e habilitar Search Console API em um cliente Google OAuth Web independente dos clientes de GA4 e Drive. Registrar o callback HTTPS `/api/analytics/search-console/oauth/callback` na origem exata definida em `ALLOWED_ORIGIN`. Definir `SEARCH_CONSOLE_ENABLED=true`, `SEARCH_CONSOLE_CLIENT_ID`, `SEARCH_CONSOLE_CLIENT_SECRET` e `SEARCH_CONSOLE_TOKEN_KEY`, uma chave de 32 bytes em base64url. O titular autoriza o escopo `webmasters.readonly` em Analytics. A aplicação usa `sites.list` para escolher uma propriedade autorizada do site principal, com preferência pelo prefixo HTTPS quando disponível, e cifra o refresh token no D1. A política Access futura do SSO precisa deixar o callback alcançar o Worker, onde state, PKCE e cookie nonce controlam o retorno.

[Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) · [Propriedades autorizadas](https://developers.google.com/webmaster-tools/v1/sites/list) · [OAuth Web](https://developers.google.com/identity/protocols/oauth2/web-server)

## Publicação, verificação e rollback

1. Confirmar plano e escopos de leitura, identificar versões implantadas e registrar baseline de CPU e D1. Usar bancos e credenciais de staging independentes. Fazer backup do destino autorizado antes das migrations aditivas.
2. Em staging autorizado, aplicar apenas as migrations pendentes, publicar a release validada com flags desligadas e conferir rotas privadas, públicas e de serviço. Ativar Saúde e Search Console separadamente. Exercitar snapshot, falha, retorno ao normal, consentimento, revogação e Jarvis.
3. Após autorização específica de produção, repetir o preflight, aplicar migrations aditivas antes de ativar as flags e medir o Radar em uma janela comparável. Homologar A, C e D somente com eventos elegíveis, ou com dados controlados autorizados. Aguardar uma newsletter marcada e tráfego observado para concluir a atribuição.
4. Se houver regressão, desligar a flag correspondente e restaurar a versão anterior do Worker. Manter as tabelas e os dados aditivos. Segredos e políticas de serviço permanecem independentes. Revogar o cliente OAuth do Search Console somente se necessário, sem interferir nos clientes Google existentes.

Esta rodada tem código e testes locais. Staging e produção aguardam autorização e configuração. As cotas desta rodada não foram medidas na conta. A coleta e a validação local não contrataram serviços novos.

Validação local da entrega com 188 testes de backend, TypeScript e builds em dry-run. No navegador, cinco cenários com fixtures cobriram Saúde e Pesquisa Orgânica em mobile, Oficina → Studio e Radar 2. Outros sete cenários exercitaram Radar 2 com sessão e D1 locais. O teste do Search Console cobre consentimento simulado, replay do callback, isolamento de credenciais, comparação com GA4 de teste, cache, backoff e revogação. Os testes de integração local executaram handlers de Lastro, Studio e CRM com bancos separados.
