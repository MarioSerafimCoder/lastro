# Radar 2.0 — Fase 03 — 04/11/2026

**APTO COM RESSALVAS para merge revisado e ativação posterior. Produção não foi alterada.**

## Integração e correções

Branch `codex/radar-2-homologation`, derivada de `ef3eb8b8f47a691253f436a3e02f7fb97d0986da` (o hash informado `ef3e8bb` estava transcrito incorretamente). Motor `a92aebf4d8df64a668ae86d1c5f126fb2225ab65` e `master` remota `61745497a47d32bc0d36471737151511d7bc71fc` já são ancestrais; nenhuma resolução destrutiva foi necessária. Preservadas as alterações Brain/Drive posteriores à master, já implantadas em produção.

Falhas reproduzidas e corrigidas: seleção da Oficina confirmada antes da gravação; circulação de Tab fora dos controles; painel reaberto por resposta tardia após Escape. O painel aguarda confirmação, relê o estado persistido e permite recuperação. Pulso mostra pendências reais, separa descoberta editorial de rodada científica e informa coleta sem novidades. Respostas antigas de status não derrubam a interface.

## Banco e fontes reais

Exportação privada somente leitura concluída em 04/11, aproximadamente 15h20 de Fortaleza; SQL e cópias permanecem fora do Git, em `~/.codex/private-backups/lastro/`. O export pode suspender brevemente consultas D1; uma consulta concorrente recebeu erro 7500 e passou na repetição após o término. Nenhuma migration, fonte ou limpeza remota foi executada.

[Auditoria](radar2-homologation-audit.json): 150 referências, 82 aprovadas, 67 pendentes, uma rejeitada; 23 entradas na fila. Existem 11 artigos publicados nesta semana (02–08/11 em Fortaleza), dez aprovados. O gate antigo de sinopse não exibe nenhum deles. Há 16 sinopses validadas, 57 bloqueadas por direitos, 68 pendentes e nove em revisão. As 13 fontes estão aprovadas com metadados habilitados; nenhuma tem falha consecutiva atual. O histórico inclui quatro 429, um 503 e uma falha genérica, preservados para auditoria.

[Amostra atual](radar2-homologation-sources.json): cinco RSS responderam 200. Creative Boom: 12 publicações na semana; It's Nice That: nove; Smashing: uma. Referências da Figur e Smashing coincidem entre feed público e banco. Rejeições `off_topic` explicam parte das ausências; um item de Creative Boom ainda não estava registrado, sem evidência suficiente para atribuir sua ausência a bug ou publicação tardia no RSS. A List Apart (última publicação 30/06) e Plau (11/09) estão acessíveis, mas sem novidade semanal. Datas de coleta e descoberta são distintas.

Os testes internacionais da Fase 01, realizados no mesmo dia, foram reutilizados: Colossal, Hyperallergic, ARTnews, It's Nice That, Creative Boom, étapes:, ARTE!Brasileiros e designboom têm proposta de metadados validada. **Isso não significa ativação remota**: somente It's Nice That e Creative Boom desse grupo estão no banco definitivo. ArtReview e Abduzeedo aguardam autoria; ZUM, revisão das condições IMS; Artsy, Graphéine e BOOOOOOOM!, endpoint/permissão confirmados. Não se inferem direitos sobre imagens, resumos ou IA. Catálogo e evidências anteriores continuam em `examples/radar2-catalog.json` e `docs/radar2-source-validation.json`.

## Retenção e validação

[Ensaio em cópia recente](radar2-homologation-copy.json): migration 0014 aplicada somente na cópia; 77 expiradas, 73 reduzidas em lotes de até 50 marcações/25 reduções, 11 statements por passagem; dez artigos elegíveis antes e depois. Hashes dos metadados protegidos e auditorias preservados, `foreign_key_check=[]`, `quick_check=ok`. Linhas de conteúdo e decisões permanecem; apenas payloads temporários desprotegidos são reduzidos.

Testes sintéticos verificam oito dias, nove completos, favorito antigo, remoção do favorito sem exclusão imediata, deduplicação, Oficina, pacotes, citações/publicações, sinopse em processamento, rollback de falha parcial e repetição de lotes. O Científico mantém seu ciclo e critérios. Nenhum conteúdo real foi fabricado.

Validação integrada reproduzível: `lastro.cmd run test:ui:radar2` — Chrome, build real, rotas Hono reais, D1 efêmero com todas as migrations e login/sessão real; **nenhuma API de navegador simulada**. São 46 referências sintéticas, com 37 inicialmente visíveis, filtros combinados e vazios, leitura, ranking, detalhes, teclado, persistência, falha D1, skeleton, expiração e Científico. Capturas em [1440 escuro](examples/radar2-homologation/1440-dark.png), [1280 claro](examples/radar2-homologation/1280-light.png), [1024 escuro](examples/radar2-homologation/1024-dark.png) e [390 claro](examples/radar2-homologation/390-light.png).

Resultado final: **185/185 testes de backend, 5/5 cenários de navegador integrado e 20/20 regressões UI**, tipagem Worker/web, builds, formatação dos arquivos alterados e dry-run da configuração de produção aprovados. Incluem contratos de Jarvis, Brain/Drive, autenticação, Curadoria, Studio, oportunidades e newsletters. Fixtures/seletores compartilhados foram atualizados para o painel e Jarvis 3. Os testes visuais históricos do Radar 1 continuam no arquivo legado, fora do recorte executado; não são alegados como aprovados. Serviços externos não modificados não foram reauditados.

## Cotas e ressalvas

Nenhum serviço pago, Worker, banco ou Cron remoto novo; nenhuma inferência de IA executada nesta fase. Metadados do catálogo têm sinopse/imagem desabilitadas. [Telemetria somente leitura](radar2-homologation-quotas.json), às 15h35: todos os D1 da conta somam 592.377 linhas lidas e 3.465 escritas no dia UTC, cerca de 11,8%/3,5% das franquias Free. Flags e três Crons ativos foram conferidos sem alterações. Consultar assinaturas retornou 403; `usage_model=standard` sozinho não comprova o plano contratado. Não houve mudança de plano.

A união conservadora de 13 fontes existentes e seis novas propostas soma 17 RSS e dois OpenAlex: até 17 requisições RSS/dia, até 425 entradas por rodada de 25/fonte, contra teto teórico de 480 processamentos/dia com retenção e duas entradas/tick. Fontes licenciadas podem consumir mais passagens; não há garantia de escoamento sem observar a fila. A estimativa anterior de até 15 mil escritas/dia incrementais continua apenas um orçamento conservador, não uma medição. Limite de 50 statements por invocação verificado em testes. CPU e conectividade no Worker remoto integrado não foram medidas, pois não houve deploy.

Limites oficiais consultados em 04/11: [D1](https://developers.cloudflare.com/d1/platform/pricing/) — 5 milhões lidas/100 mil escritas por dia; [D1 por invocação](https://developers.cloudflare.com/d1/platform/limits/) — 50 queries; [Workers](https://developers.cloudflare.com/workers/platform/pricing/) — 100 mil requisições/dia, 10 ms CPU no Free. Custo incremental da execução: **R$ 0**.

## Ativação e rollback preparados, não executados

1. Antes do merge, atualizar master e revalidar ancestry/diff. Produção registrada: versão Worker **`57bc80ee-c2f4-4ccb-bce0-b6d8d4ce09d3`**, de 04/11 às 14h08 em Fortaleza. Preservar os flags/cliente Brain/Drive ativos e todos os Secrets, bindings e três Crons existentes.
2. Na janela autorizada, obter novo export privado, verificar SHA-256, integridade, espaço e restauração isolada; registrar bookmark Time Travel. O backup desta fase é ensaio, não substitui backup imediatamente anterior à ativação.
3. Única migration pendente confirmada remotamente: **`0014_radar_editorial.sql`**. Seu ensaio isolado passou. Aplicação remota exige etapa posterior autorizada; nunca aplicar versão que consulta colunas 0014 antes da migration.
4. Fazer merge revisado; implantar o artefato validado com **`RADAR_RETENTION_ENABLED=false`**. Conferir sessão, `/api/feed?scope=editorial`, status, favoritos e Oficina. Observar CPU, limites compartilhados e uma rodada diária antes de ampliar fontes.
5. Mesclar seletivamente as seis fontes novas e país/classificação das fontes existentes; preservar IDs, permissões licenciadas, URLs canônicas e preferências. Não importar o catálogo sobrescrevendo configurações válidas. Não ativar as adiadas. Não ampliar sinopses/IA. A lista de hosts proposta já está na branch.
6. Somente após observação aprovada, decidir separadamente a ativação da retenção. Antes dela, rollback para a versão Worker acima tolera as colunas aditivas. Manter migrations e dados; não executar DROP. Depois de redução de payloads, rollback de código não recupera dados: restaurar seletivamente a partir do backup validado, protegendo favoritos/vínculos criados depois dele.

Ressalvas para ativação: aferir CPU/HTTP e escoamento real da fila no Worker, confirmar o plano pela conta com acesso a assinaturas e revisar a mescla de fontes. A liberação definitiva permanece pendente dessas verificações e da autorização de produção.
