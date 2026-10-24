# Ampliação das sinopses — 24/10/2026

## Resultado em produção

For You com **16 referências: 8 em português e 8 em outros idiomas**, todas com sinopse validada de 35–60 palavras. As oito sinopses anteriores foram comparadas por ID/texto e permanecem idênticas. Nenhum dos 38 registros originalmente bloqueados foi apagado ou liberado sem evidência.

Foram gerados 13 novos rascunhos, uma vez por referência. Oito foram aprovados após conferência editorial e cinco ficaram em revisão. Um parecer automático inicialmente favorável não percebeu a diferença entre lançamento de pesquisa e lançamento de seus resultados: a auditoria final corrigiu a sinopse, preservou o histórico e acrescentou uma barreira de temporalidade para afirmações sobre eventos futuros. Não atribuímos essa leva a oito aprovações automáticas. A automação de geração/publicação continua ativa para casos que passam em todas as verificações; os modelos leves ainda podem exigir revisão conservadora.

## Auditoria dos 38 retidos

Todos estavam sem evidência armazenada e com processamento de sinopses não autorizado na configuração da fonte. Disponibilidade pública de RSS não foi tratada como licença de adaptação.

| Fonte                          | Retidos | Lacuna para enriquecimento                                                                                                                                                          |
| ------------------------------ | ------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A List Apart                   |       1 | Metadados sem descrição armazenada; política de copyright exige autorização para reprodução, e permissão de tradução fiel não equivale a autorização geral de síntese automatizada. |
| Smashing Magazine              |       7 | Cadastro autoriza metadados/links; não há autorização de adaptação registrada.                                                                                                      |
| Creative Boom                  |       5 | Mesma restrição de metadados/links; não há evidência autorizada armazenada.                                                                                                         |
| It's Nice That                 |       1 | Sem evidência autorizada e idioma ainda desconhecido.                                                                                                                               |
| UX Collective Brasil           |       2 | Somente metadados autorizados; acesso público/Medium não transfere direitos sobre os textos.                                                                                        |
| Journal of Vision via OpenAlex |       7 | Sem abstract autorizado; CC0 dos metadados não licencia automaticamente o artigo. Revisão científica necessária.                                                                    |
| Design Studies via OpenAlex    |      15 | Mesma lacuna: falta abstract/evidência e verificação de licença individual. Revisão científica necessária.                                                                          |

Total: **16 editoriais + 22 estudos**. Os 38 permanecem bloqueados. Não foi contornado acesso restrito nem ampliada a autorização dessas fontes.

## Fontes novas

| Configuração                      | Fonte                                                    | Licença verificada                                                               | Novas sinopses aprovadas |
| --------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- | -----------------------: |
| [18](../examples/catalog/18.json) | [Design in government](https://designnotes.blog.gov.uk/) | OGL v3.0, declarada no rodapé, exceto restrição específica                       |                     4 EN |
| [19](../examples/catalog/19.json) | [BaixaCultura](https://baixacultura.org/)                | CC BY-SA 4.0 no rodapé                                                           |                     2 PT |
| [20](../examples/catalog/20.json) | [InternetLab](https://internetlab.org.br/pt/)            | CC BY-SA 4.0 no site institucional; não confundir com CC BY da revista acadêmica |                     2 PT |

Os três RSS responderam HTTP 200. Robots consultados não bloqueiam esses feeds. Foram descobertas 30 entradas: 13 com metadados aprovados, 5 ainda pendentes de autoria/recorte e 12 rejeitadas por tema/período. Nenhuma escola/evento promocional foi usada para completar a meta. A autoria Leonardo Foletto foi conferida na assinatura dos dois ensaios do BaixaCultura, corrigindo o usuário genérico `baixacultura` fornecido pelo RSS; demais entradas com esse problema seguem em revisão.

O coletor, no modo exclusivo de evidência, lê até 1.200 caracteres textuais do próprio RSS/Atom, encerrando em frase completa. Requer permissão de processamento, justificativa e licença de adaptação cadastradas. Uma restrição de copyright explícita do item prevalece sobre a licença geral. Imagens, comentários, marcas e páginas integrais não são armazenados. A ingestão normal continua sem reproduzir descrições quando `summaryAllowed=false`.

A API conserva a URL original e a licença junto à evidência. Os cards identificam a sinopse como adaptação e oferecem o link da licença; créditos de autoria, fonte e artigo são mantidos. Adaptações CC BY-SA são disponibilizadas sob a mesma licença. O editor de fontes preserva a licença ao salvar alterações.

### Referências adicionadas ao For You

- [What are the principles of prototyping?](https://designnotes.blog.gov.uk/2026/09/29/what-are-the-principles-of-prototyping/)
- [Designing services for people who've lost trust online](https://designnotes.blog.gov.uk/2026/06/23/designing-services-for-people-whove-lost-trust-online/)
- [Updating the skills content designers need in government](https://designnotes.blog.gov.uk/2026/06/09/updating-the-skills-content-designers-need-in-government/)
- [When AI answers the question, what happens to the user journey?](https://designnotes.blog.gov.uk/2026/03/31/when-ai-answers-the-question-what-happens-to-the-user-journey/)
- [Desnaturalizar a IA](https://baixacultura.org/2026/07/13/desnaturalizar-a-ia-os-comuns-digitais-como-materia-prima-de-um-novo-cercamento/)
- [Cultura livre na era da IA generativa](https://baixacultura.org/2026/04/15/cultura-livre-na-era-da-ia-generativa-o-que-resta-dos-comuns-digitais/)
- [Nota sobre a menção à pesquisa Papo de IA](https://internetlab.org.br/pt/opiniao/nota-sobre-a-mencao-a-pesquisa-papo-de-ia-em-comunicado-da-meta/)
- [Novo projeto do InternetLab analisa como a IA generativa aborda temas relacionados às eleições](https://internetlab.org.br/pt/noticias/novo-projeto-do-internetlab-analisa-como-a-ia-generativa-aborda-temas-relacionados-as-eleicoes/)

### Cinco novos rascunhos retidos

- Encontro internacional de designers públicos: o rascunho introduziu detalhes de evento sem apoio integral.
- Imagens ofensivas no X: número não sustentado literalmente pela evidência disponível.
- Chatbots e perfil do usuário: interpretação sobre compreensão dos usuários sem suporte.
- Repositório achearegra: extensão excessiva e sobreposição literal.
- Comparação ChatGPT/Gemini: o gerador respondeu `Insuficiente`; sem publicação e sem nova geração.

Assim, o acervo com metadados aprovados contém 59 referências: **16 validadas + 38 bloqueadas + 5 em revisão de sinopse**. Outros cinco candidatos novos aguardam revisão dos metadados; não entram nessa contagem de 59.

## Operação e consumo

- Orçamento preventivo preservado: 4.500 neurônios/dia UTC, reserva de 300 por ciclo automático. Foram reservados 3.900; **consumo real retornado pela Cloudflare: 98,983143 neurônios**, em 16 inferências (13 gerações e 3 verificações). Nenhuma inferência desta etapa está sem medição. A reserva não é consumo faturado; o total inclui rascunhos recusados.
- Leituras repetidas do feed não geram IA. Consultas do acervo usam os textos do D1. Cada item teve uma geração; não houve repetição para forçar aprovação.
- Gerador `lastro-synopsis-2.2`: orientação de três frases curtas, alvo de 40–48 palavras, exemplos sintéticos e saída limitada a 220 tokens. As verificações aceitam somente 35–60 palavras; modelos, limite diário e verificador independente foram preservados. Respostas insuficientes continuam retidas.
- Crons de ingestão e sinopses preservados; pendentes sem orçamento retomam no próximo dia UTC. Falhas e incertezas não entram em repetição silenciosa. Nenhum serviço pago ativado.
- Testes confirmam geração/verificação, cache, atribuição, licença específica de item, RSS/Atom, temporalidade, deduplicação, persistência, concorrência e orçamento diário. Ingestão: 44 consultas + 3 do agendador, abaixo de 50 por invocação. Ciclo de sinopses também testado abaixo desse limite.
- Backup antes das alterações: `C:/Users/pc mario/Documents/Lastro-backups/lastro-before-synopsis-expansion-20261024.sql`, fora do Git. Não foi necessária migração de esquema.

Política de origem consultada: [copyright do A List Apart](https://alistapart.com/about/copyright/). Condições de adaptação/atribuição: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) e licença OGL indicada pelo próprio blog.

## Validação e publicação

`npm run verify`: **59 testes aprovados**, verificações de tipos e build concluídos. API de produção confirmou 16 IDs distintos, 8 PT/8 EN, sinopses validadas de 35–60 palavras, autoria e data; leitura repetida não aumentou inferências. Comparação com a auditoria inicial confirmou os oito textos idênticos e os 38 registros preservados. Favoritos, seleção e coleções responderam; acesso ao feed sem autenticação recebeu 401.

Agendador executou sozinho às 10:22:37–10:22:38 UTC (7h22 de Brasília) e terminou `idle`, sem novos elegíveis. Publicação final do Worker: `23ee3763-6fcf-4621-bcba-cc718bef3c06`. Aplicação: https://lastro.marioserafim.com.br/.
