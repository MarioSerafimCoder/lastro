# Operação e limites

## Ambiente local

`npm run dev` mantém o servidor em loopback; `npm run db:migrate` aplica apenas migrações locais. Reiniciar o servidor preserva `.wrangler/state`. `npm run setup` é idempotente e não imprime o segredo. Para rotacionar o token, substituir `DEV_TOKEN` em `.dev.vars` por 32 bytes aleatórios em hexadecimal e reiniciar o servidor. `.dev.vars`, `.env*`, banco e build estão ignorados pelo Git.

Variáveis:

| Nome                  | Uso                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`         | `development` apenas em loopback; configuração versionada usa `production`                   |
| `DEV_TOKEN`           | token aleatório local, mínimo 32 caracteres                                                  |
| `ALLOWED_ORIGIN`      | origem exata do frontend; local padrão `http://127.0.0.1:5173`                               |
| `ALLOWED_FETCH_HOSTS` | hosts externos exatos separados por vírgula; sem IPs, curingas, localhost ou domínio privado |
| `INGEST_ENABLED`      | cron só coleta se `true`; configuração versionada `false`, setup local `true`                |
| `OPENALEX_API_KEY`    | segredo opcional; Bearer exclusivamente para `api.openalex.org/works`                        |
| `ACCESS_TEAM_DOMAIN`  | emissor de produção, como `sua-equipe.cloudflareaccess.com`                                  |
| `ACCESS_AUD`          | audience da aplicação protegida                                                              |
| `OWNER_EMAIL`         | email exato do único proprietário autorizado                                                 |

A allowlist é controlada pelo operador, nunca pelo cadastro de fonte via API. Não colocar tokens na URL de uma fonte. Não cadastrar hosts arbitrários/redelegáveis; URLs devem ser públicas e autorizadas. Redirects são registrados como erro: configurar a URL pública final verificada, sem seguir cegamente o destino. Não há descoberta automática de feeds nesta versão.

## Cron e fila

O cron configurado é a cada 15 minutos, processando uma fonte e duas entradas por invocação. Fonte com fila restante não faz outra chamada externa. Uma fonte limpa respeita seu `intervalMinutes`; a configuração do exemplo OpenAlex usa 24 horas. RSS/OpenAlex pegam no máximo a primeira página recente de 25 itens; não há backfill nem promessa de cobertura de fontes que publiquem mais do que essa janela entre coletas.

`npm run dev -- --test-scheduled` já está incorporado no script. Para disparar localmente, usar o endpoint de simulação do Wrangler:

```powershell
Invoke-WebRequest 'http://127.0.0.1:8787/__scheduled?cron=*/15+*+*+*+*'
```

Esse endpoint pertence ao simulador local e não é rota da aplicação. Para controle granular, usar `/api/admin/sources/:id/ingest`, autenticado, sem ignorar o intervalo. Execuções têm lease por fonte de 5 minutos. Após interrupção, uma nova execução marca a anterior como interrompida; itens persistidos não são duplicados. Fila é removida somente após processamento; retomada pode registrar duplicata de um item já salvo antes da interrupção, preservando o conteúdo único.

## Custos e retenção

Sem serviço pago obrigatório e sem conta necessária para desenvolver. Lotes pequenos limitam as consultas por invocação; há teste de orçamento de até 50 consultas para ingestão. [Limites D1](https://developers.cloudflare.com/d1/platform/limits/) também incluem CPU, armazenamento, leitura e escrita diários: validar o volume real antes de produção, sem habilitar cobrança automaticamente. O teste de consultas não comprova consumo de CPU ou quota diária de uma conta real.

Snapshots de feed expiram em 30 minutos e são removidos no cron; contadores por minuto também são limpos. Conteúdos, metadados, auditoria, interações, pacotes e prompts são mantidos até decisão editorial posterior. Não há limpeza destrutiva silenciosa. A política de retenção de longo prazo deve ser ajustada ao crescimento do banco. Importação histórica e exclusão automatizada não estão implementadas.

Exportação portável inicial: listagem paginada de Salvos com metadados/notas e GET dos pacotes em JSON. Backup integral local antes de mudanças relevantes pode ser obtido por `npx wrangler d1 export DB --local --output backup.sql`; contém dados pessoais, não versionar o arquivo. Usar um nome fora do repositório ou adicioná-lo ao ignore. Em produção futura, definir backup/retention próprios da conta antes de ativar coleta.

## Publicação privada — pendente de conta Cloudflare

1. Criar ou conectar uma conta Cloudflare e autenticar o Wrangler. A verificação em 20/10/2026 informou que ainda não havia sessão Cloudflare neste computador. Sem conta não é possível criar D1, Access ou publicar o Worker privado.
2. Criar banco D1 remoto, substituir o UUID fictício e nome local em configuração de produção, e aplicar as migrações remotas. O banco local não é copiado automaticamente. Decidir se os artigos aprovados localmente devem ou não ser importados após uma revisão editorial real.
3. Proteger **o Worker inteiro** pelo Cloudflare Access antes de expor um hostname, incluindo frontend e API. Pode-se usar um hostname `workers.dev` protegido por Access sem domínio próprio, se a conta permitir; não ativar uma URL pública desprotegida. Definir política de um proprietário, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_EMAIL` e origem HTTPS final. O Worker valida assinatura RS256, expiração, emissor, audience e email; confiar só no header de email é insuficiente.
4. Configurar segredos fora do Git; não copiar `.dev.vars` para um bundle. Manter `ENVIRONMENT=production`. A configuração versionada mantém `workers_dev` e previews desabilitados até a proteção estar pronta. Substituir `ALLOWED_ORIGIN` local pelo hostname HTTPS final.
5. Fazer `npm run verify`, publicar e conferir login, feed, favorito, seleção, pacote, prompt e ausência de acesso anônimo. Habilitar `INGEST_ENABLED` somente depois de verificar fontes, direitos, quotas e volumes. O comando de deploy não faz parte de `npm run verify`.

Os arquivos estáticos de `dist/web` acompanham o Worker. As rotas `/api/*` e `/health` executam o Worker primeiro, e as rotas da interface usam o fallback de SPA. Essa configuração segue a [documentação oficial de SPA em Workers](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) e a [proteção de Workers pelo Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/). A autorização para publicar foi dada na Etapa 02; falta a conta e sua configuração, não uma nova aprovação do projeto.

Chave OpenAlex é opcional para consulta básica, conforme [documentação oficial](https://help.openalex.org/api/authentication/); o teste externo desta entrega funcionou sem chave. A licença CC0 dos metadados não é uma licença universal dos artigos. Conector preserva licença/acesso declarados, sem baixar textos integrais.
