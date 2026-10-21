# Etapa 04.3 — identidade do portfólio e motion design

Implementação em 21/10/2026, sobre `master` no commit-base `aead4a0`. Publicada no [Lastro](https://lastro-api.marioserafim-da.workers.dev/) após autorização do proprietário.

## Referência inspecionada

O [portfólio profissional](https://mario-serafim-portfolio-2026.mario-92.chatgpt.site/) foi aberto no navegador. Foram lidos os estilos computados de elementos reais e as regras `:root` / `:root[data-theme="dark"]` das folhas `37442gtl53ldt.css` e `10a4kpxgtg7qu.css`.

| Token da referência | Claro     | Escuro    |
| ------------------- | --------- | --------- |
| Destaque            | `#e50914` | `#e50914` |
| Fundo               | `#f8f9fa` | `#121212` |
| Superfície          | `#faf9f6` | `#1a1a1a` |
| Texto               | `#212529` | `#f3f4f6` |
| Texto secundário    | `#4b5563` | `#adb5bd` |
| Regra / borda       | `#e5e7eb` | `#333`    |

A aplicação usa o vermelho exato de identidade, os fundos/textos medidos e superfícies neutras adequadas aos cards. Texto vermelho pequeno usa variações de maior contraste (`#ff737b` no escuro e `#c50710` no claro). Preto e branco dominam a área; vermelho aparece na assinatura, seleção, foco, ações principais e descobertas. Os verdes antigos foram substituídos por tokens semânticos em toda a folha, inclusive estados, formulários e modais. As cores de sucesso verdes do portfólio não foram copiadas.

## Temas e preferências

Escuro é o padrão. O botão Claro/Escuro funciona na aplicação e no login, com preferência persistida em `lastro:theme`. A configuração de movimento oferece completa, reduzida e desativada em `lastro:motion`; `prefers-reduced-motion` sempre prevalece sobre movimento completo. Sem acesso a localStorage, os controles continuam funcionando em memória. Nenhum serviço externo recebe essas preferências.

`Appearance.tsx` aplica tema, intensidade efetiva e a cor do navegador. Não há nova biblioteca de animação.

## Jarvis e aproveitamento do espaço

A coluna permanente de 252 pixels foi removida. Cards ocupam a largura liberada. O botão orbital fica no canto inferior direito de uma faixa de 76 pixels reservada à navegação contextual. O conteúdo possui sua própria área de rolagem, terminando antes da faixa: o botão e a seleção não ficam sobre cards ou formulários.

No desktop, o painel lateral só reserva largura enquanto está aberto. No tablet/celular, funciona como uma folha inferior; a área de leitura diminui para terminar antes dela. Não é necessário dispensar o assistente para acessar um controle coberto. O estado fechado devolve esse espaço ao conteúdo. Fechar com Escape ou pelo botão restaura o foco ao acionador.

O símbolo combina núcleo, halo e duas órbitas com pontos de conexão. Em intensidade completa, órbitas giram em 18 e 26 segundos e o núcleo respira em quatro segundos. Hover reage em 320 ms. O ponto de sugestão só aparece quando existe uma oferta real. Balão e painel têm entrada e saída curtas. Sugestões continuam limitadas, dispensáveis e baseadas em regras; desativação e minimização foram preservadas.

## Linguagem de movimento

- Navegação: transição nativa de visualização quando disponível, entrada do título e indicador ativo animado. Sem suporte a View Transitions, a navegação continua funcional com as entradas CSS.
- Cards: entrada editorial de 420 ms, metadados com atraso curto e escalonado limitado a 90 ms. Hover desloca três pixels; favoritos e seleção têm confirmação visual.
- Grid/lista: movimento por diferença de posições com Web Animations API, durante 280 ms, apenas nos elementos visíveis antes/depois. Os cards permanecem recortados pela área de conteúdo; não são promovidos a snapshots individuais que poderiam atravessar a faixa inferior durante a transição.
- Pulso: barras com confirmação de ação real e movimento distinto durante carregamento. O carregamento só aparece enquanto a requisição está pendente. Não representa coleta, agendamento nem atualização inventados.
- Surpreenda-me: mantém a seleção de conteúdo aprovado elegível, desloca a leitura até o item, aplica destaque vermelho por 1,9 segundo e depois remove esse estado. O foco acessível permanece no card. Em movimento reduzido/desativado, há destaque estático e deslocamento instantâneo.
- Oficina: formatos reagem à escolha; parâmetros complementares entram ao expandir; configuração e resultado possuem entradas próprias. A geração continua usando a API de prompts existente.

Movimento reduzido elimina órbitas, deslocamentos e transições de layout, permitindo apenas revelação curta por opacidade quando a redução foi escolhida no aplicativo. A preferência de redução do sistema elimina também essa animação. Desativado elimina animações e transições. Nenhuma animação bloqueia o clique nem produz som.

## Menus refinados

Atendendo ao refinamento adicional solicitado, `Select.tsx` substitui os menus do sistema operacional em Assunto, Fonte, Formato, Aparência, linguagem da Oficina, coleções e formulários da Curadoria.

O componente apresenta borda discreta, opções espaçadas, seleção com marca vermelha, menu rolável e posição calculada a partir do campo, incluindo abertura para cima quando necessário. Os rótulos visíveis dos assuntos estão em português; os valores enviados à API permanecem iguais.

A interação usa combobox/listbox, `aria-expanded`, `aria-activedescendant` e opções selecionadas. Teclas direcionais, início/fim, Enter, Escape, Tab e busca por digitação são suportadas. Clique fora fecha o menu. O foco permanece no campo ao selecionar ou dispensar. O menu se mantém dentro da largura e altura disponíveis, inclusive a 390 pixels.

## Validação e evidências

A suíte usa Chrome instalado, Vite isolado na porta 5175 e fixtures interceptadas somente nos testes. Não grava exemplos no banco pessoal nem em produção. Os cenários existentes de login, favoritos, leitura, coleções, notas, seleção, prompt, curadoria, busca, falha de rede e paginação continuam na suíte.

Testes adicionais verificam: temas e persistência, tokens de cor medidos, ausência de tons verdes nos estilos computados visíveis, contraste dos tokens de texto/superfície, evolução temporal da transformação orbital, intensidade desativada sem animações em execução, preferência do sistema, destaque temporário da descoberta, posição do Jarvis sem interseção com conteúdo/seleção, foco após Escape, recorte durante reorganização dos cards, menus por teclado e posição responsiva, além de preservação de rolagem nas navegações e no histórico.

Resoluções verificadas: 1440×900, 1366×768, 768×1024 e 390×844; posicionamento específico do Jarvis também em larguras 1440, 768 e 390. A conferência de contraste cobre tokens representativos; não substitui auditoria WCAG com leitor de tela.

### Demonstração em movimento

[Assistir à demonstração WebM](examples/stage04-3-motion.webm).

A gravação mostra entrada do Radar, hover, favoritos e seleção, navegação por Salvos/Oficina, Jarvis em movimento e abrindo/fechando, Surpreenda-me, menu de assuntos, alternância claro/escuro e grid/lista. Os conteúdos com TESTE são fixtures isoladas e estão identificados como tais; não são matérias publicadas. Trata-se da aplicação executando as interações reais, não de um mockup animado.

Para reproduzir a captura no PowerShell, a partir da raiz:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.wrangler/playwright"
.\lastro.cmd exec -- playwright install ffmpeg
$env:LASTRO_RECORD_DEMO = "1"
.\lastro.cmd run test:ui
```

FFmpeg/Winldd do Playwright foram baixados somente em `.wrangler/playwright`. Não foram adicionadas ferramentas globais nem dependências de produção. Em outro ambiente, `npm run test:ui` executa os testes funcionais e deixa apenas a captura opt-in sem execução; com a variável acima, ela também é verificada.

Capturas complementares:

- [Desktop escuro](examples/stage04-3-1440-dark.png)
- [Desktop claro](examples/stage04-3-1440-light.png)
- [Mobile escuro](examples/stage04-3-390-dark.png)
- [Menu refinado](examples/stage04-3-menu-dark.png)

## Limites e preservação

Autenticação, ranking, ingestão, D1, migrações e contratos HTTP não foram alterados. Não há Gemini, novas fontes, coleta automática, analytics ou dados fictícios no aplicativo real. O banco local continua vazio; as evidências de volume são exclusivamente testes. A gravação está em WebM, reproduzível em navegadores modernos, sem trilha de áudio.

O comportamento de motion foi validado em Chrome neste computador; não houve matriz completa de navegadores ou medição de desempenho em celulares físicos. Os efeitos usam CSS/SVG, View Transitions com fallback e Web Animations, com quantidade de elementos animados limitada.

## Resultado final executado

| Verificação                               | Resultado                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run verify`                          | Aprovado: tipagem API/frontend, 23 testes de regras/API, build Vite e Worker somente em dry-run |
| `npm run format:check`                    | Aprovado                                                                                        |
| `npm run test:ui` com gravação habilitada | 20 testes aprovados; zero falhas e zero testes omitidos nessa execução                          |
| Vídeo                                     | WebM VP9, 1440×900, 25 fps, 20,04 segundos, 6.315.930 bytes                                     |
| Build frontend                            | JavaScript 386,11 kB (116,75 kB gzip); CSS 40,69 kB (8,31 kB gzip)                              |
| Backend, contratos e banco                | Sem alterações                                                                                  |
| Publicação                                | Worker `lastro-api`, versão `025c41cf-2029-4743-b6c4-69a254daa8d9`                              |

O novo build não acrescenta dependências de produção. O deploy aplicou a configuração existente `wrangler.production.jsonc`, com `INGEST_ENABLED=false`, sem migrações. Após a publicação, `/`, `/health` e o CSS da versão responderam 200; `/api/feed` sem autenticação continuou respondendo 401. O HTML servido aponta para `index-DHBZs2uJ.js` e `index-W4YZ5_eI.css` da versão testada. As capturas e o vídeo permanecem no repositório como evidência, e os servidores locais continuam em 127.0.0.1:5173 (frontend) e 127.0.0.1:8787 (API).
