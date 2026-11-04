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
