# Resumos automáticos do For You

Na coleta RSS, `generateFeedSummary` prepara um texto de até 420 caracteres antes de salvar o candidato. Uma descrição útil da fonte tem prioridade. Quando ela falta ou repete o título, o algoritmo seleciona até duas frases do corpo disponível no feed, considerando posição e palavras do título. Imagens, legendas e chamadas de assinatura são descartadas. O texto integral não é salvo e não há chamada a modelos de IA.

`summaryAllowed` habilita a exibição; `feedTextSummaryAllowed` permite também a extração do corpo do RSS. Restrições explícitas do item continuam prevalecendo. Essa opção de produto não altera as permissões separadas de sinopses por IA nem declara uma licença do editor.

O resumo é persistido em `contents.metadata_json.description`. Recoletas atualizam também referências já conhecidas, sem renovar a data de descoberta, a publicação ou a expiração, nem alterar favoritos, notas ou seleções. O For You e a busca editorial verificam a disponibilidade do resumo antes da paginação. A janela científica permanece independente. Se o feed não oferece nenhum texto aproveitável, o sistema não inventa um resumo e a referência editorial não é liberada no feed.

## Atualização das referências existentes

`scripts/prepare-feed-summaries.ts` lê `.wrangler/summary-rollout/sources.json`, uma exportação JSON do Wrangler com `id,name,connector,url,config_json,created_at` das fontes RSS aprovadas. Busca as sete fontes selecionadas e produz `apply.sql` e `report.json` no mesmo diretório. O script somente prepara os arquivos: não escreve no banco remoto.

O SQL habilita as duas opções somente se a configuração da fonte ainda corresponde à exportação e preenche os resumos pelas URLs canônicas. Uma cópia do banco deve ser usada para conferir o efeito antes da aplicação. Os triggers existentes mantêm o histórico e invalidam sinopses antigas quando as permissões ou os metadados mudam.

## Validação em 10/11/2026

- 100 resumos preparados em sete feeds reais; ensaio da atualização preencheu 35 referências já existentes.
- Typecheck do servidor e da interface, build e empacotamento de produção passaram.
- Testes de extração, ingestão antes da publicação, atualização idempotente, preservação de favoritos e sete testes integrados de interface passaram.
- A suíte geral inicial teve 196 sucessos e duas falhas em `tests/sustainable-curation.test.ts`. Ambas foram reproduzidas também no commit anterior `bca3a75`, em uma cópia isolada: a expectativa de bloquear “brand refresh” e a expectativa de sinopse `validated` que recebe `idle`. Não foram alteradas as regras de curadoria para contornar essas falhas.
