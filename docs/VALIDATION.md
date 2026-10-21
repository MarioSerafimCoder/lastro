# Validação da etapa 01

Executada localmente em 20/10/2026, Windows, Node.js 24.18.0. Nenhum deploy de produção.

## Testes automatizados

Suíte `npm test`: **18 testes aprovados**, zero falhas. Integração executa rotas reais do Hono e migrações sobre D1/SQLite do Miniflare, não sobre um repositório de dados em memória simulado. Requisições externas da suíte são controladas por fixtures sintéticas, identificadas como TESTE. O teste externo separado abaixo usa o Worker real no runtime local do Wrangler.

Cobertura principal:

- Deduplicação por URL canônica, DOI e GUID; restrição única no banco.
- Fonte pendente/rejeitada/pausada não coleta; histórico de decisões persistido.
- Qualidade configurável, metadados incompletos, idioma/período/direitos/retratação.
- RSS e Atom, resumo autorizado, bloqueio de entidades XML, OpenAlex sem inferência por citações.
- Ranking determinístico, piso de qualidade, histórico, redução para leitura/descarte e exploração fora dos interesses.
- Independência de favoritos, seleção, leitura, notas e coleções; consultas diretas verificam persistência.
- Revisão/correção de rejeitados; papers pendentes e múltiplas classificações intelectuais por item.
- Feed com cursor, sequência estável, retirada por pausa/descarte e expiração.
- Busca/filtros, Salvos, pacote com fontes/metadados/notas e prompt idempotente.
- Auth local, CORS, tamanho de corpo, entradas inválidas; produção falha fechada sem configuração.
- JWT: assinatura, emissor, audience, expiração, proprietário e header de email insuficiente.
- Retries limitados, 429 com espera longa, redirects bloqueados, validação de host e segredo não enviado ao RSS.
- Falhas upstream persistidas, liberação do lease, fila retomável sem nova coleta e contagem de até 50 consultas D1 por chamada de ingestão.
- Retratação posterior desindexa a referência original e preserva o favorito e o histórico.

TypeScript verificado sem erros. Build com `wrangler deploy --dry-run` gerado localmente. Migrações `0001_initial.sql` e `0002_ingestion_queue.sql` aplicadas no banco local. Auditoria de dependências não apontou vulnerabilidades na execução desta entrega.

## Coleta externa e fluxo ponta a ponta

`scripts/live-check.mjs` executado contra `http://127.0.0.1:8787`, usando o token local sem gravá-lo em exemplos. Evidência: [registro](examples/live-check.json).

| Conector              | Primeiro lote                    | Pendentes editoriais | Rejeitados pelo filtro | Na fila |
| --------------------- | -------------------------------- | -------------------: | ---------------------: | ------: |
| RSS Smashing Magazine | concluído parcialmente, sem erro |                    1 |                      1 |      23 |
| OpenAlex              | concluído parcialmente, sem erro |                    1 |                      1 |      23 |

O termo `partial` indica duas entradas processadas de uma página de 25, não falha. Os 23 restantes de cada fonte ficaram no banco para continuação. Não há declaração de que todos os conteúdos da fonte foram coletados ou aprovados. OpenAlex respondeu sem chave nesta verificação.

Um item RSS foi aprovado para demonstração técnica após conferência de procedência, título e pertinência dos metadados. Seu texto integral **não foi lido**, e a decisão registra essa limitação. Não houve aprovação automática de ciência.

O fluxo real confirmou HTTP 401 sem autenticação, cadastro/aprovação de fontes, ingestão externa, revisão de um candidato, presença no feed, favorito e seleção simultâneos, pacote estruturado e prompt contendo a URL correta. A seleção e o estado de favorito anteriores foram restaurados após a captura. Pacote, prompt e auditoria de demonstração permanecem salvos.

O acionamento periódico local também foi executado por `/__scheduled`, com resposta HTTP 200 `Ran scheduled event`; continuou o processamento da fila existente sem exigir outra chamada externa.

Respostas capturadas: [feed](examples/feed.json), [conteúdo](examples/content.json), [pacote](examples/researchPackage.json), [prompt](examples/prompt.json). São respostas datadas do banco local, não fixtures usadas para fazer testes passarem.

## Limites da verificação

Não foram testados uma conta Cloudflare real, domínio, login Access real, quotas diárias/CPU de produção, restauração remota ou um corpus editorial amplo. JWT foi testado com chaves criptográficas de teste. Os pesos ainda não foram calibrados com uso real. Nenhum serviço pago, envio de mensagem, publicação de blog/newsletter ou alteração de portfólio foi realizado.
