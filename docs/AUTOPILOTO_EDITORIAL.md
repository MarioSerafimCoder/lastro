# Autopiloto Editorial

O Lastro seleciona três referências do Radar, redige e verifica um artigo em português e envia o Markdown completo ao Studio. A rota de recepção do Studio grava um rascunho privado no D1. A revisão e a publicação usam os controles manuais do editor.

## Migrações e configuração

| Projeto | Migração | Dados |
| --- | --- | --- |
| Lastro | `0017_editorial_autopilot.sql` | Configuração, histórico, leases e reserva editorial no mesmo registro UTC de quota das sinopses |
| Studio | `0004_editorial_autopilot.sql` | Origem, referências, metadados e recibo persistente da execução |

O Lastro reutiliza o binding `AI`, o serviço `STUDIO`, `INTEGRATION_ENABLED`, `STUDIO_ORIGIN` e o secret `STUDIO_INTEGRATION_SECRET`. O Studio reutiliza `ECOSYSTEM_SECRET` com o mesmo valor do secret do Lastro, além de `STUDIO_ORIGIN`, `GITHUB_REF` e o secret `GITHUB_TOKEN` para ler a biblioteca do blog. Os bindings `DB` continuam apontando para o banco de cada projeto.

`EDITORIAL_AUTOPILOT_FREE_CONFIRMED` habilita o recurso no ambiente. Os arquivos versionados começam com `false`. O controle no Lastro começa desativado e habilita as execuções diárias após a homologação. A execução manual funciona com esse controle desativado quando o ambiente está habilitado.

O gatilho compartilhado roda em `0,13,17,43,47 * * * *`. No minuto zero, somente o horário de 11:00 UTC dispara o autopiloto, às 08:00 em Fortaleza. As outras 23 chamadas no minuto zero encerram sem acesso ao D1. Os horários de Integrações, Search Console, ingestão e sinopses preservam a cadência atual. A conta já usa cinco gatilhos e a configuração mantém esse total. [Limites de Workers](https://developers.cloudflare.com/workers/platform/limits/)

## Fontes, memória e custo

- A seleção considera atualidade, autoridade, qualidade, originalidade, proximidade temática e frequência de uso. As publicações dos últimos sete dias recebem prioridade. Uma referência dos últimos 30 dias pode ser complementada por material de até 180 dias. Referências marcadas como perenes continuam disponíveis. A seleção exige três publicações distintas e descarta material com sobreposição alta.
- A evidência vem dos trechos ou resumos autorizados já registrados na coleta. A URL canônica deve coincidir com a evidência e o item aprovado do Radar. A seleção valida o vínculo com o feed, a data, a permissão e o formato HTTPS. A disponibilidade HTTP no momento da execução e o texto integral ficam fora da checagem. Metadados isolados são insuficientes.
- A memória do Studio combina títulos, resumos e argumentos ou aberturas de até 30 textos recentes. A consulta lê o D1 e os arquivos do blog pelo fluxo GitHub existente. Para respeitar o limite de subrequisições, a consulta admite até 40 arquivos remotos sem versão local. Acima disso, a geração aguarda uma revisão da estratégia de leitura. A comparação de textos anteriores roda no Lastro. O modelo recebe somente a pauta e os trechos selecionados.
- Até duas chamadas por artigo. Gemma 4 26B A4B redige com teto de 2.800 tokens de saída e Llama 3.3 70B FP8 Fast faz a checagem com teto de 1.300. A reserva conservadora é de 897 neurônios por execução. O teto editorial é de 1.000/dia UTC e o Radar dispõe da sua reserva de 4.500/dia. O saldo real é compartilhado pela conta e a franquia do provedor é de 10.000/dia. Um erro de quota no binding bloqueia novas reservas no dia UTC. [Gemma](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) · [Llama](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) · [Franquia e preços](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- `generation_usage` e `verification_usage` registram tokens e neurônios do provedor quando retornados, além do cálculo separado pelas taxas publicadas. A reserva e os dados observados têm significados distintos.

Uma consulta de leitura ao D1 de produção em 12/11/2026 encontrou 73 referências aprovadas dos últimos sete dias e nenhuma com evidência autorizada nesse período. O recorte de 30 dias encontrou evidência de apenas uma publicação. O caminho gratuito é aprovar, na Curadoria, fontes com autorização explícita de reutilização ou licença aberta compatível, registrar as permissões existentes no Radar e validar que a coleta produz três evidências independentes para uma mesma pauta. Enquanto faltar evidência, o histórico registra a execução sem geração.

## Contrato e recuperação

- `GET /integration/v1/editorial-memory` devolve `{ version, items }`, com itens `{ title, summary, argument }`.
- `POST /integration/v1/editorial-drafts` recebe `editorial-1.0`. O contrato completo vive em `packages/contracts/editorial-article.ts` no Lastro e `src/editorial-article.ts` no Studio. O pedido carrega a data editorial, o ID da execução, a categoria, os metadados, três referências e o Markdown completo. A resposta traz versão, ID, revisão e URL administrativa. Os dois endpoints passam pela verificação HMAC existente.
- O Studio gera o frontmatter com `status: draft` e usa o mesmo armazenamento e editor dos demais rascunhos. O recibo é inserido junto com o rascunho em um lote atômico. O reenvio devolve a revisão atual sem sobrescrever edições. Depois de uma exclusão, a mesma execução recebe HTTP 410.
- A data de Fortaleza é única e há um lease persistente de processamento. Falhas transitórias de pesquisa e envio têm até quatro tentativas no total, com espera mínima de 15 minutos para a retomada automática nos ciclos de integração. Reprocessar um envio reutiliza o artigo salvo. Depois que uma inferência começa, uma interrupção sem resultado confirmado leva a `needs_review` e evita uma nova chamada.

## Homologação

1. No checkout do Studio, instale as dependências com `pnpm install --frozen-lockfile` e execute `pnpm check`, `pnpm test` e `pnpm build`.
2. No Lastro, aponte `EDITORIAL_STUDIO_DIR` para a pasta do checkout do Studio e rode `npm test`. O teste integrado abre o Worker compilado do Studio no runtime do próprio projeto, aplica as migrações em dois bancos locais e exercita HMAC, perda de recibo, reenvio, edição autenticada e exclusão. A geração do teste integrado usa uma resposta controlada.
3. Execute `npm run typecheck`, `npm run web:typecheck`, `npm run build` e `npm run test:ui -- --grep "autopiloto editorial"` no Lastro.
4. Em ambiente isolado, aplique as duas migrações localmente ou nos bancos de homologação. Use a URL e o secret HMAC desse ambiente. Confirme a franquia da conta antes de habilitar o binding de IA no teste. Com três referências autorizadas, use **Executar agora** e confira tese, voz, fatos e fontes diretamente no editor do Studio.
5. Na homologação, confira que o rascunho abre pelo link do Lastro, salve uma edição e valide que o reenvio devolve o mesmo ID e a revisão atual. Confira que o artigo segue privado no D1 e que a operação não cria arquivo no GitHub.

### Medição de 12/11/2026

A execução integrada local criou o rascunho no Studio a partir de três evidências controladas. O teste confirmou revisão 2 depois da edição humana e do reenvio. Na homologação inicial de Workers AI, a amostra de redação teve 712 palavras. O verificador apontou extrapolações e o artigo ficou retido. O provedor reportou 38,60 neurônios para a redação e 185,27 para a checagem, totalizando 223,87. As amostras anteriores de comparação entre modelos levaram o total observado da homologação inicial a 645,79 neurônios.

## Auditoria de elegibilidade de 12/11/2026

O recorte de sete dias teve 73 referências aprovadas. A tabela registra tanto a presença de texto quanto o motivo principal de exclusão. Uma referência com descrição pode aparecer também entre as restritas.

| Condição | Referências | Exemplo do Radar |
| --- | ---: | --- |
| Sem texto identificado no registro ou no feed consultado | 30 | [Redescoberta de uma pintura de Caravaggio, ARTnews](https://www.artnews.com/art-news/news/lost-caravaggio-painting-rediscovered-paris-terzaghi-1234805289) |
| Com descrição ou resumo registrado | 43 | [Paris Photo no Grand Palais, ARTnews](https://www.artnews.com/art-news/market/paris-photo-2026-report-photography-bicentennial-1234805587) |
| Com texto e permissão ainda não verificada | 4 | [Adobe e a evolução do Firefly, B9](https://www.b9.com.br/adobe-made-to-create-firefly-agentes-ia-criatividade-humana) |
| Com evidência e permissão válidas | 0 | Fora dos sete dias, há a [nota sobre o Papo de IA, InternetLab](https://internetlab.org.br/pt/opiniao/nota-sobre-a-mencao-a-pesquisa-papo-de-ia-em-comunicado-da-meta/) |
| Bloqueadas pela política de direitos registrada no Radar | 68 | [Parceria da Artnet com a Kalshi, Hyperallergic](https://hyperallergic.com/art-bros-about-to-get-more-insufferable-as-artnet-partners-with-kalshi) |
| Bloqueadas por insuficiência de texto já autorizado | 0 | Nenhum caso no recorte |

O feed atual reencontrou 24 dos 73 itens. Em 22 havia descrição no feed. Os outros dois ofereciam corpo e já tinham prévia registrada. A referência da [nova identidade da Caixa](https://www.meioemensagem.com.br/comunicacao/caixa-apresenta-nova-identidade-visual-apos-quase-30-anos) ficou sem texto identificado como motivo principal. A ausência de registro em um feed rotativo vale para o material consultado na auditoria.

O painel **Elegibilidade das fontes** mostra a janela de sete dias, a quantidade de publicações com evidência e uma simulação sem chamada à IA. A migração `0018_editorial_evidence_observations.sql` registra a presença de descrição e corpo. O coletor usa a descrição autorizada quando o corpo rende apenas um fragmento insuficiente e o resumo é adequado. O cache mantém o texto somente quando a fonte e o item permitem esse processamento. As referências do rascunho incluem licença e crédito identificado no feed, quando disponíveis.

A simulação com o acervo de produção encontrou 12 referências elegíveis de três publicações. A pauta de IA e criação reuniu a [nota do InternetLab](https://internetlab.org.br/pt/opiniao/nota-sobre-a-mencao-a-pesquisa-papo-de-ia-em-comunicado-da-meta/), uma [análise da Creative Commons](https://creativecommons.org/2026/09/21/a-principled-approach-as-the-sands-shift/) e um [ensaio da BaixaCultura](https://baixacultura.org/2026/07/13/desnaturalizar-a-ia-os-comuns-digitais-como-materia-prima-de-um-novo-cercamento/). O conjunto liga os limites de uma pesquisa, a governança do reuso e a crítica ao uso de trabalho coletivo. O site do InternetLab atribui a nota ao InternetLab Institucional e o feed lista Fernanda Campagnucci. O formato identifica separadamente a publicação e o crédito recebido no feed.

O reprocessamento no D1 atualizou 37 referências. Em 13 havia evidência autorizada para recaptura. Nas outras 24 foram registradas observações de disponibilidade, sem armazenar novos trechos.

Com esse trio, Workers AI gerou **O custo do cercamento**, com 848 palavras. Os validadores automáticos aceitaram a amostra. A checagem conferiu 13 blocos com índices explícitos e exigiu suporte literal nos trechos para os três blocos factuais. A leitura humana ainda apontou linguagem técnica imprecisa sobre tokenização e generalizações que pedem edição. O teste gerou Markdown privado e não acionou o Studio ou a publicação em produção. O provedor reportou 46,88 neurônios para a redação e 163,21 para a checagem final. Incluindo as tentativas retidas, a homologação desta revisão consumiu 419,94 neurônios.

## Ativação em produção

Após autorização para deploy, confirme a disponibilidade de evidência, o plano gratuito e o saldo de IA. Aplique a migração do Studio e implante o Studio antes do Lastro. Aplique a migração do Lastro e implante o Lastro usando `wrangler.production.jsonc`, com a franquia confirmada na configuração. Valide uma execução manual e a edição do rascunho. Em seguida, ative **Autopiloto Editorial** na interface e confira o horário apresentado. Para pausar novas execuções diárias, use **Desativar automação**.
