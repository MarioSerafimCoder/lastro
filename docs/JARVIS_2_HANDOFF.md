# Jarvis 2.0 — etapa 01 / handoff para Sol

Base confirmada após fetch: `origin/codex/commercial-newsletter` em `e43b327`, incluindo correções e homologação comercial. Trabalho isolado em `codex/jarvis-2-stage-01`. Não usar master como base: ela não contém as integrações comerciais atuais. Nenhum deploy, migration remota, Secret, cron ou serviço foi alterado nesta etapa. Custo incremental executado R$ 0.

## Arquivos e contratos

- `packages/contracts/jarvis.ts`: respostas, ações, preferências e validações estritas; `jarvis-intents.ts`: normalização PT, intenções ponderadas, empate/baixa confiança e períodos em America/Sao_Paulo.
- `src/jarvis.ts`: consultas autorizadas, snapshots locais, notificações, ações de navegação e memória. Reutiliza `integrationOverview`/`weeklySummary`; GA4 e CRM são lidos dos snapshots D1, sem chamadas externas por mensagem. Promessa compartilhada por DB com TTL de cinco minutos; alterações locais de oportunidades invalidam o snapshot.
- `src/index.ts`: endpoints privados sob autenticação/rate limit existentes e corpo limitado a 4 KiB.
- `0011_jarvis_memory.sql`: aditiva, preparada apenas. D1 existente: preferências singleton owner, memória de alertas/ações e orçamento diário de balões. Nenhuma conversa, nome, telefone, e-mail ou briefing é persistido pelo Jarvis.
- `apps/web/src/Jarvis.tsx`/`jarvis-client.ts`: evolução do mesmo painel, consulta e esclarecimentos, fonte/período/sincronização, controles persistentes e requisições compartilhadas. `experience.ts`: removida a sugestão genérica de campanhas disponíveis. `App.tsx`/`Opportunities.tsx`: navegação supervisionada para oportunidade específica. CSS restrito ao Jarvis.

## API (somente administrador)

- `GET /api/jarvis/state`: preferências, notificações elegíveis, data e política IA.
- `POST /api/jarvis/query`: `{text,area,choice?,allowAI?}`; retorna `Answer`. Nunca executa uma ação de negócio; `choice` somente aceita uma das dez intenções. Consulta salva apenas a última área, nunca texto/conversa. Intenções desconhecidas, empates e períodos não suportados pedem esclarecimento.
- `PATCH /api/jarvis/preferences`: `{enabled,proactive,communication,area}`. Comunicação formal ou humor discreto.
- `POST /api/jarvis/notices`: `{id,operation:shown|dismiss|snooze}`; shown reserva atomicamente o limite diário. A marcação é metadado operacional, não execução de negócio. Snooze 24h; dispensa vale para a versão do evento.
- `POST /api/jarvis/actions`: `{kind,target?}` validado por registro estrito. Só resolve navegação/destino já existente e registra solicitação supervisionada; conclusão em sites externos não é presumida. Links externos revisados exigem clique explícito. Nenhum handler publica, envia, aprova histórico, responde comercialmente ou exclui dados de negócio.

## Alertas e limites

Prioridades 100/95/90/75/60/45. Balões contêm somente texto genérico por evento, sem dados pessoais. ID SHA-256 de entidade + evento/versão; novas tentativas técnicas não mudam o ID de uma mesma falha. Até dois balões por dia de São Paulo, com cooldown global conservador de 1h (prioridade >=90) ou 6h; aba oculta, Oficina, campos ativos, diálogos ou tarefas busy suprimem exibição. Nunca abre o painel sozinho. Poll >=5min com aba visível; transições consultam o cache compartilhado. Pequena janela de estabilização no carregamento evita interromper o trabalho inicial.

Notificações são candidatas por até 30 dias da mudança; dispensas retidas 90 dias. Até 500 registros de aviso: ao atingir o limite, novos registros são recusados, preservando dispensas ainda válidas. Até 100 ações recentes por 30 dias; orçamento de exibição por sete dias. Limpeza nas operações privadas, sem novo cron. Preferências ficam até substituição explícita, um único registro. Capacidade de consultas: até 1.001 oportunidades e 100 itens do catálogo; limites/ausência de sincronização são indicados como cobertura incompleta.

Tendências só com 14 dias consecutivos completos até ontem, duas janelas equivalentes de sete dias, >=100 sessões em cada uma e >=50 usuários ativos em pelo menos um dia de cada janela (limite inferior de usuários únicos, sem somar dias), variação >=30%, cache recente e sem limitação/filtragem. São sessões somadas; usuários únicos não são somados. Amostras pequenas e séries incompletas não alertam.

## IA e custo

`allowAI` prepara o contrato opcional; a política desta etapa retorna sempre `enabled:false`, mesmo com autorização solicitada. Nenhum caminho executável chama Workers AI. Não há modelo escolhido, nova credencial, fornecedor ou orçamento reservado. Gratuidade/modelo e orçamento compartilhado com sinopses não foram homologados; a condição financeira do pedido exige permanecer determinístico. Sol só poderá integrar uma inferência após essa homologação, contador/reserva atômicos compartilhados, teto próprio baixo, limites de texto/saída, sanitização e confirmação específica. Saída de IA nunca terá autoridade sobre ações. Não habilitar por simples variável de ambiente.

## Validação e continuação

Testes `tests/jarvis.test.ts` cobrem PT, períodos, ambiguidade, dados ausentes/antigos, autorização/limites, PII, memória, concorrência, dispensas/adiamento, IA bloqueada e tendências. `tests/ui.spec.ts` inclui desktop/mobile, consulta, esclarecimento e navegação. Regressões direcionadas de Analytics, integrações e oportunidades preservadas. A falha antiga dependente do relógio das sinopses permanece fora do escopo.

Para Sol: revisar contratos e UI nesta branch; aplicar 0011 somente em D1 local isolado e homologar as rotas com sessão local. Verificar preferências após recarregar, limite diário entre abas, edição/aba oculta e links de Studio/artigos. Não criar dados reais de oportunidades ou campanhas. Uma futura ativação de produção requer autorização explícita e backup verificado do D1; não foi feita agora. Não há dependências novas. Commit com `[CI Skip]` evita implantação automática pelo push.

Resultado final: 44 testes de backend/regressão aprovados, dois testes companion ignorados por pré-condição existente; nove testes de navegador aprovados (incluindo 390/768/1280/1440 px, preservação dos painéis comerciais, preferências após recarregar, consulta/esclarecimento, ação supervisionada e ausência de balão durante edição). TypeScript backend/frontend e build com dry-run aprovados. Nenhum teste remoto de escrita foi realizado.

## Etapa 02 — chat / uso em computador

Branch `codex/jarvis-2-stage-02`, derivada da etapa 01 `ba17c71`. Backend, contratos e migration 0011 preservados. Painel existente evoluído para chat flutuante desktop, mantendo marca animada: histórico visual (até 30 perguntas, somente memória da sessão), Enter/Shift+Enter, perguntas sugeridas ligadas às intenções reais, carregamento/erro/repetição, fonte/data/cobertura por resposta, ações autorizadas e limpeza de conversa. Preferências/contexto ficam recolhidos; não há dashboard novo.

Balão utiliza a memória/limites do Astra, com ação principal, Depois (24h) e dispensa. Aba oculta ou janela sem foco suprimem balões. Logout/401 abortam consultas e resolução de ações, descartam histórico e cache privados; texto nunca é salvo em localStorage/sessionStorage. Apenas preferências não sensíveis existentes continuam no navegador. Links externos exigem clique explícito após resolução do servidor. Operações de negócio de escrita continuam indisponíveis.

Conforme orientação posterior do proprietário, esta etapa é destinada ao computador; suporte específico a teclado virtual/celular foi descartado. Validação por emulação e navegador desktop, sem ensaio em hardware móvel. Nenhuma IA, dependência, serviço, Secret, cron, migration remota ou deploy definitivo foi adicionado. Custo incremental R$ 0.

Validação da etapa 02: 44 testes direcionados de backend/regressão aprovados, dois companion ignorados pela pré-condição existente. Seis verificações finais de navegador desktop aprovadas (preferências persistidas, layout, navegação comercial, esclarecimento, balão durante edição e chat por teclado/erros/limpeza/logout), mais verificação específica de sessão expirada por 401. TypeScript backend/frontend e build/dry-run aprovados. Os testes usam dados sintéticos e API controlada; nenhuma escrita em produção.

## Homologação final — 03/11/2026 (São Paulo)

Branch integrada `codex/jarvis-2-final-validation`: a etapa 02 (`8998095`) contém integralmente a etapa 01 (`ba17c71`). Backend, contratos e migration 0011 são idênticos entre essas etapas. Diferenças contra produção estão limitadas ao Jarvis, ligação de navegação/sessão, migration aditiva e testes/documentação; configurações de produção, bindings, crons e dependências foram preservados.

Backup definitivo preparado em diretório ignorado `.wrangler/jarvis-final`, ACL restrita ao usuário: `lastro-before-0011.sql`, 5.737.788 bytes, SHA-256 `9502d0f9d782f0af2931634d7445ee334b585e40ff506f892f96757290f7a14e`. Restaurado em SQLite em memória, `integrity_check=ok`, migrations 0001–0010. A estrutura 0011 foi ensaiada somente em cópia local; SHA-256 `a1e5e13c86fe448b6baa620defa98116d64adfb637236dfff8b9775219f1131b`. A consulta remota confirmou somente 0011 pendente. Nenhuma migration remota foi aplicada.

Dez intenções homologadas contra o snapshot real em cópia isolada, sem fetch externo ou inferência. Catálogo Studio sem rascunhos no snapshot, oportunidades novas/atrasadas ausentes, metadados de quatro campanhas CRM e snapshots GA4 existentes preservados. Duas notificações reais elegíveis, ambas prioridade 75. Deduplicação, dispensa, adiamento e preferências foram exercitados apenas na cópia local, com recuperação por processo separado. Cenários sem dados reais (novos orçamentos, rascunhos, prioridades críticas e audiência) foram cobertos pelos testes sintéticos existentes. O tom permaneceu factual; humor discreto não foi aplicado a erros ou dados indisponíveis.

A homologação real encontrou uma ação de continuação oferecida quando o catálogo tinha zero rascunhos. Correção mínima: resposta sem ação quando não existe alvo, com teste de regressão. Não houve reconstrução do backend. Resultado: 45 testes direcionados aprovados, dois companion ignorados pela pré-condição existente, sete testes de navegador desktop aprovados; TypeScript backend/frontend e build/dry-run aprovados. Indisponibilidade de API, cache antigo, sessão expirada, limpeza e ações proibidas cobertos. A falha antiga de horário das sinopses permaneceu fora do escopo.

Plano de ativação sujeito a autorização explícita: atualizar o backup se houver intervalo relevante; aplicar somente 0011 no D1 existente e verificar integridade; implantar apenas Lastro desta branch; verificar autenticação, memória, respostas e navegação em leitura, mantendo IA bloqueada e sem criar contatos/campanhas reais. Nenhum Secret adicional é necessário. Rollback: restaurar o Worker `ac6536e7-845b-4b9b-9145-3c42474d4ea4`, preservando tabelas aditivas e dados posteriores; não executar DROP nem restaurar o backup sobre alterações novas automaticamente. Produção continua nessa versão, sem Jarvis 2 ativado. Nenhum Worker, cron, serviço, plano ou dependência foi acrescentado; custo incremental R$ 0. Recomendação: apto à ativação autorizada, com a cobertura real e as limitações acima.

## Ativação definitiva — 03/11/2026 (São Paulo)

Autorização executada na branch definitiva `master`. A versão homologada `7fd2503` contém integralmente as Etapas 01 (`ba17c71`) e 02 (`8998095`) e foi integrada por fast-forward, preservando as integrações comerciais e GA4 já presentes. Deploy somente do Lastro em `https://lastro.marioserafim.com.br`; Worker `lastro-api`, versão `5e62383f-0ca2-40eb-9ae7-5daf3392313e` ativa a 100%. A publicação anterior, usada como alvo de rollback seguro, era `ac6536e7-845b-4b9b-9145-3c42474d4ea4`.

Imediatamente antes da migration foi exportado e restaurado em SQLite em memória o backup protegido `.wrangler/jarvis-activation/lastro-before-0011.sql`: 5.745.140 bytes, SHA-256 `3324dbcfebb416b99b9f661af896169261937c2a80bf5b156a277a9b0d0ab6d8`, `integrity_check=ok`, schema até 0010. Aplicada exclusivamente `0011_jarvis_memory.sql`; a lista remota confirma 0001–0011 e nenhuma migration pendente. As tabelas aditivas do Jarvis foram verificadas. O backup antigo também foi confirmado íntegro; preservado, sem restauração sobre a produção.

Validação em sessão autenticada: as dez intenções responderam com snapshots reais de oportunidades, Studio, integrações editoriais e GA4. As respostas apresentaram fonte, período e sincronização; cobertura incompleta foi identificada e ausência de linhas de newsletter não foi descrita como zero visitas. Viu-se um alerta real de prioridade 75; o registro `shown` e o orçamento diário persistiram no D1 com uma exibição, e a reapresentação é limitada pelo ID estável e cooldown. A ação supervisionada de artigo resolveu para o destino esperado; nenhum link externo foi aberto. Preferências foram alteradas e recuperadas do backend após recarga, então restauradas aos valores anteriores do proprietário (`enabled=true`, `proactive=true`, `communication=discreto`, área `oportunidades`).

`/health` respondeu 200; endpoints privados do Jarvis sem sessão responderam 401. As 25 bindings de produção permaneceram idênticas antes/depois; deploy reteve os três crons existentes. Política e interface confirmam IA desativada. Nenhum artigo, campanha, contato ou mensagem foi criado, publicado ou enviado. Custo incremental: R$ 0; nenhum serviço, plano, Worker ou Cron adicional. Sem falha crítica ou rollback. Limitação observada: oportunidades e rascunhos estão vazios nos snapshots atuais; Analytics e resumo semanal sinalizaram cobertura incompleta onde aplicável. Deduplicação, adiamento, dispensa e limpeza de sessão seguem cobertos pela homologação isolada existente; o ensaio real preservou os avisos e a sessão do proprietário.
