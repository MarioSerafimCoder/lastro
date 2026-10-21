# Curadoria e recomendação

## Ingestão

1. Fonte nasce `pending`; somente `approved` entra na coleta. Alterar configuração exige nova aprovação. Pausar/rejeitar também remove seus conteúdos do feed e da busca geral, preservando acervo e histórico.
2. RSS/Atom ou OpenAlex recuperam até 25 metadados. HTTPS, hosts explícitos em allowlist, 10 s de timeout por tentativa, 2 MB máximos, sem redirects; até 3 tentativas para erro transitório. 429/5xx podem ser repetidos com espera; `Retry-After` maior que 5 s encerra a chamada e adia a fonte. 401/403 não são repetidos. ETag/Last-Modified preservados.
3. A resposta vira fila persistida em D1. Cada chamada processa até **2 entradas**. Continuações drenam a fila antes de nova coleta. O cron escolhe uma fonte por invocação, a cada 5 minutos; requisições externas respeitam o intervalo da fonte (mínimo 60 min, padrão 360 min). O cron não roda sozinho no processo de desenvolvimento: acionamento local está em OPERATIONS.
4. Normalização de URL remove fragmentos e parâmetros conhecidos de tracking, ordena query e preserva identificadores semânticos. DOI perde prefixo/URL e é normalizado para minúsculas. Chaves únicas de URL/DOI/OpenAlex/outros IDs garantem deduplicação; GUID RSS é escopado por fonte. Não se presume equivalência de HTTP/HTTPS nem de URLs distintas sem evidência.
5. Pré-filtro: fonte, autorização para metadados, título e URL válidos, tema, idioma conhecido, período configurado, data futura, acesso indisponível e retratação. Restrições de acesso mantêm só metadados; `restricted` não implica descartar uma referência útil. Autor/data/idioma ausentes exigem revisão e não são preenchidos artificialmente.
6. Qualidade: média ponderada de fatores 0–100. Cada avaliação preserva versão, fatores, limitações e origem heurística/humana.
7. Conteúdo vira `approved` automaticamente apenas se a fonte habilitar isso, houver autoria/data/idioma, não for paper e atingir o limiar. Demais candidatos válidos ficam `pending`. Rejeições guardam motivos e metadados; correção/revisão pelo proprietário pode recuperá-los. Papers sempre pedem revisão humana.

Nenhum resumo é sintetizado. RSS só guarda resumo curto (até 1.200 caracteres) se `summaryAllowed:true`; `content:encoded` não é usado. OpenAlex não reconstrói abstracts nem baixa artigos. Resumos e notas são dados externos sem autoridade para alterar instruções do prompt.

## Política inicial `lastro-1.0`

| Fator de qualidade | Peso | Como é estimado                                                                        |
| ------------------ | ---: | -------------------------------------------------------------------------------------- |
| Autoridade         |   20 | valor editorial explícito no cadastro, não fama inferida                               |
| Material           |   25 | completude de autoria/data/resumo/identificadores; **proxy**, não análise metodológica |
| Relevância         |   30 | correspondência lexical com temas configurados                                         |
| Originalidade      |   15 | primário 85, secundário 25, desconhecido 50; só usar marcação quando verificável       |
| Atualidade         |   10 | decaimento de 180 dias; conteúdo evergreen recebe valor estável 70                     |

Limiar automático: 65. Piso do For You: 55. Citações acadêmicas não entram no escore. A quantidade de metadados, a autoridade da base ou um DOI não validam ciência. O escore de material pode ser substituído por avaliação humana documentada; o sistema não inventa análise de método, amostra ou causalidade.

Regras de relevância por substring são deliberadamente simples; dependem de bons temas e podem gerar falsos positivos/negativos. Rejeições auditáveis e correção manual são o mecanismo inicial de controle.

## For You

Candidatos: até 500 aprovados mais recentemente coletados de fontes atualmente aprovadas. Não inclui descartados nem itens abaixo do piso; idiomas das preferências restringem quando definidos. Busca é separada e consulta todo o índice aprovado, sem a janela de 500.

Escore inicial: qualidade × 35 + afinidade com interesses × 25 + originalidade × 10 + atualidade × 10 + afinidade com favoritos/fontes utilizadas × 10. Fatores são normalizados para 0–1 antes do peso. Visualizado reduz 12; lido reduz 20. Cliques, abertura e tempo de permanência não aumentam pontuação.

A ordenação iterativa adiciona bônus de diversidade `10 / (1 + repetição)` por temas/fontes já presentes. Cada quinta posição reserva descoberta fora dos interesses declarados, quando houver candidato que passou pelo mesmo piso de qualidade. Empates resolvidos por ID. A cada entrada, o contrato retorna fatores e motivos em português. A afinidade por histórico de favoritos/uso é baseada em temas, sem treinamento externo.

Snapshots congelam IDs e explicações por 30 minutos, evitando reordenação entre páginas. Leituras/favoritos atuais são consultados novamente; retiradas do índice e descartes são excluídos. Mudanças de pesos/interesses só reorganizam um novo snapshot. A explicação corresponde ao estado do algoritmo no momento em que a sequência foi criada.

`PUT /admin/policy` exige versão inédita e preserva a anterior. Pesos novos afetam novos rankings; avaliações de qualidade antigas permanecem com a versão original até revisão/reavaliação explícita. Não há reavaliação massiva automática nesta etapa. O frontend pode mostrar `content.quality.version` e `explanation.algorithmVersion` distintos.

## Calibração pendente

Todos os pesos são hipóteses iniciais de engenharia. Calibrar com corpus rotulado e uso real: relevância percebida, rejeições recuperadas, diversidade útil, fontes salvas e reutilização. Evitar otimização por permanência ou cliques. Não há resultado de eficácia científica ou editorial medido nesta entrega.
