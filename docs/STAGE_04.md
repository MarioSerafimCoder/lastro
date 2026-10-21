# Etapa 04 — Lastro Vivo e Jarvis

Implementação em 21/10/2026 sobre `master`, base `c9db59d`. Publicação autorizada pelo proprietário na solicitação desta etapa.

## Experiência e decisões

A experiência diária passa de uma landing page para um espaço de trabalho. Navegação lateral no desktop, menu compacto no celular, título curto, busca e filtros antes das referências. Cards tipográficos substituem as capas gráficas sem metadados de imagem. Fonte, autoria, data, formato, idioma, assuntos, descrição autorizada, leitura, favorito e seleção continuam disponíveis. Assuntos são atalhos para a busca real. Grid e lista oferecem duas densidades de leitura.

O Radar carrega 12 itens inicialmente e permite continuar pela paginação existente. Navegar entre áreas preserva cards e cursor do feed; posição de rolagem é mantida nas navegações internas. A opção Atualizar renova explicitamente a sequência. Atualizações da Curadoria invalidam o Radar no próximo retorno. Busca usa o servidor, com debounce e proteção contra respostas de consultas antigas. Links externos continuam abrindo em nova aba.

Radar Diário · artigos e Radar Científico · pesquisas são recortes por `kind` da API atual. Não representam programação diária/mensal nem mudam a ingestão. Surpreenda-me escolhe entre os aprovados elegíveis já carregados, exclui descartados/retratados e evita repetir quando há alternativa. Não é busca semântica, descoberta global nem julgamento científico.

Salvos mantém coleções, notas e leitura independentes da seleção. A Oficina apresenta formato e objetivo primeiro, com linguagem, público e contexto em um bloco expansível. Pacote, prompt, cópia e abertura manual do ChatGPT/Gemini usam os fluxos existentes. Curadoria apresenta métricas operacionais reais e conserva Fontes, Fila e Histórico, correções e decisões justificadas. Publicações segue honestamente em preparação, com acesso à Oficina.

## Sistema visual

Tokens em `apps/web/src/styles.css`: fundo neutro `#f5f6f2`, superfície branca, texto `#24302e`, texto secundário `#596861`, borda `#dce2db`, destaque verde `#265d4b` e verde claro `#d2efbc`. Tipografia de sistema, sem chamadas a fontes externas. Escala espacial de 4, 8, 12, 16, 24 e 32 pixels; bordas de 1 pixel e raio de 6 pixels. Títulos de área de 24–31 pixels; cards de 18–21 pixels. Elevação limitada à barra contextual e modais. Cores e tipografia não dependem de imagens geradas.

As referências solicitadas foram consultadas pelas páginas oficiais: [Linear](https://linear.app), [Readwise Reader](https://readwise.io/read), [Are.na](https://www.are.na) e [Feedly](https://feedly.com). A síntese aplicada ao Lastro prioriza precisão de hierarquia, leitura, organização em coleções e navegação entre referências; não replica suas identidades.

## Movimento e Pulso

Transições de 180 ms para cores, bordas e estados; entrada discreta de painéis/cards, feedback de favorito e seleção, skeleton somente durante carregamento. Não há animação ambiente contínua do Jarvis, som, contagem inventada ou cron simulado. `prefers-reduced-motion` remove animações e transições; deslocamentos programáticos também respeitam a preferência.

Pulso é um símbolo de três traços, acompanhado de texto acessível em uma linha reservada do cabeçalho. Confirma carregamento e ações concluídas (favoritos, seleção persistida, nota, coleção, atualização da Curadoria e prompt). Erros continuam explícitos. A linha não flutua sobre os cards e não afirma coleta em andamento.

## Jarvis

- Identidade própria em SVG: núcleo, órbita e ponto de conexão, sem personagem ou referência cinematográfica.
- Painel lateral no desktop e bloco no fluxo em tablet/mobile, sem sobrepor cards, navegação, formulários ou seleção.
- Radar com itens elegíveis: descoberta entre referências carregadas.
- Duas ou mais referências selecionadas: convite para combiná-las na Oficina, sem alegar relação semântica.
- Salvos com itens: foco no campo de nova coleção.
- Oficina com seleção: foco nos formatos; sem seleção: retorno ao Radar.
- Curadoria com candidatos: quantidade real e acesso à fila. Não inventa contagens quando o painel não foi carregado.
- Uma oferta espontânea por sessão/aba, somente no Radar com conteúdo; dispensável e removida ao sair do Radar. Nunca abre o painel automaticamente.
- Sugestões espontâneas podem ser desmarcadas. Jarvis inteiro pode ser desativado e reativado explicitamente. Preferências persistem em localStorage; a oferta da sessão usa sessionStorage. Se o navegador bloquear armazenamento, o estado funciona em memória durante a montagem atual.

## Componentes e extensão

- `ReferenceCards.tsx`: cards, ações e filtros reutilizáveis, extraídos de App.
- `Jarvis.tsx`: visual, abertura, minimização, preferências e oferta discreta.
- `experience.ts`: regras de sugestões, elegibilidade e seleção de descoberta, tipo de sugestão extensível e apresentação editorial futura.
- `Pulso.tsx`: feedback acessível associado a atividades reais.
- `useDialogFocus.ts`: foco inicial, ciclo de Tab e restauração para painéis de seleção/notas; Escape continua disponível.
- `App.tsx`: orquestração e fluxos existentes; `Curation.tsx`: métricas e integração contextual.

A apresentação editorial distingue título original, idioma, status de tradução e limitações. Hoje a tradução está indisponível; não é simulada. Um futuro provedor de inteligência poderá produzir o mesmo tipo interno de sugestão. Não foram alterados contratos HTTP, ranking, autenticação, SQL ou conectores.

## Testes e evidências

`npm run verify`: tipagem de API/frontend, 23 testes determinísticos e builds Vite/Worker em dry-run. `npm run format:check`: formatação. `npm run test:ui`: suíte Playwright/Chrome com API interceptada e fixtures explicitamente sintéticas, sem gravar no D1 local ou remoto. Playwright é a única dependência nova, apenas de desenvolvimento. Usa Chrome instalado e um Vite isolado na porta 5175. Traces e resultados temporários ficam em `.wrangler/ui-results`.

A suíte de interface cobre 2, 12, 24 e 100 referências, paginação, preservação de feed/cursor, descoberta, favoritos, leitura, coleções, notas, seleção, prompt, login simulado, falha de rede, busca, filtros, Jarvis, minimização/desativação, persistência de preferência, teclado, movimento reduzido e ausência de rolagem horizontal. Os tamanhos testados são 1440×900, 1366×768, 768×1024 e 390×844, incluindo navegação das áreas. Os testes da API usam D1 isolado e verificam os contratos reais; as interceptações da interface não substituem essa suíte.

Capturas de teste, identificadas com TESTE e sem conteúdo fictício no aplicativo real:

- [Desktop 1440×900](examples/stage04-1440.png)
- [Mobile 390×844](examples/stage04-390.png)

O navegador também conferiu o aplicativo local com seu banco vazio real. Auditoria formal de WCAG, leitor de tela e comparação visual automatizada por pixel não foram realizadas. O login privado real continua protegido; não foram copiadas senhas de produção para os testes.

## Limitações e próximas etapas

04.1: ampliar o catálogo e a quantidade real de referências, decidir as frequências de coleta diária/científica e calibrar cobertura. Esta entrega não cadastra fontes nem habilita agendamento remoto.

04.2: Lastro Intelligence, traduções e sugestões baseadas em modelos dependerão de integração e credenciais futuras. Jarvis nesta entrega funciona somente com regras e dados verificáveis.

Etapa 05: CMS e newsletter. Não há publicação editorial integrada nesta etapa.

Filtros de coleções continuam limitados aos itens carregados porque o contrato atual não oferece busca no servidor para uma coleção. A lista de assuntos é a existente. A sequência de feed expira conforme o backend e continua tratando 410. Não foi alterada a política de aprovação editorial.

## Publicação

Configuração de produção preservada: `wrangler.production.jsonc`, Worker `lastro-api`, D1 existente, autenticação e `INGEST_ENABLED=false`. Nenhuma migração nova é necessária. A publicação substitui código/arquivos estáticos, sem importar dados de teste. Versão anterior registrada para eventual retorno: `3684db6e-c025-432e-95d0-80dcf0be5b56`.

### Resultado final

- `npm run verify`: aprovado, 23 testes, tipagem e builds concluídos. Reexecutado pelo comando de publicação.
- `npm run test:ui`: 12 testes aprovados em Chrome, incluindo os quatro tamanhos e navegação entre áreas.
- `npm run format:check`: aprovado. `.gitattributes` padroniza LF no checkout para evitar falhas de formatação por CRLF no Windows; nenhuma lógica do backend foi alterada nessa normalização.
- Implementação enviada a `origin/master`: commit `5a308e4`.
- Worker publicado: versão `fc0a095f-6d37-45d3-ab45-44ee13aa9996`.
- Endereço: https://lastro-api.marioserafim-da.workers.dev.
- Após publicação: HTML e `/health` responderam 200; sessão sem cookie informou `authenticated:false`; feed e administração sem autenticação responderam 401.
- Na sessão existente do navegador, o novo Radar exibiu os dois artigos reais da A List Apart, com autores e datas preservados. Jarvis abriu com sugestão baseada nesse conjunto real. Console sem avisos/erros capturados.
- Curadoria em produção confirmou agendamento desativado, 1 fonte, 0 candidatos pendentes e 2 referências aprovadas. Não houve coleta, revisão ou mutação de conteúdos durante a conferência.

O D1 remoto, as credenciais, os contratos e a configuração de produção foram preservados. As capturas com TESTE são evidências da suíte isolada, não conteúdo publicado no Radar.
