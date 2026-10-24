# Verificador e orçamento — 24/10/2026

Base: `65301ad`. Escopo restrito à verificação, proteção do orçamento e testes. Nenhuma fonte, interface, migração ou frequência Cron foi alterada.

## Problema confirmado e correção

As duas últimas verificações reais deixaram um parecer ilegível e outro com apenas duas avaliações para três frases. Uma chamada atingiu exatamente 1.000 tokens de saída; sem a resposta bruta anterior não é possível atribuir toda a falha de formato ao truncamento. O formato enviado não garantia que o modelo cumprisse o esquema. A variante usada, `@cf/meta/llama-3.1-8b-instruct-fp8-fast`, não consta na [lista oficial de JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).

Foi escolhido `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, presente nessa lista e no [catálogo vigente](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/). Continua no Workers AI Free, sem serviço externo ou alteração de faturamento. Por ser maior, exige reserva e limites explícitos próprios; não se presume o custo do antigo modelo.

O verificador 2.2 elimina o exemplo de uma frase que contrariava a cardinalidade de três, usa um esquema simples sem dialeto externo, exige uma entrada por índice e mantém recusas representáveis. O retorno do binding é interpretado como objeto JSON ou string JSON; cercas e espaços externos são tratados, sem extrair um JSON conveniente de uma resposta em prosa. Truncamento, índices repetidos/ausentes, recusas e respostas incompletas impedem publicação. Tipo de retorno, tokens e diagnóstico são persistidos na avaliação, sem guardar nova cópia do texto da fonte.

As barreiras de direitos, origem, suporte das citações, números, datas, causalidade e ciência permanecem iguais. O esquema e um parecer positivo não substituem essas barreiras. Não se reprocessam automaticamente rascunhos antigos para obter aprovação.

## Auditoria do orçamento

No dia UTC auditado, 15 ciclos reservaram exatamente 15 × 300 = **4.500**. Foram 15 gerações e 5 verificações, totalizando 20 chamadas medidas: **83,656494 + 73,728023 = 157,384517 neurônios**. Não há chamadas sem medição nessa janela. O máximo do gerador foi 6,942087; do verificador, 38,426266. A reserva ficou 28,59 vezes acima do consumo observado, sem evidência de duplicação contábil: reserva é uma alocação anterior à inferência e não é devolvida automaticamente.

A amostra de cinco verificações não sustenta redução estatística segura e não mede o novo modelo. Não foram liberadas reservas históricas, reiniciado o dia ou alterado o teto de **4.500/dia UTC**. As reservas futuras são **150 para geração + 300 para verificação = 450 por ciclo automático**, com até dez ciclos completos em um dia novo. Rascunhos sujeitos a revisão continuam reservando 150.

A reserva do novo verificador usa os [custos publicados](https://developers.cloudflare.com/workers-ai/platform/pricing/): 26.668/204.805 neurônios por milhão de tokens de entrada/saída. A requisição completa, incluindo esquema, fica limitada a 4.000 bytes UTF-8 e a saída a 800 tokens; acrescenta-se margem de 1.024 tokens para formatação. Essa estimativa superior fica abaixo de 300. Entradas acima do limite são retidas antes da chamada, sem truncar a evidência para obter aprovação. A geração mantém limite de 12 KB, 220 tokens e reserva de 150. Os controles são conservadores, não uma promessa de custo médio.

As estimativas agora são específicas por modelo, inclusive o antigo, e nunca são confundidas com `usage.neurons`. Modelo sem taxa conhecida não recebe uma estimativa inventada. O limite atômico do D1 continua protegendo concorrência e retomada no dia UTC seguinte. Uma entrada grande local não é mais confundida com quota do provedor e não bloqueia indevidamente o restante do dia.

## Validação e produção

`npm run verify`: 80 testes aprovados, tipos e build concluídos. Um teste adicional dirigido de estoque assimétrico também passou: 8 PT/9 EN produzem 16 cards; 0 PT/9 EN não produz um lote falsamente equilibrado. Total executado: 81 testes. Os novos testes cobrem formatos do binding, truncamento, recusas, cobertura, preços por modelo, dez reservas concorrentes de 450 e retenção de entradas excessivas sem repetição ou bloqueio diário indevido. Os testes existentes preservam direitos, idempotência, acervo, ranking e dados pessoais.

Deploy: `0a72cf3d-4df6-4ede-a5b6-39020fb44f77`, https://lastro.marioserafim.com.br/. Os dois Crons continuam ativos. Sem migração de banco ou alteração de design.

**Validação com IA real pendente por orçamento.** A disponibilidade foi conferida antes de qualquer tentativa: 4.500 reservados, saldo zero. Não houve chamada nova, teste de IA fora da contabilização ou monitoramento até a virada do dia. O teste posterior do pipeline apenas confirmou a recusa por orçamento, sem alterar consumo, tentativas ou reservas.

Estado preservado: **16 sinopses validadas, 8 PT/8 internacionais; 38 bloqueados; 7 em revisão; 1 pendente de orçamento**. Os 62 registros anteriores foram comparados por ID, texto, estado e número de tentativas; favoritos, seleção, fontes e autenticação foram conferidos. Não houve nova aprovação automática. As cinco revisões anteriores e os dois casos de Escola de Dados/Creative Commons permanecem retidos; o artigo “Open Heritage in the Age of Artificial Intelligence” aguarda o próximo orçamento.

O critério de pelo menos uma aprovação nova com o modelo real **não está comprovado nesta execução**. O bloqueio exato é a reserva diária esgotada. O novo modelo e seu retorno real só poderão ser aferidos quando houver orçamento; suporte documentado e respostas simuladas não são apresentados como prova em produção.
