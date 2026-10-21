# API v1 — Lastro

Base local: `http://127.0.0.1:8787/api`. As rotas estão versionadas pelo contrato do projeto 0.1.0, sem prefixo `/v1` nesta etapa. JSON UTF-8; datas UTC ISO 8601; identificadores UUID. Todos os endpoints abaixo exigem autenticação, inclusive leituras e administração. Não há usuário selecionável no corpo: a identidade é sempre o proprietário autenticado.

Contratos canônicos: `packages/contracts/index.ts` (Zod + tipos inferidos), cliente de integração em `packages/contracts/client.ts`. Não copie as interfaces para o frontend. Strings recebidas são dados: renderize como texto, nunca como HTML.

## Endpoints do frontend

| Método e caminho                           | Entrada                                            | Resposta                                 |
| ------------------------------------------ | -------------------------------------------------- | ---------------------------------------- |
| GET `/feed`                                | `limit` 1–50, `cursor` opcional                    | `FeedPage`                               |
| GET `/search`                              | filtros abaixo                                     | `Page<Content>`                          |
| GET `/contents/:id`                        | UUID                                               | `Content`, inclusive estado e anotações  |
| GET `/contents/:id/relevance`              | UUID de item elegível                              | `RelevanceResponse`                      |
| PUT `/contents/:id/favorite`               | sem corpo                                          | `Content` atualizado                     |
| DELETE `/contents/:id/favorite`            | sem corpo                                          | 204, idempotente                         |
| GET `/favorites`                           | mesmos filtros de busca                            | `Page<Content>`                          |
| POST `/contents/:id/interactions`          | `{"type":"read","active":true}`                    | `Content` atualizado                     |
| PUT `/contents/:id/note`                   | `{"text":"Nota pessoal"}` até 5.000 caracteres     | `{text}`                                 |
| GET `/workshop/selection`                  | —                                                  | `{items: Content[]}` em ordem            |
| PUT `/workshop/selection`                  | `{"contentIds":["UUID"]}`                          | `{items: Content[]}`                     |
| POST `/research-packages`                  | `ResearchInput`                                    | 201, `ResearchPackage` imutável          |
| GET `/research-packages/:id`               | UUID                                               | `ResearchPackage` exportável             |
| POST `/research-packages/:id/prompt`       | sem corpo                                          | `PromptResponse`, idempotente por pacote |
| GET `/preferences`                         | —                                                  | `Preferences`                            |
| PUT `/preferences`                         | `{"interests":["design"],"languages":["pt","en"]}` | `Preferences`                            |
| GET `/collections`                         | `limit`, `offset`                                  | página de `{id,name,createdAt}`          |
| POST `/collections`                        | `{"name":"Branding"}`                              | 201, `{id,name}`                         |
| GET `/collections/:id/items`               | `limit`, `offset`                                  | `Page<Content>`                          |
| PUT `/collections/:id/items/:contentId`    | sem corpo                                          | 204                                      |
| DELETE `/collections/:id/items/:contentId` | sem corpo                                          | 204                                      |

Busca/favoritos: `q`, `topic`, `sourceId`, `kind`, `language`, `after`, `before`, `classification`, `limit` (20 padrão, 50 máximo), `offset` (0 padrão, 100.000 máximo). Datas de filtro `YYYY-MM-DD`, inclusivas em UTC. `q` é uma substring literal em título/descrição; não há busca semântica, stemming ou folding de acentos. Temas são normalizados para minúsculas e sem acentos. `classification` filtra marcações humanas; um paper não recebe automaticamente o rótulo de evidência científica.

Nas listas por offset, `nextCursor` é o próximo offset em formato textual: passar `offset=Number(nextCursor)` na próxima chamada. No **feed**, o cursor é opaco e deve voltar no parâmetro `cursor`; não o reconstrua. A sequência do feed dura 30 minutos. Um novo GET sem cursor recalcula a ordenação. Preferências e qualidade atuais continuam excluindo itens inelegíveis das páginas antigas; demais pontuações ficam congeladas até recarregar. Favoritos podem mostrar referências retiradas do índice; preserve a indicação `editorialStatus` e as limitações. Selecionar ou gerar pacote exige conteúdo ainda aprovado e fonte aprovada.

Tipos de interação: `seen`, `opened`, `read`, `dismissed`. `active:false` desfaz aquela interação. Repetir o mesmo comando não cria eventos duplicados. A seleção substitui atomicamente o conjunto, aceita no máximo 20 IDs únicos e `[]` limpa apenas a seleção. Favoritar, ler, descartar e selecionar não alteram os outros estados.

Pacote novo não reutiliza automaticamente o anterior; representa uma fotografia das fontes, notas e configurações daquele momento. Seu POST cria um recurso a cada chamada. O prompt é um por pacote. O pacote não marca a fonte como usada em publicação; esse vínculo é reservado para a etapa editorial.

```json
{
  "format": "carousel",
  "slides": 6,
  "tone": "autoral e analítico",
  "audience": "profissionais criativos",
  "objective": "Comparar abordagens de design das fontes selecionadas",
  "notes": "Explicitar os limites de aplicação"
}
```

`format`: `post`, `carousel`, `article`, `newsletter`. Carrossel exige 2–30 slides. Os formatos artigo/newsletter são orientações de prompt; não publicam conteúdo. Todo resumo ausente continua `null`. Uma URL não significa que o texto foi lido.

## Administração privada

O painel Curadoria usa as rotas abaixo com a mesma sessão privada por senha do restante da aplicação. `GET /admin/overview` retorna `AdminOverview` (agendamento, hosts permitidos e contagens). `GET /admin/decisions?limit=20&offset=0` retorna `Page<EditorialDecision>` combinando decisões de fontes e candidatos/conteúdos, com motivo, alvo e data. Nenhum segredo é retornado.

`GET /admin/sources` retorna `Page<AdminSource>`: campos de `Source` e `lastRun` (ou `null`). `GET /admin/candidates` retorna `Page<ReviewCandidate>`, acrescentando `quality` calculada pela política atual; não representa uma validação científica nem a avaliação humana histórica. `IngestionRun.received` registra novas entradas externas, zero em retomadas de fila e `null` em execuções anteriores à migração 0003. As contagens da execução não são reescritas por revisões posteriores.

| Método e caminho                       | Entrada / efeito                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| GET `/admin/sources`                   | página por `limit`, `offset` de `Source`                                         |
| POST `/admin/sources`                  | `sourceInputSchema`, 201 `Source` sempre `pending`                               |
| PUT `/admin/sources/:id`               | configuração completa; retorna para `pending`, limpa fila/ETag, mantém histórico |
| PATCH `/admin/sources/:id/status`      | `{status,reason}`; estados `pending`, `approved`, `paused`, `rejected`           |
| POST `/admin/sources/:id/ingest`       | sem corpo; retorna `IngestionRun` com contagens e `queuedRemaining`              |
| GET `/admin/ingestion-runs`            | página por `limit`, `offset`; erros sanitizados                                  |
| GET `/admin/candidates`                | `runId`, `outcome`, `limit`, `offset`; metadados, motivos e vínculo de conteúdo  |
| POST `/admin/candidates/:id/review`    | `reviewSchema`; aprova/rejeita e registra justificativa                          |
| POST `/admin/contents/:id/annotations` | `annotationSchema`; 201 anotação                                                 |
| GET `/admin/policy`                    | política ativa                                                                   |
| PUT `/admin/policy`                    | `policySchema` completo, exigindo versão inédita                                 |

Falha externa é execução persistida com HTTP 200 e `status:"failed"`; inspecione `error`. `partial` sem erro significa fila restante, não falha. Duas entradas são processadas por chamada. Havendo fila, novas chamadas a `/ingest` continuam o lote sem nova requisição externa. Sem fila, o intervalo da fonte é respeitado (409 se ainda não estiver na hora). Um erro 403/429 upstream não deve ser contornado.

Fluxo inicial em PowerShell (servidor rodando e `$lastroHeaders` do README):

```powershell
$lastroSource = Invoke-RestMethod http://127.0.0.1:8787/api/admin/sources -Method Post -Headers $lastroHeaders -ContentType 'application/json' -Body (Get-Content examples/source-rss.json -Raw)
$lastroDecision = @{status='approved'; reason='Fonte revisada para indexação privada de metadados'} | ConvertTo-Json
Invoke-RestMethod "http://127.0.0.1:8787/api/admin/sources/$($lastroSource.id)/status" -Method Patch -Headers $lastroHeaders -ContentType 'application/json' -Body $lastroDecision
Invoke-RestMethod "http://127.0.0.1:8787/api/admin/sources/$($lastroSource.id)/ingest" -Method Post -Headers $lastroHeaders
Invoke-RestMethod http://127.0.0.1:8787/api/admin/candidates?outcome=pending -Headers $lastroHeaders
```

As duas configurações em `examples/` usam `autoApprove:false`. Para aprovar conteúdo pendente, revisar seus metadados e enviar, por exemplo:

```json
{
  "decision": "approved",
  "reason": "Procedência e pertinência conferidas; texto integral ainda não consultado"
}
```

A revisão aceita `correction` com campos parciais de `Candidate` e, quando houver análise humana, `materialScore`/`originalityScore` (0–100). Campos omitidos são preservados, inclusive quando o contrato de criação possui defaults; `null` explícito continua sendo aplicado nos campos que o aceitam. Para um item rejeitado por metadados faltantes, corrigir título e URL, por exemplo. A revisão não ultrapassa fonte rejeitada, direitos negados, retratação ou indisponibilidade: é necessário corrigir o impedimento. Uma duplicata remete ao registro original; não edita outro conteúdo silenciosamente.

Anotação permite classificar uma afirmação (`statement`) ou fazer marcação editorial (`statement:null`). Há múltiplas marcações por item. `scientific_evidence` exige `referenceUrl` e `limitations`. Nenhuma anotação é gerada automaticamente. `materialScore` humano não representa verificação automática do estudo.

## Erros e limites

```json
{
  "error": {
    "code": "empty_selection",
    "message": "Selecione ao menos uma fonte na Oficina.",
    "requestId": "UUID da requisição"
  }
}
```

| HTTP | Códigos principais                                                                                                                                                   | Tratamento esperado                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 400  | `invalid_input`, `invalid_json`                                                                                                                                      | mostrar erro do campo; `details` contém caminho/motivo            |
| 401  | `unauthorized`                                                                                                                                                       | solicitar token local ou sessão Access                            |
| 403  | `origin_forbidden`                                                                                                                                                   | corrigir origem de integração                                     |
| 404  | `not_found`                                                                                                                                                          | conteúdo/rota inexistente ou item não disponível no índice        |
| 409  | `empty_selection`, `source_exists`, `source_busy`, `source_busy_or_not_due`, `source_not_approved`, `duplicate_content`, `duplicate_review`, `policy_version_exists` | resolver conflito sem repetir indiscriminadamente                 |
| 410  | `cursor_expired`                                                                                                                                                     | limpar sequência e buscar feed novamente                          |
| 413  | `payload_too_large`                                                                                                                                                  | reduzir corpo (64 KiB máximo)                                     |
| 415  | `unsupported_media_type`                                                                                                                                             | enviar `Content-Type: application/json`                           |
| 422  | `invalid_source_url`, `prefilter_failed`, `metadata_not_authorized`, `evidence_context_required`                                                                     | corrigir regra editorial / configuração                           |
| 429  | `rate_limited`                                                                                                                                                       | respeitar `Retry-After` (120 requisições/minuto por proprietário) |
| 500  | `internal_error`                                                                                                                                                     | exibir falha e guardar `requestId`; sem detalhes internos         |
| 503  | `auth_not_configured`                                                                                                                                                | configuração de autenticação ausente; sistema fechado             |

Corpos JSON são validados e campos desconhecidos em escritas são recusados. Nenhum endpoint aceita SQL, código, segredo OpenAlex ou ID de outro usuário. Não há endpoint de geração paga, disparo de e-mail ou publicação.

## Respostas reais para integração

`docs/examples/feed.json`, `content.json`, `researchPackage.json` e `prompt.json` foram capturados do servidor local após coleta externa, e não escritos à mão. `live-check.json` contém contagens e IDs da execução. São exemplos datados: não presumir que UUIDs ou cursores funcionem numa instalação nova. As fontes externas não são fixtures de teste; as ressalvas editoriais constam do pacote.
