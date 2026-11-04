# Jarvis-Brain 1.0 — handoff

Base: `b23016ef5a7c98b5764cb2cd215af437c78fe3cf`. Branch: `codex/jarvis-brain-01`.

Memória seletiva em `jarvis_brain`, separada da memória operacional. Busca limitada a 256 registros, Fuse.js existente, filtros, origem, natureza e datas. Propostas exigem aprovação específica; pedidos explícitos podem confirmar diretamente. Correção e exclusão usam versão; gravação pelo chat e revisão da conversa compartilham transação D1. Exclusões exigem ID digitado. Contradições são apresentadas como registros históricos; não há resolução automática nem inferência de projeto. A interface permite atribuir projeto e palavras-chave explicitamente.

A migration aditiva `0013_jarvis_brain.sql` foi validada somente em bancos efêmeros de testes. Nenhuma migration remota, deploy definitivo, credencial real ou documento pessoal foi acessado. A interface deve receber essa migration antes de uma futura publicação.

Drive implementado como adaptador manual, **desativado por padrão e ainda não homologado com conta real**. Arquiva JSON das memórias confirmadas selecionadas; não importa arquivos pessoais nem varre o Drive. Cria apenas a raiz privada e `Memórias` quando necessárias. IDs pré-alocados, versões, lease, ETag e estados pendente/erro permitem repetição após escrita parcial. D1 continua independente. Não há Cron novo, Worker novo, dependência nova ou IA.

Configuração futura, em ambiente HTTPS isolado e com conta do proprietário:

- Secrets exclusivos: `BRAIN_DRIVE_CLIENT_ID`, `BRAIN_DRIVE_CLIENT_SECRET`, `BRAIN_DRIVE_TOKEN_KEY` (32 bytes aleatórios em base64). Jamais reutilizar GA4.
- `OWNER_EMAIL`, `ALLOWED_ORIGIN` e `BRAIN_DRIVE_REDIRECT_URI` exatamente `<origem>/api/jarvis/drive/oauth/callback`.
- Escopos: `drive.file`, `openid`, `email`. State de dez minutos, nonce HttpOnly, PKCE, validação do e-mail verificado. Refresh token cifrado AES-GCM em D1; chave exclusivamente em Secret; access token apenas em memória.
- Antes de habilitar `BRAIN_DRIVE_ENABLED=true` e `BRAIN_DRIVE_FREE_CONFIRMED=true`, verificar Billing desativado, armazenamento contratado disponível, plano e consumo compartilhado Cloudflare e quotas reais do projeto. Esses dados da conta não foram verificados. Sem essa evidência, manter desativado.
- Testar consentimento, salvar uma memória sintética, ler e comparar JSON, corrigir/repetir, remover documento com ID e revogar. Não usar documentos de clientes.

Limites locais: 400 reservas/dia UTC compartilhadas entre memória e chamadas externas; até 2 MiB/dia de resposta reservada, 32 KiB por resposta e 8 segundos por chamada. Sem retentativa automática; 401/403/429 impõem espera. Os limites locais não medem consumo de outros sistemas da conta.

Fontes oficiais consultadas em 04/11/2026: [escopos](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [quotas e cobrança](https://developers.google.com/workspace/drive/api/guides/limits), [expiração OAuth](https://developers.google.com/identity/protocols/oauth2), [D1](https://developers.cloudflare.com/d1/platform/pricing/). Consentimento externo em Testing expira em sete dias; autorização offline pode ser revogada/expirar também em produção. A documentação do Drive anuncia mudanças de cobrança em 2026: não pressupor gratuidade permanente.

Backup de código completo verificado: `.codex-local-tools/backups/lastro-before-brain.bundle` (local, fora do Git). Produção não foi consultada; backup remoto D1 não foi criado. Antes de uma publicação futura, exportar o D1 pelo procedimento existente. Rollback: voltar ao commit base e manter as tabelas aditivas; não apagar memórias nem documentos. Desativar o Drive impede novas operações; a revogação explícita deve anteceder a desativação quando necessária.

Validação: `npm run verify`; testes direcionados do Jarvis e Playwright de gerenciamento de memória. Escritas OAuth/Drive exclusivamente com mocks. Custo incremental desta execução: R$ 0.
