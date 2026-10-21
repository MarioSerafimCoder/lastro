# Etapa 03 — Radar Vivo

Implementação e validação local em 21/10/2026. A publicação em produção depende de autorização específica do proprietário, conforme o pedido desta etapa. Código preparado para o mesmo Worker, D1 e login privado por senha.

## Diagnóstico de produção

Consultas remotas de leitura e chamadas autenticadas confirmaram: **0 fontes, 0 candidatos, 0 conteúdos aprovados e 0 execuções**. As listagens administrativas responderam 200, vazias, com autenticação e 401 sem autenticação. `INGEST_ENABLED=false`. Portanto o estado vazio do Radar era correto: a produção não recebeu as fontes e conteúdos do ambiente local.

O ambiente local já continha fontes e quatro artigos Smashing aprovados em validações anteriores. Esses dados não foram copiados para o D1 remoto. Credenciais continuam fora do Git. O login, as autorizações e a política de qualidade não foram flexibilizados.

## Entrega

- Área privada **Curadoria**, com Fontes, Fila de revisão e Histórico, integrada à navegação e identidade visual existentes.
- Cadastro/edição, aprovação, pausa e rejeição de fontes com justificativa. Edição volta a exigir aprovação. Coleta manual respeita intervalo, autorização e fila persistida.
- Estado do agendamento, domínios permitidos, última execução, próxima coleta, erros e paginação.
- Candidatos com origem, autoria, data, formato, endereço original, pontuação, motivos, licença e limitações. Correções de título, URL, autores, data e idioma; aprovação/rejeição justificadas. Pesquisas recebem aviso de revisão humana.
- Histórico paginado de coletas e decisões. A migração `0003` acrescenta a quantidade recebida por chamada; execuções antigas mantêm `null` e mostram “não registrado”. Continuação de fila recebe zero itens externos. Contagens da execução registram a decisão **na ingestão**; decisões humanas posteriores aparecem no histórico editorial e no estado atual do candidato.
- Contratos compartilhados para a administração; novas leituras `/admin/overview` e `/admin/decisions`. A pontuação da fila é recalculada pela política atual, não uma nota científica ou reprodução da avaliação humana histórica.
- Retorno ao For You recarrega as referências aprovadas. Falha de ingestão aparece como aviso distinto do estado vazio.
- Correções parciais preservam campos omitidos: corrigido comportamento em que defaults do contrato podiam apagar título/URL ao corrigir somente autoria. Teste de regressão incluído.

## Fontes verificadas

Smashing Magazine, A List Apart, Typographica, Creative Boom e It's Nice That via RSS; Journal of Vision, Design Studies e Frontiers in Psychology via OpenAlex, com IDs de periódicos conferidos. O [catálogo](SOURCES.md) registra evidências, direitos, idiomas, assuntos, frequência e três sugestões ainda sem integração confirmada. Todas as configurações mantêm aprovação humana e resumos desativados.

## Ingestão real local

Fonte: A List Apart, feed oficial. Duas invocações, com duas entradas processadas por chamada:

| Medida                                            | Resultado |
| ------------------------------------------------- | --------: |
| Entradas recebidas no lote inicial                |        20 |
| Processadas                                       |         4 |
| Aprovadas automaticamente                         |         0 |
| Aprovadas após conferência manual de demonstração |         2 |
| Processadas ainda pendentes                       |         2 |
| Aguardando processamento na fila persistida       |        16 |
| Rejeitadas / duplicadas / erros nesse ciclo real  | 0 / 0 / 0 |

As 20 entradas resultam das duas processadas na primeira execução e das 18 restantes persistidas; a segunda execução consumiu outras duas sem nova consulta ao feed. A migração de contagem recebida foi acrescentada depois desse ciclo, sem preencher retroativamente dados desconhecidos. Evidência: [relatório real](examples/stage03-live-check.json).

Artigos aprovados somente no ambiente local:

1. [Good designers, bad websites: a proposal](https://alistapart.com/article/good-designers-bad-websites-a-proposal/) — Alan Dalton, 23/04/2026.
2. [Designed for a Dead Language](https://alistapart.com/article/designed-for-a-dead-language/) — Shrey Shah, 30/06/2026.

Título, autoria, data, idioma e pertinência foram conferidos nas páginas originais. A autoria literal `by` do feed foi corrigida. São referências editoriais: não houve auditoria integral nem comprovação científica. Não foram criados resumos. Os dois artigos seguintes ficaram pendentes e os 16 restantes não foram aprovados por antecipação.

O ciclo confirmou feed, filtros por fonte/assunto/formato/idioma, favoritos, seleção e prompt na Oficina contendo os dois autores. Favoritos e seleção anteriores foram restaurados. O pacote e o histórico de demonstração permanecem locais. Total local aprovado após a demonstração: seis artigos, contando os quatro anteriores.

## Verificação e reprodução

`npm run verify` passou: tipagem da API/interface, **21 testes** e build sem deploy. `npm run format:check` também passou. A suíte cobre autenticação, cadastro/aprovação de fontes, revisão/rejeição, deduplicação, visibilidade, limites, falhas externas, retomada e preservação das correções parciais. Novos testes conferem histórico paginado, avaliação dos candidatos e contagem recebida versus retomada. Não depende da internet nem usa o banco pessoal.

A interface local foi conferida no navegador: navegação das três seções, formulário de edição preenchido e cancelamento, campos de correção, avisos científicos, histórico e contagens. A inspeção visual em largura estreita confirmou a leitura dos cartões e controles. As mutações do ciclo real foram verificadas pela API; essa inspeção visual não equivale a uma suíte automatizada completa de interface.

Para repetir a demonstração real, com servidor local e migrações aplicadas: `node scripts/stage03-check.mjs`. **É opt-in e altera o banco local**: registra/aprova A List Apart, revisa somente os dois URLs conferidos, continua uma rodada de fila e gera pacote/prompt. Em nova execução pode consumir outro lote e substituir o relatório. Se os dois artigos já não estiverem no lote recente, interrompe sem escolher substitutos. Não aponta para produção. A suíte determinística é a base de regressão; essa demonstração externa depende da disponibilidade e conteúdo atual do feed.

## Ativação pendente

Seguir o [procedimento operacional](OPERATIONS.md#ativação-da-etapa-03). Escopo proposto para autorização: aplicar migração 0003, publicar Curadoria, permitir o domínio A List Apart, cadastrar/aprovar apenas essa fonte, executar a coleta manual e revisar os dois artigos conferidos se ainda disponíveis. Manter coleta automática desativada. Aprovar outras fontes ou habilitar agendamento exige decisão posterior do proprietário.

Limitações: revisão de demonstração não valida ciência; correspondência temática é textual; somente primeira página recente é coletada; dados antigos não têm contagem de recebidos; a interface não cobre todas as anotações avançadas da API. Nenhum deploy, migração remota, aprovação remota ou habilitação de cron foi executado nesta etapa sem essa autorização.
