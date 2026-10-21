# Operação e limites

## Ambiente local

`npm run dev` mantém o servidor em loopback; `npm run db:migrate` aplica apenas migrações locais. Reiniciar o servidor preserva `.wrangler/state`. `npm run setup` é idempotente e não imprime o segredo. Para rotacionar o token, substituir `DEV_TOKEN` em `.dev.vars` por 32 bytes aleatórios em hexadecimal e reiniciar o servidor. `.dev.vars`, `.env*`, banco e build estão ignorados pelo Git.

Variáveis:

| Nome                    | Uso                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`           | `development` apenas em loopback; configuração versionada usa `production`                   |
| `DEV_TOKEN`             | token aleatório local, mínimo 32 caracteres                                                  |
| `ALLOWED_ORIGIN`        | origem exata do frontend; local padrão `http://127.0.0.1:5173`                               |
| `ALLOWED_FETCH_HOSTS`   | hosts externos exatos separados por vírgula; sem IPs, curingas, localhost ou domínio privado |
| `INGEST_ENABLED`        | cron só coleta se `true`; configuração versionada `false`, setup local `true`                |
| `OPENALEX_API_KEY`      | segredo opcional; Bearer exclusivamente para `api.openalex.org/works`                        |
| `ACCESS_TEAM_DOMAIN`    | emissor de produção, como `sua-equipe.cloudflareaccess.com`                                  |
| `ACCESS_AUD`            | audience da aplicação protegida                                                              |
| `OWNER_EMAIL`           | email exato do único proprietário autorizado                                                 |
| `OWNER_PASSWORD_SHA256` | hash SHA-256 da senha aleatória de alta entropia; segredo de produção                        |
| `SESSION_SIGNING_KEY`   | chave HMAC aleatória de 32 bytes em base64url; segredo de produção                           |

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

## Publicação privada

Em 20/10/2026, o Worker `lastro-api` foi publicado em `https://lastro-api.marioserafim-da.workers.dev`, na conta Cloudflare do proprietário. O banco D1 `lastro` recebeu as migrações `0001` e `0002`. `wrangler.production.jsonc` contém apenas IDs e parâmetros não secretos; o desenvolvimento local continua em `wrangler.jsonc`. Previews de implantação estão desativados.

O login de produção usa senha aleatória de 192 bits, enviada somente por HTTPS. O Worker guarda apenas o hash SHA-256 como segredo Cloudflare, limita tentativas a cinco por IP em 15 minutos e emite cookie de sete dias assinado por HMAC, `HttpOnly`, `Secure` e `SameSite=Strict`. A chave de assinatura é outro segredo. A interface e seu código estático podem ser carregados sem login, mas todas as rotas de dados em `/api/*` exigem sessão; `/health` e as rotas de autenticação são públicas. A senha inicial está somente em `C:\Users\pc mario\Documents\Lastro-acesso-privado.txt`, fora do repositório. Trate esse arquivo como credencial e não o compartilhe. A sessão assinada pode ser revogada globalmente rotacionando `SESSION_SIGNING_KEY`; ao trocar a senha, atualizar o hash em `OWNER_PASSWORD_SHA256`, rotacionar também a chave de sessão e entregar a nova senha ao proprietário por canal privado.

Cloudflare Zero Trust não foi ativado: o cadastro do plano gratuito exigia cartão, aceite dos termos e autorização de cobrança de excedentes. A alternativa por senha foi escolhida pelo proprietário. O código conserva suporte opcional a Access JWT, mas ele não está configurado na produção atual.

Para nova versão: executar `npm run db:migrate:production` somente se houver migrações novas, depois `npm run deploy:production`. O comando roda testes e build antes de publicar. Não copiar `.dev.vars` ou o banco local para produção. O D1 remoto inicia vazio; fontes e conteúdos locais usados para validação da interface não receberam aprovação editorial para produção. O cron está instalado, mas `INGEST_ENABLED=false` impede coleta automática até aprovação de fontes, direitos, quotas e volumes.

Verificação pós-publicação: a página inicial responde 200 com formulário de senha; `/api/auth/session` sem cookie indica `authenticated:false`; `/api/feed` sem cookie responde 401; login correto cria cookie protegido e permite sessão e feed. Essas verificações passaram no primeiro deploy. Favoritos, Oficina e prompt foram validados no ambiente local com conteúdo real de metadados, mas ainda não foram repetidos no D1 remoto vazio. Fazer backup remoto antes de mudanças de esquema ou ingestão expressiva; backups e retenção de longo prazo ainda precisam de política operacional.

Os arquivos estáticos de `dist/web` acompanham o Worker. As rotas `/api/*` e `/health` executam o Worker primeiro, e as rotas da interface usam o fallback de SPA. Essa configuração segue a [documentação oficial de SPA em Workers](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/). A senha e a chave de sessão não aparecem na configuração versionada nem nos logs da aplicação.

Chave OpenAlex é opcional para consulta básica, conforme [documentação oficial](https://help.openalex.org/api/authentication/); o teste externo desta entrega funcionou sem chave. A licença CC0 dos metadados não é uma licença universal dos artigos. Conector preserva licença/acesso declarados, sem baixar textos integrais.
