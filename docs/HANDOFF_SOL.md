# Handoff — SOL / frontend

## Escopo pronto

A API da etapa 01 está em `F:/lastro`, independente do portfólio. Estão disponíveis Radar/For You, busca, Salvos, notas, coleções simples, estados de leitura/descarte, seleção persistente da Oficina, pacotes e prompts. Não há frontend definitivo para preservar ou refazer. A recomendação é React/Vite para o app privado; não é necessário Next.js/SSR para consumir estes contratos.

O PDF de visão v1.0 é referência conceitual. A etapa 01 prevalece no escopo: não iniciar blog/newsletter/editor nem tocar no repositório do portfólio.

## Pastas

```text
src/                     API, autenticação, ingestão, qualidade, ranking, persistência
packages/contracts/      Zod, tipos TypeScript e cliente de API compartilhado
migrations/              SQL versionado D1/SQLite
tests/                   fixtures claramente sintéticas + regras/API/segurança
examples/                configurações de fontes RSS e OpenAlex reais
scripts/                 setup seguro e validação externa local opcional
docs/examples/           respostas capturadas da API real local
docs/                    API, arquitetura, algoritmos, operação e validação
.wrangler/state/         banco local persistente, ignorado pelo Git
.dev.vars                token local e segredos opcionais, ignorado pelo Git
```

Comandos na raiz: `npm ci`, `npm run setup`, `npm run db:migrate`, `npm run dev`. Verificação: `npm run verify`. Porta da API: 8787. Porta sugerida para Vite: 5173; a origem habilitada é `http://localhost:5173`. Se usar `127.0.0.1:5173`, atualizar `ALLOWED_ORIGIN` explicitamente. Não há comando de deploy automático.

## Contratos e consumo

Importar **tipos**, schemas e cliente de `packages/contracts/`, sem duplicar definições. Para um futuro `apps/web/src`, ajustar o caminho relativo ou criar um alias local apontando a essa pasta.

```ts
import {
  createLastroClient,
  LastroApiError,
} from "../../../packages/contracts/client";
import type { Content, FeedPage } from "../../../packages/contracts";

const api = createLastroClient({
  baseUrl: "http://127.0.0.1:8787",
  devToken: () => tokenDigitadoNaSessaoLocal,
});
const page: FeedPage = await api.feed({ limit: 20 });
await api.favorite(page.items[0].content.id);
await api.setSelection([page.items[0].content.id]);
const pack = await api.createPackage({
  format: "carousel",
  slides: 6,
  objective: "Relacionar as referências selecionadas",
  tone: "autoral e analítico",
  audience: "designers",
  notes: "",
});
const prompt = await api.prompt(pack.id);
// prompt.text pode ser copiado para uso manual; nada é publicado.
```

O identificador `tokenDigitadoNaSessaoLocal` acima é um valor a receber na sessão de desenvolvimento, não um segredo a incluir no build. `.dev.vars` contém `DEV_TOKEN`. Nunca copie esse token para um commit, arquivo público, exemplo ou bundle de produção. Em produção, cliente com `baseUrl:''`, sem `devToken`, usa a sessão Access no mesmo domínio; o Worker verifica o JWT. Usuário/email permitidos serão configuração externa.

Exemplos **reais**: [feed](examples/feed.json), [conteúdo](examples/content.json), [pacote](examples/researchPackage.json), [prompt](examples/prompt.json). Sua origem e contagens estão em [live-check](examples/live-check.json). Não usar esses arquivos como implementação do feed; consumir os endpoints.

Lista completa de endpoints/erros em [API.md](API.md). Os métodos do cliente cobrem todas as operações obrigatórias da integração. Administração e coleções simples podem usar `fetch` com os mesmos schemas e política de autenticação.

## Estados e comportamento

- `state.favorite`, `selected`, `seen`, `opened`, `read`, `dismissed`, `used` são independentes. Não derive todos de um único status. `used` depende de vínculos futuros de publicação; gerar pacote não significa publicar.
- `editorialStatus` é aprovação do conteúdo, não ação do usuário. Salvos preserva itens retirados do índice, com seus metadados; nova seleção/pacote pode recusar esses itens.
- Seleção é persistida por usuário; substituição completa via PUT com até 20 IDs. Debounce/serialização de atualizações no cliente evita que uma resposta antiga sobrescreva a seleção mais recente. A última escrita concluída prevalece.
- Criar deve aparecer contextualmente quando houver seleção. Ao iniciar, consultar `/workshop/selection`; não esvaziar a seleção ao trocar de página. Após gerar prompt, a API não a limpa automaticamente.
- Abrir URL original em nova aba, com `noopener noreferrer`; registrar `opened` não marca `read`. Respeitar a escolha explícita de leitura/descarte.
- Preservar cards, cursor e posição de rolagem no frontend ao voltar da fonte. O backend guarda sequência paginada por 30 minutos; não guarda pixels de scroll. Ao receber 410, avisar que a sequência foi atualizada.
- “Por que estou vendo?” usa `FeedItem.explanation` da própria resposta do feed. A rota de relevância é prévia individual: não reproduz a posição/diversidade da sequência completa.
- Não chamar `GET /feed` novamente a cada mudança de favorito: reutilizar a resposta de atualização e recarregar a sequência quando fizer sentido.
- Mostrar vazio quando ainda não houver conteúdos aprovados. Não preencher com resultados científicos inventados. Datas, autorias, resumos e licenças podem ser `null`/vazios.
- `access:'open'` é indicação do provedor, não confirmação de leitura integral. Exibir notas e limitações. Links não garantem leitura pelo ChatGPT/Gemini.
- Marcações de evidência/interpretação/hipótese podem coexistir. Não converter `kind:'paper'` em um selo de verdade científica.
- Renderizar títulos, descrições, notas e prompts como texto. Nunca usar `dangerouslySetInnerHTML` com metadados externos.

## Erros prioritários

Tratar 401 (sessão), 409 `empty_selection` (selecionar fonte), 404 (item indisponível), 410 (feed expirado), 429 (aguardar), 503 (configuração faltante) e erros de campo 400/422. `LastroApiError` expõe `status` e `body.error`; mostrar mensagem útil e preservar `requestId` para diagnóstico. Falha de coleta pode retornar 200 com `status:'failed'`; painéis administrativos precisam inspecionar o corpo.

## Não implementado / dependências futuras

Login visual local; editor de texto/rascunhos; publicação no blog; newsletter web/HTML e envio; uploads/R2; perfis de voz reutilizáveis; agrupamento semântico de notícias parecidas; recomendações por embeddings; classificação automática de afirmações; busca textual avançada; múltiplos usuários. O banco reserva `editorial_outputs`/`output_sources`, sem rotas que publiquem. A interface da Etapa 02 está em `apps/web`; veja [STAGE_02.md](STAGE_02.md) para implementação, verificação e limites.

A configuração externa de Cloudflare/D1/Access e domínio permanece pendente, sem deploy autorizado. OpenAlex funcionou na verificação sem chave; chave gratuita é opcional para uso maior, nunca colocada no frontend. Fontes e pesos ainda exigem calibração editorial real.
