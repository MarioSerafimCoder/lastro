# Sinopses editoriais — 23/10/2026

O For You e a busca do acervo exigem sinopse validada. A aprovação editorial dos metadados continua usando a política existente, mas não basta para publicar no feed. Favoritos, seleção, notas, leitura e decisões anteriores são preservados.

Ampliação posterior: [relatório de 24/10/2026](SINOPSES-AMPLIACAO-2026-10-24.md), com 16 referências e fontes licenciadas.

Auditoria de autonomia: [correções e validação de 24/10/2026](AUTONOMIA-SINOPSES.md).

## Geração e confiabilidade

- Migração aditiva `0005_editorial_synopses.sql`: texto, procedência, versão do gerador, estado, tentativas, reserva diária e decisões editoriais no D1. Não remove conteúdos.
- Fila: `pending → processing → validated` quando todas as verificações passam; incertezas seguem para `review`. Evidência insuficiente ou sem autorização fica `blocked`; falhas ficam `failed`, sem nova inferência silenciosa. A migração aditiva `0006_synopsis_verification.sql` registra verificações, consumo por chamada e execução do agendador.
- O coletor usa descrições do feed apenas com `synopsisAllowed` e justificativa de permissão registrada; `summaryAllowed` continua controlando reprodução de resumos originais. Acesso público não é tratado como licença. Não extrai corpos de artigos ou abstracts científicos sem autorização.
- Notas factuais originais, verificadas por um editor na fonte indicada, podem ser fornecidas em Curadoria → Sinopses. O texto enviado ao modelo inclui título, autoria, fonte, data e tipo, além dessa evidência.
- Cada entrada gera uma vez. Leituras do feed consultam apenas o resultado persistido. Reenviar evidência idêntica é idempotente; evidência ou metadados alterados exigem nova revisão. Leases isolam processamentos concorrentes.
- Verificações determinísticas cobrem extensão de 35–60 palavras, entrada além do título, texto simples, números sem apoio e sobreposição literal. Alegações fortes de eficácia, comprovação e sucesso seguem para revisão. Um segundo modelo, independente do gerador, verifica cada frase contra a evidência e retorna trechos de suporte no idioma original. O código exige cobertura de todas as frases, ausência de incerteza e correspondência literal de cada trecho à evidência. Respostas inválidas, trechos inventados ou autocitações do próprio rascunho não publicam.
- Publicação automática exige ainda metadados de autoria/data, fonte aprovada com coleta autorizada e `autoApprove`, além de permissão específica de processamento ou notas próprias autorizadas. A permissão é configurada por fonte, não a cada artigo. As verificações reduzem risco, mas modelos não constituem prova infalível de veracidade. Estudos científicos continuam exigindo revisão editorial e não têm aprovação automática habilitada.
- Sinopses revisadas usam o campo próprio `synopsis` da API; não se passam por abstracts dos autores. Cards mostram três linhas, expansão acessível, autoria, data, fonte e link original.

## Plano gratuito e operação

Gerador `@cf/meta/llama-3.2-3b-instruct` e verificador `@cf/meta/llama-3.1-8b-instruct-fp8-fast`, Workers AI via binding `AI`; nenhuma API externa paga. A franquia publicada é de 10.000 neurônios/dia, compartilhada pela conta e reiniciada à meia-noite UTC. No plano Free, exceder a franquia interrompe a operação; não foi feito upgrade.

O LASTRO reserva 300 neurônios antes de um ciclo automático (geração + verificação), ou 150 para um rascunho que já exige revisão. Limite atômico de 4.500/dia: até 15 ciclos completos, com retomada de pendentes no próximo dia UTC. Cada entrada tem até 12 KB; saídas limitadas a 220 tokens para geração e 1.000 para verificação. A reserva é conservadora, não leitura de faturamento. Quota/429 bloqueia novas chamadas pelo restante do dia; falha de verificação preserva o rascunho na Curadoria. Falhas não regeneram silenciosamente o texto. Outros aplicativos podem usar a mesma franquia; a proteção final é o limite do provedor no plano gratuito.

Cada chamada registra tokens e `usage.neurons` retornados pela Cloudflare. O cálculo pelas taxas publicadas é armazenado separadamente como estimativa alternativa. Se o provedor omitir a medição, ela permanece ausente, nunca é inventada. Oito gerações anteriores à instrumentação têm apenas medição agregada no painel da conta.

O cron de ingestão `*/5 * * * *` permanece intacto, assim como sua aprovação automática. O cron de sinopses `2-57/5 * * * *` processa uma referência por invocação separada para não somar consultas ao limite D1 da ingestão. `SYNOPSIS_ENABLED=false` interrompe geração, sem liberar artigos sem sinopse. `SYNOPSIS_REQUIRED=true` mantém a barreira no feed, inclusive em páginas de cursores antigos. Em desenvolvimento, a geração fica desligada para não consumir IA por acidente.

Documentação oficial consultada: [preços e franquia](https://developers.cloudflare.com/workers-ai/platform/pricing/) e [modelo Llama 3.2 3B](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/).

## Primeira publicação

Backup D1 realizado antes da migração, fora do Git: `Lastro-backups/lastro-before-synopses-20261023-151322.sql` (737.445 bytes). A primeira publicação manteve a barreira desligada somente durante o enriquecimento. Auditoria inicial: 46 referências aprovadas, nenhuma descrição armazenada. Oito inferências executadas; todos os rascunhos foram conferidos e reescritos editorialmente antes da validação. Foram removidas avaliações de sucesso/inovação não sustentadas, redundâncias e detalhes dispensáveis. Os rascunhos anteriores permanecem no histórico de decisões.

| Fonte             | Conteúdo validado                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Plau — Entrelinha | [Fontes brasileiras, para o mundo](https://plau.substack.com/p/fontes-brasileiras-para-o-mundo)                                          |
| Plau — Entrelinha | [Como as fontes trabalham pelo seu dinheiro](https://plau.substack.com/p/como-as-fontes-trabalham-pelo-seu-dinheiro)                     |
| Plau — Entrelinha | [O futuro da tipografia como negócio](https://plau.substack.com/p/o-futuro-da-tipografia-como-negocio)                                   |
| Plau — Entrelinha | [Emojis e tipografia](https://plau.substack.com/p/emojis-e-tipografia-uma-historia)                                                      |
| A List Apart      | [Design Dialects](https://alistapart.com/article/design-dialects-breaking-the-rules-not-the-system/)                                     |
| A List Apart      | [An Holistic Framework for Shared Design Leadership](https://alistapart.com/article/an-holistic-framework-for-shared-design-leadership/) |
| A List Apart      | [Good designers, bad websites: a proposal](https://alistapart.com/article/good-designers-bad-websites-a-proposal/)                       |
| A List Apart      | [Design for Amiability: Lessons from Vienna](https://alistapart.com/article/design-for-amiability-lessons-from-vienna/)                  |

Impacto antes da ativação: 8 prontas, 4 PT e 4 EN, mantendo distribuição 50/50; 38 referências aprovadas continuam preservadas e aguardam evidência/revisão, incluindo os estudos científicos. Não foi inferido conteúdo científico a partir de títulos. As permissões amplas de processamento das fontes existentes não foram habilitadas: esta primeira leva usa notas factuais próprias, sem enviar artigos integrais à IA. A continuidade automática depende de descrições autorizadas ou novas evidências editoriais; o sistema não fabrica resumos para completar a grade.

Consumo real da primeira leva confirmado no painel Cloudflare: **40,16 neurônios / 8 gerações = média de 5,02**. A reserva preventiva era de 1.200. No teste isolado com os modelos reais, o ciclo automático bem-sucedido usou **3,901009 na geração + 5,725921 na verificação = 9,626930 neurônios**. Esses valores variam com o tamanho dos textos; não são tarifa fixa. O teste não inseriu conteúdos sintéticos em produção. Uma versão com alegação inventada de eficácia foi rejeitada. Um texto correto cujo parecer trouxe trechos não encontrados também foi retido, preservando o critério conservador.

Validação automatizada cobre acervo, favoritos, ranking, 50/50, autenticação, idioma inglês, estudos científicos, título insuficiente, limites concorrentes, quota, cache, idempotência e invalidação de evidência. `npm run verify` executa testes, verificações de tipos e build. Verificação de produção e inspeção responsiva são realizadas após a ativação da barreira.

Aplicação: https://lastro.marioserafim.com.br/ — Curadoria → Sinopses permite acompanhar pendências, consumo reservado, procedência e validações.

## Validação final da implantação

- Backup adicional antes da migração 0006: `Lastro-backups/lastro-before-synopsis-verification-20261023-201853.sql` (875.639 bytes), fora do Git.
- `npm run verify`: 54 testes aprovados, verificações de tipos e build concluídos.
- Worker publicado: `ac004df3-f32a-4efa-98d5-7f61c2500ca2`.
- Execução automática confirmada no D1 em 23/10/2026, 23:22:37–23:22:38 UTC (20h22 em Brasília), estado `idle`: não havia item elegível pendente. Nenhuma chamada manual disparou esse registro.
- API de produção: 8 cards com sinopse validada de 35–60 palavras, 4 PT e 4 EN; 38 itens bloqueados preservados, total de 46. Consultas repetidas não aumentaram chamadas de IA. Favoritos, seleção, coleções e busca responderam; acesso sem autenticação recebeu 401.
- Interface: expansão da sinopse conferida; viewport de 390 px sem transbordamento horizontal. Os modelos reais aprovaram um ciclo elegível e recusaram a alegação inventada no teste isolado.
