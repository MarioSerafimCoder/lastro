# Autonomia e confiabilidade das sinopses

Auditoria sobre `41c0e9c`, em 24/10/2026. Alterações restritas ao pipeline e às garantias de publicação.

## Problemas confirmados e correções

- A fila só selecionava `pending` sem tentativas; `blocked` não reagia a permissões/evidências novas. Agora a retomada depende de versão de autorização ou material efetivamente diferente. Datas de coleta e diferenças de espaço não causam nova inferência. Rejeições editoriais explícitas não são desfeitas por mudanças de fonte.
- Evidência não era capturada na descoberta e podia desaparecer da janela de 25 itens do RSS. Trechos autorizados passam a ser persistidos antes do processamento da fila, com URL canônica, origem, licença, data, restrição específica e versão da permissão. O enriquecimento usa esse registro sem nova requisição. O recurso de consulta ao feed fica para registros legados sem captura e ocorre uma vez por versão material; ausência do artigo fica bloqueada, sem repetição contínua. Corpo integral não é arquivado, inclusive em posts curtos.
- O feed e a validação editorial não verificavam a autorização atual da evidência. Revogações agora mudam uma versão persistente na fonte e invalidam a evidência dependente. Reaprovar a fonte não recupera a versão antiga. Evidências editoriais independentes continuam válidas quando sua autorização e os metadados permanecem válidos. A checagem também protege o encerramento de processamento concorrente.
- A idempotência do envio de evidência ignorava licença. A identidade material agora inclui licença, procedência, restrições e versão da autorização. Históricos no D1 preservam textos, evidências, avaliações e transições anteriores, inclusive quando os metadados mudam.
- Um parecer positivo com citação verdadeira não prova suporte factual. Foram adicionadas barreiras determinísticas para conclusões, causalidade, generalizações, afirmações fora da descrição editorial, conflitos com limitações explícitas, números completos, números por extenso e datas compostas. Números também precisam constar nas citações específicas de cada frase. Repetir um título longo não constitui evidência suficiente. Os estudos científicos continuam em revisão; incertezas não são publicadas nem geradas de novo para obter aprovação.
- Falhas técnicas anteriores à inferência admitem até três tentativas espaçadas, com espera crescente. Início de inferência é registrado no D1; falhas ou interrupções após esse ponto não disparam outra geração silenciosa. Falta de direitos, evidência insuficiente, falha técnica, orçamento e revisão editorial têm códigos distintos.
- A fila de ingestão guarda a URL canônica e detecta reavaliação de registros existentes na mesma consulta. Nesses casos automáticos, processa um item por invocação para acomodar as escritas adicionais. A descoberta normal continua com até dois, sem adicionar consultas D1 para essa decisão.

## Orçamento e operação

O consumo registrado da etapa anterior foi 98,983143 neurônios em 16 inferências: 13 gerações e somente 3 verificações. A reserva de 3.900 foi 39,4 vezes o consumo observado. Essa amostra não cobre suficientemente o verificador nem entradas próximas dos limites; portanto, **não foram reduzidas as reservas** de 300 por ciclo automático e 150 por rascunho de revisão. O teto continua em **4.500/dia UTC**, com retomada dos pendentes no próximo dia. As duas rotinas Cron, a frequência de descoberta e os modelos foram preservados.

O Worker continua descobrindo, enriquecendo e publicando automaticamente novos itens que passem em todas as barreiras. Os testes usam modelos simulados e evidência sintética; não são apresentados como medição de qualidade dos modelos reais. Nenhuma fonte foi adicionada nesta etapa e nenhum item antigo foi liberado por ausência de autorização.

## Migração e validação

Migração aditiva `0007_synopsis_autonomy.sql`. Backup anterior à migração: `lastro-before-autonomy-20261024.sql` (1.082.809 bytes), guardado fora do Git. Ensaio da migração sobre cópia desse backup preservou todos os textos/estados, favoritos, seleção e decisões, mantendo 16 elegíveis em 8 PT/8 outros idiomas e 38 bloqueados.

Os testes abrangem recuperação material, idempotência, revogação/reaprovação, restrição do item, evidência independente, conteúdo fora do RSS recente, concorrência, alteração durante inferência, falhas, orçamento/dia seguinte, persistência de 16 sinopses e publicação 50/50 após vários ciclos simulados. Contagem D1 medida: 46 consultas no Cron com descoberta/captura licenciada de dois itens; 35 na reavaliação de existente; ambas abaixo de 50. Os testes existentes de autenticação, favoritos, seleção, ranking e calendário permanecem na verificação completa.

A migração usa [SQL compatível com D1](https://developers.cloudflare.com/d1/sql-api/sql-statements/) e preservação de histórico no banco. Não houve alteração de interface.

## Resultado da publicação

`npm run verify`: **74 testes aprovados**, tipos e build concluídos. Migração 0007 aplicada após backup e ensaio. Worker publicado: `f37af4c1-e40e-46be-b8f1-bf1aac76c0f9`.

Validação de produção: 16 sinopses com os mesmos textos, 8 PT/8 outros idiomas; 38 bloqueados e 5 em revisão preservados. Favoritos e seleção comparados com a captura anterior, sem alterações. Autenticação mantida (401 sem sessão) e `/health` respondeu 200. Ciclo manual sem elegíveis retornou `idle`; leituras e essa execução não acrescentaram inferências. Nenhuma chamada nova de Workers AI em produção foi necessária nesta etapa. Os dois agendamentos foram confirmados no deploy, sem monitoramento prolongado.
