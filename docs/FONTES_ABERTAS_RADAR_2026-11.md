# Fontes com licença aberta — Lastro

Atualização aplicada ao D1 de produção em 17/11/2026, com os domínios acrescentados ao binding `ALLOWED_FETCH_HOSTS` do Worker `lastro-api`. A configuração equivalente de hosts está em `wrangler.production.jsonc` nesta branch.

## Fontes ativas adicionadas

| Fonte | RSS | Licença editorial padrão | Verificação |
|---|---|---|---|
| Electronic Frontier Foundation | https://www.eff.org/rss/updates.xml | CC BY 4.0 para material original | https://www.eff.org/copyright |
| Wikimedia Diff | https://diff.wikimedia.org/feed/ | CC BY-SA 4.0, salvo exceções | https://diff.wikimedia.org/ e https://diff.wikimedia.org/2020/12/09/diff-delivered-how-to-subscribe-to-diff-updates/ |
| Open Knowledge Foundation | https://blog.okfn.org/feed/ | CC BY 4.0, salvo exceções | https://blog.okfn.org/ |
| PLOS Blogs | https://theplosblog.plos.org/feed/ | CC BY 4.0 por padrão, com exceções | https://plos.org/blogs/about/ |
| LSE Impact | https://blogs.lse.ac.uk/impactofsocialsciences/feed/ | CC BY 4.0 por padrão, com exceções | https://blogs.lse.ac.uk/republishing-policy/ |

A fonte já existente **Design in government** (https://designnotes.blog.gov.uk/feed/) foi reativada, com OGL v3.0. **ARTnews, Hyperallergic e Colossal** foram pausadas (não removidas do histórico).

## Direitos e filtragem

- Capturar apenas trechos textuais permitidos pelo feed, sem imagens, sem fazer download integral de páginas protegidas. Conferir licenças individuais e material de terceiros.
- Atribuir autor, título, fonte, URL e licença; indicar adaptação quando aplicável. Obras CC BY-SA requerem respeitar compartilhamento pela mesma licença para materiais derivados; um texto original independente sobre fatos não necessariamente constitui adaptação.
- O Radar avalia relevância, idioma, qualidade, recência e aprovação. O autopiloto exige evidências textuais com permissão válida; não basta cadastrar fontes.
- O Google Trends BR **já** é consultado por `src/google-trends.ts` como sinal de tendência, não como evidência. A ampliação para US requer alteração de código e testes.
- A licença geral do site não cobre automaticamente imagens, tabelas ou textos de terceiros.
- O projeto permanece com as salvaguardas de 3 fontes independentes, autorização de processamento e verificação de citações; o envio diário não foi homologado com as novas fontes.

## Próxima validação necessária

1. Confirmar resultados de coleta dos 5 RSS pela rota `/api/admin/sources` ou tabela `ingestion_runs`, incluindo `fetch_host_not_allowed`, HTTP, redirects e erro XML.
2. Consultar `/api/editorial-autopilot/eligibility` e verificar **referências elegíveis**, **publicações** e a simulação `selection`. Caso as descrições sejam curtas, o autopiloto não terá texto suficiente, mesmo com licença aberta.
3. Só então executar manualmente, conferir conteúdo/atribuições no Studio e observar a entrega diária de 08:00 Fortaleza.
4. O branch principal `main` ainda não contém `codex/editorial-autopilot`. Não implantar `main` isoladamente para não sobrescrever o Worker com funcionalidade faltando.
