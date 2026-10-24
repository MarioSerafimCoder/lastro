# Expansão sustentável — 24/10/2026

## Base e alterações

Antes de implementar, foi confirmado o deploy `f37af4c1-e40e-46be-b8f1-bf1aac76c0f9`, correspondente à etapa `c62ee84`, e o estado real: 16 sinopses, 8 PT/8 internacionais, 38 bloqueados e 5 em revisão. O agendador estava ativo.

Foram cadastradas e aprovadas somente duas fontes verificadas:

- [Escola de Dados](https://escoladedados.org/), Brasil: RSS `https://escoladedados.org/feed/`, recorte de cartografia e visualização, autoria e data conferidas. O rodapé e o artigo de Thays Lavor declaram CC BY 4.0, permitindo trabalhos derivados com crédito. Configuração: [21.json](../examples/catalog/21.json).
- [Creative Commons](https://creativecommons.org/blog/): RSS `https://creativecommons.org/feed/`, recorte de cultura aberta, patrimônio, criação e IA. Artigos assinados e atividade em outubro de 2026. A [política oficial](https://creativecommons.org/policies/#license) licencia textos próprios sob CC BY 4.0, exceto ressalvas. Configuração: [22.json](../examples/catalog/22.json).

Os dois RSS responderam 200 e seus robots não restringem a coleta. Apenas trechos mínimos autorizados foram armazenados; imagens e textos integrais não foram arquivados. Fontes brasileiras foram priorizadas na investigação. Não foram cadastrados feeds somente com chamadas/títulos, fontes inativas, casos sem autoria ou fontes com licenças NC/ND fora da política vigente. Não foram ampliadas permissões das fontes anteriores.

A triagem existente admitia convites de inscrição e anúncios de prêmios com metadados completos. Esses casos e categorias explicitamente promocionais/eventos agora seguem para revisão. Não houve alteração de pontuações mínimas, ranking, equilíbrio de idiomas ou critérios factuais. O gerador 2.3 explicita o enquadramento editorial já exigido pelos validadores.

A Curadoria reutiliza os cartões existentes para mostrar última descoberta bem-sucedida, última referência indexada, fila e ausência de novidades elegíveis por 30 dias. Sinopses mostra publicações em sete dias, pendências e bloqueios por direitos, evidência, técnica e orçamento. As informações vêm das consultas existentes, sem um novo painel ou consultas no feed principal.

## Testes e limites

- `npm run verify`: 77 testes aprovados, tipos e build concluídos.
- Interface: 22 testes aprovados e uma demonstração opcional ignorada; responsividade, teclado, autenticação, favoritos, leitura, seleção e preferências preservados. As capturas geradas pelos testes não integram o commit.
- Dois registros reais licenciados percorrem ciclos sucessivos de descoberta, evidência, geração/verificação simuladas e publicação 50/50. Recoletas de dias seguintes não repetem IA nem duplicam referências. Esse teste **não** representa aprovação dos modelos reais.
- Os testes de factualidade, direitos/revogação, concorrência, orçamento/virada do dia, histórico e preservação das 16 sinopses continuam aprovados.
- Ingestão com captura: 46 consultas por execução; reavaliação de existente: 35. Margem de 4 e 15 diante do [limite de 50 no Free](https://developers.cloudflare.com/d1/platform/limits/). Não foi necessário otimizar ou mudar o Cron.
- D1 antes da expansão: 1.921.024 bytes; últimas 24 horas com 202.298 linhas lidas e 6.401 escritas. Janela de 24 horas não equivale ao dia UTC de cobrança; os valores estão abaixo das franquias diárias publicadas de [5 milhões/100 mil](https://developers.cloudflare.com/d1/platform/pricing/).
- Backup `lastro-before-sustainable-expansion-20261024.sql`, 1.317.697 bytes, fora do repositório. Nenhuma migração de esquema necessária. As duas rotinas Cron foram mantidas.

## Validação com modelos reais e pendências

Foram descobertas 22 entradas: 3 aprovadas nos metadados, 7 encaminhadas à revisão e 12 rejeitadas pelo recorte/política. As filas de ingestão das duas fontes foram esvaziadas, sem duplicações nem erro de coleta.

Dois ciclos reais consumiram **58,401374 neurônios**, em quatro chamadas medidas (duas gerações e duas verificações). Total monitorado no dia: **157,384517**, 20 chamadas, nenhuma sem medição. Reserva diária chegou de 3.900 a **4.500**; a reserva não foi confundida com consumo real, reduzida ou reiniciada.

**Não houve nova publicação no For You nesta etapa.**

- “Dicas para mapear dados sobre a fé e cobrir o racismo religioso”: rascunho retido; resposta do verificador não pôde ser interpretada como JSON. O rascunho também apresenta problemas de redação; não foi reescrito nem aprovado manualmente.
- “From Reflection to Action: 8 Hot Takes from CC’s Open Heritage Roundtable”: rascunho retido; parecer cobriu apenas duas das três frases. Não foi aceita uma aprovação parcial.
- “Open Heritage in the Age of Artificial Intelligence”: pendente de orçamento; não foi iniciada inferência.

O problema real de formato motivou o verificador 2.1: a requisição JSON agora informa o número exato de frases, limita o tamanho das citações e exige cobertura de todos os índices. Recusas continuam representáveis; não se força parecer positivo. Os validadores locais de citações e suporte factual permanecem obrigatórios. Falhas de formato/cobertura recebem diagnóstico técnico e revisão, sem repetição silenciosa. O provedor pode falhar em cumprir o formato; nesse caso não há publicação. A correção foi testada com respostas simuladas, mas sua eficácia com o provedor real **ainda não pôde ser aferida**, pois a reserva diária terminou. Não houve nova chamada para forçar aprovação.

O estoque de For You permanece **16, 8 PT/8 internacionais**, com os mesmos textos; os 38 bloqueados e as cinco revisões anteriores permanecem preservados. O estado após os ciclos é 38 bloqueados, 7 em revisão e 1 pendente de orçamento, além dos 16 validados. Favoritos, seleção e autenticação foram conferidos novamente após o deploy.

A rotina de sinopses retoma automaticamente o item pendente no próximo dia UTC; a descoberta das fontes continua diariamente, sem consultas por acesso ao feed. Itens com parecer incerto continuam na Curadoria. **O critério de demonstrar novas publicações automáticas em produção em ciclos sucessivos ainda está pendente**, embora o fluxo completo esteja coberto pelos testes simulados. Não houve flexibilização editorial, serviço pago ou monitoramento prolongado.

Deploy final: `2b664562-2720-429d-80cb-87d9238f086c`, em https://lastro.marioserafim.com.br/. A conferência posterior comparou os 59 registros anteriores, preservando textos/estados, favoritos e seleção; o feed respondeu 401 sem sessão e a saúde respondeu 200. Nova execução com orçamento esgotado retornou pendente sem aumentar as 20 inferências ou as reservas. O agendador registrou execução automática às 12:07 UTC; as duas filas de ingestão novas ficaram vazias. Não foram adicionadas automações externas.
