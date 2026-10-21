# Lastro — Hub Criativo

Etapas 01 e 02 implementadas: API privada, banco D1, coleta RSS/Atom e OpenAlex, triagem editorial e interface React para For You, Salvos, Oficina e estrutura honesta de Publicações. Identidade visual provisória; sem API paga de IA.

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

Abra `http://127.0.0.1:5173`. O servidor local encaminha `/api` ao Worker e acrescenta o token de `.dev.vars` apenas no processo de desenvolvimento. O navegador não recebe esse segredo. Mantenha os dois processos em execução. Em produção, a interface deverá ser servida no mesmo domínio protegido pela sessão Cloudflare Access.

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
- [Operação](docs/OPERATIONS.md): fontes, agendamento, credenciais e preparação futura de produção.
- [Validação](docs/VALIDATION.md): evidências e limites dos testes executados.
- [Interface — etapa 02](docs/STAGE_02.md): fluxos testados, limites de UX, dependências e próximo ciclo.

Contratos e cliente compartilhados: `packages/contracts/index.ts` e `packages/contracts/client.ts`. Implementação: `src/`. SQL versionado: `migrations/`.

Blog, newsletter, editor, identidade visual definitiva e envio de e-mails permanecem fora desta etapa. O deploy da aplicação privada depende de uma conta Cloudflare e da configuração de D1 e Access; veja [operação](docs/OPERATIONS.md).
