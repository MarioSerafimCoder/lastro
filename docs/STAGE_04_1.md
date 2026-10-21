# Etapa 04.1 — Radar Vivo

Implementação e publicação em 21/10/2026, a partir de `master` no commit `90db1e4`. Este relatório distingue a capacidade implementada da quantidade de conteúdo realmente aprovada. A configuração de produção continua com `INGEST_ENABLED=false` até a confirmação da rotação da credencial e das sessões, exigida pelo escopo desta etapa.

## Situação verificada

Uma consulta **somente de leitura** ao D1 remoto encontrou uma fonte aprovada (A List Apart), dois conteúdos aprovados e 18 entradas na fila. Não havia oito fontes ativas nem 12–24 cards reais em produção. A fila existente é preservada pela migração. A interface já pagina 12, 24 e 100 referências em testes isolados; o volume real depende de revisão editorial.

## Implementação

- O cron técnico passa de 15 para **5 minutos**. Cada disparo escolhe uma fonte, com até **dois candidatos**; `INGEST_BATCH_SIZE=1` permite reduzir o lote sem alterar código. A fonte menos recentemente processada tem prioridade, evitando monopolização da fila. O cron não realiza nenhuma coleta se `INGEST_ENABLED` não for `true`.
- Fontes RSS seguem ciclo **diário em UTC**, respeitando também `intervalMinutes` com piso de 1.440 minutos. Fontes OpenAlex seguem **mês-calendário em UTC**. O ciclo concluído fica no D1. Uma fila iniciada no mês anterior continua sem repetir a descoberta daquele mês; um novo mês pode iniciar outra rodada após a fila esvaziar. Um intervalo fixo de 30 dias não é usado.
- O lease de cinco minutos impede processamento simultâneo da mesma fonte. Uma execução interrompida é marcada como tal após o lease expirar. A fila persiste até o registro de cada candidato; uma repetição após interrupção usa a deduplicação existente. Uma falha retém os itens e aplica backoff exponencial de 15 minutos até 24 horas, respeitando `Retry-After` quando informado. Erros 403 e 429 ficam registrados.
- A migração `0004_radar_cycles.sql` adiciona estado operacional, índice de consultas e identificação do ciclo na execução. É aditiva; favoritos, notas, seleção, conteúdos e decisões não são recriados. O endpoint autenticado `GET /api/radar/status?since=<ISO-8601>` expõe última tentativa e sucesso, próxima descoberta quando ativada, fila, contagens por fonte, falhas e novas aprovações humanas desde uma data fornecida. Sem data, a quantidade “nova” é `null`, evitando simular uma última visita. Fonte pausada, não autorizada, indisponível, com fila, sem novidades e com erro têm estados separados.
- A triagem temática usa palavras inteiras no título e tópicos da fonte, com uma lista pequena de sinônimos explícitos. Uma menção casual no resumo não aprova um assunto. A suspeita de título igual na mesma fonte fica anotada no candidato; conteúdos distintos não são fundidos automaticamente. Em Atom, `updated` não se torna data de publicação. OpenAlex continua sempre sujeito a revisão humana, mesmo que a configuração de uma fonte tenha `autoApprove:true` por engano.
- Ranking, snapshots do feed, favoritos, notas, histórico e endpoints existentes permanecem operantes. Referências antigas aprovadas continuam elegíveis e preservam a data original. O piso de qualidade não foi reduzido; a ordenação já aplica penalidade por repetição de temas/fontes.

## Fontes revalidadas

As oito configurações de `examples/catalog/` foram consultadas em 21/10/2026 e processadas em um **D1 efêmero**. O arquivo [de evidência](examples/stage04-1-source-checks.json) registra HTTP, duração, execuções e resultados por fonte; não contém texto integral ou credenciais. Todas responderam 200, sem redirecionamento. O conector leu somente metadados de RSS/Atom e OpenAlex. HTTP 200 prova acesso técnico, não aprovação editorial ou permissão de reprodução. Os registros de teste não foram enviados ao D1 pessoal ou remoto.

| Fonte                   | Recebidos | Pendentes para revisão | Rejeitados | Aprovados automaticamente |
| ----------------------- | --------: | ---------------------: | ---------: | ------------------------: |
| Smashing Magazine       |        25 |                      7 |         18 |                         0 |
| A List Apart            |        20 |                     12 |          8 |                         0 |
| Typographica            |        25 |                     21 |          4 |                         0 |
| Creative Boom           |        20 |                      9 |         11 |                         0 |
| It's Nice That          |        20 |                      5 |         15 |                         0 |
| Journal of Vision       |        25 |                     25 |          0 |                         0 |
| Design Studies          |        25 |                     23 |          2 |                         0 |
| Frontiers in Psychology |        25 |                      7 |         18 |                         0 |
| **Total**               |   **185** |                **109** |     **76** |                     **0** |

O ruído do Frontiers e as rejeições editoriais elevadas mostram que a relevância heurística ainda precisa de calibração com revisão humana. Não foram ativadas as sete fontes novas; seus JSONs continuam propostas individuais com `autoApprove:false` e resumos desativados. A List Apart já existe em produção e não será duplicada. O domínio FeedBurner de It's Nice That, Typographica e Creative Boom ainda precisam de inclusão explícita na allowlist de produção, somente após decisão sobre cada fonte. O conector proíbe redirects e não contorna 403, 429 ou paywalls.

## Capacidade e custos

Com a amostra atual, cinco RSS exigem **56** invocações e três consultas acadêmicas **39**, total **95** para a carga inicial. A cada 15 minutos seriam 23h45 se toda a carga chegasse junta, sem margem adequada; em cinco minutos o tempo ideal cai para **7h55**. Existem 288 janelas de cron por dia, deixando 193 para falhas, atrasos e novas entradas nessa hipótese. Esse cálculo supõe que cada disparo ocorra e processe dois itens; não é garantia de latência, especialmente com falhas, fontes pausadas ou variação de volume. A janela de descoberta continua limitada aos 25 metadados mais recentes por fonte; publicações acima desse ritmo podem escapar à cobertura.

O teste contou **43 instruções D1** na primeira invocação com dois candidatos e **39** na continuação, mais duas instruções de limpeza no cron e uma para selecionar a fonte. O teto testado para ingestão é 47 instruções, reservando três para o cron frente ao limite documentado de **50 consultas por invocação no Workers Free**. Erros e metadados com muitos autores/identificadores podem alterar linhas lidas e escritas; acompanhar a telemetria real da conta antes de aumentar o lote. O cron de cinco minutos representa até **288 invocações/dia** ou **8.640 em 30 dias**, se todos os disparos ocorrerem. Em um dia com a carga inicial, o teto conservador é 95×47 + 193×3 = **5.044 instruções D1**; a carga real medida no teste é menor. Requisições externas: até oito na primeira descoberta, depois aproximadamente cinco RSS por dia e três consultas OpenAlex por mês, com chamadas extras controladas por retentativas. Não foram medidos CPU, bytes transferidos ou linhas faturáveis no plano real. Confirmar limites e consumo atuais no painel antes da ativação: [limites D1](https://developers.cloudflare.com/d1/platform/limits/), [preços D1](https://developers.cloudflare.com/d1/platform/pricing/) e [limites Workers](https://developers.cloudflare.com/workers/platform/limits/). Não há serviço pago novo.

## Validação

- `npm run verify`: 34 testes de regras/API, tipagem da API e interface, build do frontend e Worker em dry-run.
- `npm run test:ui`: 19 testes funcionais aprovados; um teste opcional de gravação da Etapa 04.3 foi omitido por não estar habilitado.
- `npm run format:check`: aprovado.
- Testes novos cobrem calendário de 28/29/30/31 dias, virada de ano e fuso; ciclo diário e mensal; HTTP 304, 403 e 429; Retry-After; concorrência; recuperação após lease e interrupção entre salvar e registrar; fila sem nova descoberta; fontes equilibradas; desligamento; migração preservando favoritos, conteúdo e decisões; relevância por palavras; interface do status autenticada; ranking com 2/12/24/100 itens e repertório antigo.
- A migração local foi aplicada após backup privado em `.wrangler/before-stage041.sql`. Os testes usaram bancos Miniflare independentes. Nenhuma fonte de teste foi adicionada ao banco pessoal.
- Antes da migração remota, o D1 foi exportado para `.wrangler/stage041-remote-backup.sql` (70.197 bytes), ignorado pelo Git. A migração `0004` foi aplicada remotamente, seguida pelo deploy do Worker `89ac897d-fea3-436d-98b0-1cdfe879d316`. O site e `/health` responderam 200; `/api/radar/status` sem sessão respondeu 401. A consulta de leitura posterior confirmou 1 fonte, 2 aprovados, 18 itens na fila e as novas colunas no D1. A coleta automática segue desligada.

## Ativação gradual e reversão

1. Antes de ativar coleta automática, o proprietário confirma a rotação da senha de produção e da chave de sessões devido à exposição anterior citada no briefing. Esta entrega mantém a chave fora do Git e não a lê nem a mostra.
2. Após aprovação editorial individual, cadastrar fontes do catálogo como pendentes, verificar direitos e host exato, aprovar uma de cada vez com justificativa. Começar por uma editorial, monitorar candidatos e filas, depois ampliar as demais. Ciência exige revisão humana de cada estudo. Nunca ativar `autoApprove` nesta etapa.
3. Medir consultas, linhas lidas/escritas, CPU, erros e tempo de esvaziamento no painel. Confirmar cotas e plano vigente. Só então alterar `INGEST_ENABLED` para `true` em produção e publicar com autorização expressa. Cron de cinco minutos serve apenas como mecanismo técnico; descobertas respeitam os ciclos persistidos.
4. Para parar imediatamente, republicar com `INGEST_ENABLED=false`; leitura dos conteúdos aprovados permanece disponível. Pausar uma fonte interrompe sua coleta e a retira do índice, preservando seus registros. Em falha de código, retornar ao Worker anterior; a migração aditiva é tolerada pelo código anterior. Não reverter SQL apagando colunas ou dados.

Antes de qualquer mudança no D1 remoto, exportar backup privado com `wrangler d1 export DB --remote --config wrangler.production.jsonc --output <caminho-privado>`. Conferir a saída e guardar fora do Git. Migração remota necessária: `0004_radar_cycles.sql`. Após migração e deploy, conferir `/health`, login, `GET /api/radar/status`, feed protegido e estado da fila. **Não executar migração ou deploy apenas a partir deste documento**; a autorização para a publicação do código foi dada na conversa e a coleta seguirá desligada.

## Limitações e sequência

A classificação contextual por IA permanece para a Etapa 04.2. A correspondência determinística não substitui leitura dos artigos ou estudos. Não há aprovação automática de papers, envio de notificações, texto integral ou imagens. As contagens de “novas aprovações” requerem que a aplicação informe explicitamente uma data `since`; o backend não adivinha a última visita. As contagens por fonte são cumulativas ou atuais conforme o campo, não promessas de material novo. Ainda é necessário revisar candidatos reais e autorizar a ativação; portanto a meta de 12–24 cards **não está atendida em produção**.

Arquivos criados: `src/schedule.ts`, `src/radar.ts`, `migrations/0004_radar_cycles.sql`, `scripts/radar-check.ts`, `tests/radar.test.ts`, este relatório e a evidência JSON. Arquivos alterados: `src/ingestion.ts`, `src/connectors.ts`, `src/quality.ts`, `src/db.ts`, `src/env.ts`, `src/index.ts`, contratos compartilhados, `tests/api.test.ts`, configurações Wrangler e documentação operacional. Branch: `master`. Commit final: informado na entrega e registrado no GitHub após o push.
