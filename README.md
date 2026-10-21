# Lastro — Hub Criativo

Aplicação privada online: [Abrir o Lastro](https://lastro-api.marioserafim-da.workers.dev). A senha inicial foi salva apenas no computador do proprietário, em `C:\Users\pc mario\Documents\Lastro-acesso-privado.txt`; nunca no Git. A produção usa um banco D1 próprio e começa sem itens até a revisão editorial de fontes e conteúdos.

Etapas 01, 02 e 03 implementadas: API privada, banco D1, coleta RSS/Atom e OpenAlex, For You, Salvos, Oficina e painel de Curadoria com fontes, revisão e histórico. A Etapa 03 foi validada localmente com artigos reais; sua publicação e primeira ingestão remota aguardam autorização específica do proprietário. Identidade visual provisória; sem API paga de IA.

## Executar localmente

Requisito: Node.js 22 ou superior (validado com Node 24 no Windows). Na pasta do projeto:

```powershell
npm ci
npm run setup
npm run db:migrate
npm run dev
```

Em outro terminal, inicie a interface:

```powershell
npm run web:dev
```

Abra `http://127.0.0.1:5173`. O servidor local encaminha `/api` ao Worker e acrescenta o token de `.dev.vars` apenas no processo de desenvolvimento. O navegador não recebe esse segredo. Mantenha os dois processos em execução. Em produção, a interface e API são servidas no mesmo domínio; os dados são protegidos pelo login privado por senha.

API em `http://127.0.0.1:8787`. Apenas `/health` é público. `npm run setup` cria `.dev.vars` com token aleatório, ignorado pelo Git, sem substituir configurações existentes. O banco persiste em `.wrangler/state`; não apague essa pasta para “reiniciar” o servidor.

Em outro terminal PowerShell:

```powershell
$lastroToken = ((Get-Content .dev.vars | Where-Object { $_ -like 'DEV_TOKEN=*' }) -split '=', 2)[1]
$lastroHeaders = @{ Authorization = "Bearer $lastroToken" }
Invoke-RestMethod http://127.0.0.1:8787/api/feed -Headers $lastroHeaders
```

Em uma instalação limpa, o feed começa vazio. Isso é esperado: fontes precisam ser cadastradas e aprovadas, e conteúdos precisam passar pela triagem. Veja o fluxo em [docs/API.md](docs/API.md). Os arquivos em `examples/` são configurações de fontes reais, sem aprovação automática. As fixtures sintéticas ficam exclusivamente em `tests/`.

## Verificação

```powershell
npm run verify
```

Executa tipagem da API e interface, testes automatizados com D1 local e builds sem publicar. Os testes não dependem da internet e não alteram seu banco de desenvolvimento. `npm run build` usa exclusivamente `--dry-run`.

Verificação externa opcional, com `npm run dev` em execução:

```powershell
node scripts/live-check.mjs
```

Esse script cadastra/aprova duas fontes de metadados no banco **local**, realiza um lote por conector e demonstra aprovação de um item RSS, feed, favoritos, seleção, pacote e prompt. Preserva a seleção anterior e desfaz o favorito temporário. Guarda respostas reais em `docs/examples/`. Cria histórico de revisão e um pacote de demonstração; não verifica o texto integral nem a qualidade científica. Em repetições, fontes ainda dentro do intervalo ou sem novos itens podem não oferecer outro candidato para a demonstração. Não substitui a suíte determinística.

## Documentação

- [Handoff para SOL](docs/HANDOFF_SOL.md): integração frontend e estados.
- [API](docs/API.md): rotas, entradas, respostas e erros.
- [Arquitetura](docs/ARCHITECTURE.md): decisões e limites.
- [Algoritmos](docs/ALGORITHMS.md): triagem, pontuação, ranking e calibração.
- [Operação](docs/OPERATIONS.md): fontes, agendamento, credenciais e publicação de produção.
- [Validação](docs/VALIDATION.md): evidências e limites dos testes executados.
- [Interface — etapa 02](docs/STAGE_02.md): fluxos testados, limites de UX, dependências e próximo ciclo.
- [Radar Vivo — etapa 03](docs/STAGE_03.md): Curadoria, ingestão real local e ativação pendente de produção.
- [Catálogo de fontes](docs/SOURCES.md): oito integrações verificadas, três sugestões e configurações reutilizáveis.

Contratos e cliente compartilhados: `packages/contracts/index.ts` e `packages/contracts/client.ts`. Implementação: `src/`. SQL versionado: `migrations/`.

Blog, newsletter, editor, identidade visual definitiva e envio de e-mails permanecem fora desta etapa. A produção usa login privado por senha, sem Cloudflare Zero Trust; veja [operação](docs/OPERATIONS.md).
