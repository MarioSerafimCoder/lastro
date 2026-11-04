# Radar Editorial 2.0 — Fase 01

Branch `codex/radar-2-engine`, baseada em `19ca4f6`. Entrega de código e ensaios locais: **sem deploy, migration remota ou ativação de fontes**. Brain/Drive, CRM, Studio, bindings, planos e Crons de produção preservados. Nenhuma dependência instalada.

## Diagnóstico real — 04/11/2026

Exportação D1 somente leitura às 17:21:59 UTC: 148 referências, 82 aprovadas, 65 pendentes; 16 sinopses validadas (8 PT/8 EN), nenhuma com publicação nesta semana. Havia 11 artigos publicados na semana e 40 entradas na fila. Sinopses: 66 pendentes, 57 bloqueadas por direitos, 8 em revisão editorial e 1 técnica.

As causas eram a exigência de sinopse no feed, descarte de excedentes linguísticos, ranking de 180 dias/evergreen e confusão entre validação e publicação. Coletas bem-sucedidas não significavam descoberta: várias fontes eram consultadas diariamente sem referência nova desde outubro. Histórico: 4 falhas HTTP 429, 1 HTTP 503 e 1 falha genérica; o esquema antigo não permite atribuir cada execução ao Cron. Detalhes por fonte em [radar2-production-audit.json](radar2-production-audit.json).

## Comportamento e contrato para o Sol

`GET /api/feed` preservado; contratos únicos em `packages/contracts/radar.ts`, exportados pelo pacote existente. `scope=editorial` entrega apenas a semana civil de segunda a domingo em `America/Fortaleza`; `scientific` preserva os critérios científicos; padrão `all` mantém compatibilidade com o frontend atual. Sem preenchimento com artigos antigos.

Filtros: `country` ISO2, `category`, `sourceId`, `language`, `after`/`before` inclusivos em datas civis, `sort=novidade|relevancia`, `triage=novidade|para_avaliar|favorito|descartado`. Categorias e pesos estão no contrato. Metadados aprovados aparecem sem IA; descrição/imagem exigem autorização, sinopse exige também validação. `publishedAt`, `radar.firstSeenAt`, `approvedAt`, `expiresAt` e `level` distinguem os estados. Triagem deriva dos estados existentes, sem tabela duplicada.

Resposta inclui semana, timezone, filtros e cursor por snapshot de 30 minutos, até 500 candidatos. Cursor não atravessa mudança de semana/filtros; revalida permissões, qualidade, estado e expiração. Favoritos antigos continuam em `/api/favorites`, sem ampliar a janela semanal. `/api/search` segue a janela editorial para artigos. Ranking diário usa publicação, tema, fonte, diversidade e afinidade; idiomas excedentes são preservados. O frontend desta fase não foi redesenhado.

`GET /api/radar/status` expõe saúde, descoberta efetiva, fila, bloqueios, visibilidade, expiração, rejeições e heartbeat do agendador. `stale_over_48h` e `collection_failed` ficam disponíveis ao Jarvis, sem notificações/IA. Fontes científicas respeitam sua rodada bimestral, evitando alerta diário falso.

## Fontes conferidas individualmente

As URLs e condições estão em [radar2-catalog.json](../examples/radar2-catalog.json); observações HTTP, datas, autoria e condicionais em [radar2-source-validation.json](radar2-source-validation.json). Feeds oficiais foram conferidos nos sites das publicações. Nenhum HTTP 429 foi provocado; backoff e recuperação são testados sinteticamente. HTTP 200 não comprova licença para reproduzir conteúdo.

| Fonte / país                 | Feed e condicional observados                | Decisão                                     |
| ---------------------------- | -------------------------------------------- | ------------------------------------------- |
| Colossal / EUA               | `/feed/`, 200/304; 6 itens na semana         | Metadados                                   |
| Hyperallergic / EUA          | `/rss/`, 200/304; 15 na semana               | Metadados; publicidade rejeitada            |
| ARTnews / EUA                | `/feed/rss/` → 301 → `/feed/`, 200/304       | URL canônica, metadados                     |
| It’s Nice That / Reino Unido | FeedBurner oficial HTTPS, 200/200            | Preservar fonte; metadados                  |
| Creative Boom / Reino Unido  | `/feed/`, 200; sem validadores               | Preservar fonte; metadados                  |
| étapes: / França             | `/feed/`, 200/200; última 27/10              | Metadados; não preencher semana com antigos |
| ARTE!Brasileiros / Brasil    | `/feed/`, 200/304; última 31/10              | Metadados; sem novidade na semana           |
| designboom / Itália          | `/feed/`, 200/200; 10 na semana              | Metadados                                   |
| ArtReview / Reino Unido      | `/rss.xml`, 200/304; 0/20 autores            | Adiar; verificação individual               |
| Abduzeedo / Brasil           | `/rss.xml`, 200/304; 0/25 autores            | Adiar; autoria/condições restritivas        |
| ZUM / Brasil                 | `/feed/`, 200/200; última 28/10              | Adiar; condições IMS exigem revisão         |
| Artsy / EUA                  | Homepage 403; API pública em retirada        | Adiar; sem feed editorial confirmado        |
| BOOOOOOOM! / Canadá          | Homepage 200; nenhum feed oficial confirmado | Adiar; condições de uso limitadas           |
| Graphéine / França           | Homepage 200; sem feed/API confirmado        | Adiar; não inventar endpoint                |

Prioridade inicial: oito fontes de metadados acima, mais Plau, Smashing, Creative Commons e Escola de Dados já existentes (12). Preservar demais fontes relevantes e permissões licenciadas existentes; não importar catálogo sobrescrevendo-as. O ensaio real das 12, sem IA e em Miniflare efêmero, aprovou 41 candidatos; nem todos pertencem à semana e, portanto, aprovação não equivale a visibilidade. Resultado em [radar2-source-checks.json](examples/radar2-source-checks.json). As amostras técnicas iniciais de idioma precedem a correção que prioriza idioma declarado no feed.

## Migration, limpeza e rollback

`0014_radar_editorial.sql` é aditiva. `first_seen_at` legado usa `collected_at`; aprovação usa primeira decisão editorial. A fila antiga não tinha chegada individual: usa a primeira coleta conhecida da fonte conservadoramente, podendo descartar fila antiga sem atribuir novidade artificial. `radar_seen` mantém deduplicação mínima, inclusive após expiração; primeira descoberta nunca reinicia em redescoberta.

Aos nove dias não favoritos saem do feed, independentemente da limpeza. O Cron existente pode marcar até 50 e limpar até 25 por passagem, em transação. Não apaga linhas de `contents`: reduz dados temporários e conserva IDs, deduplicação, decisões e auditorias. Favoritos, Oficina, pacotes, publicações, coleções, notas e anotações protegem os dados vinculados. Científicos não entram nessa retenção.

Ensaio na cópia isolada: 77 expirados, 73 reduzidos; metadados protegidos e auditorias originais preservados, `foreign_key_check=[]`, `quick_check=ok`, 10 artigos semanais antes/depois. [Resultado](radar2-copy-validation.json). Script reproduzível: `lastro.cmd exec -- tsx scripts/radar2-copy-check.ts --copy=CAMINHO_SQLITE_ISOLADO`.

Próxima fase: novo backup, revisão/aplicação autorizada da migration, deploy autorizado com `RADAR_RETENTION_ENABLED=false`, mescla seletiva das fontes e observação. Só depois habilitar limpeza; está desligada no arquivo de produção desta branch. Antes da limpeza, rollback do Worker para a versão anterior tolera colunas extras. Após limpeza, rollback de código não recupera payloads removidos: restaurar exclusivamente os dados necessários do backup. Não reverter a migration com DROP em produção.

## Validação e cotas

Suíte completa: **183/183**; após ajustes finais, **56/56** testes direcionados. Cobrem os 12 cenários solicitados, API, regressões de direitos/sinopses e sistemas existentes. TypeScript backend/frontend, build e dry-run da configuração de produção passaram. Medição instrumentada: ingestão licenciada com retenção habilitada até 50 consultas D1 por invocação; limpeza 11, agendamento em passagem separada. O limite permanece explícito nos testes.

Estimativa das 12 prioritárias: até 12 requisições RSS/dia e 300 entradas por rodada limitada a 25/fonte; até 480 processamentos/dia com 2 itens por tick e 48 passagens de retenção nos 288 ticks existentes. Fontes licenciadas com reavaliação têm menor vazão; monitorar fila. Escritas incrementais estimadas abaixo de 15 mil linhas/dia nesse cenário, além da carga existente; leituras dependem de polling e volume. Não há contratação, recurso novo ou chamada de IA acrescentada pelo catálogo.

Limites oficiais consultados: [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) — 5 milhões de linhas lidas/dia, 100 mil escritas/dia; [limites D1](https://developers.cloudflare.com/d1/platform/limits/) — 50 consultas/invocação Free; [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) — 100 mil requisições/dia e 10 ms CPU. Estimativas não substituem medição da carga total. CPU e HTTP dos novos feeds a partir do Worker real ainda exigem homologação na próxima fase. Nenhum plano foi alterado e custo incremental desta execução: R$ 0.
