# Etapa 02 — interface e experiência

## Entregue

A interface React em `apps/web` usa `packages/contracts/client.ts` e as APIs reais. For You mostra a sequência recomendada e suas explicações, busca e filtros, favoritos, seleção, leitura, descarte e links para a fonte original. Salvos mostra favoritos persistidos, notas e coleções. A seleção de até 20 itens persiste no backend e acompanha a navegação. A Oficina cria o pacote e recebe um prompt contextualizado; o usuário pode copiar o texto e abrir ChatGPT ou Gemini separadamente. Publicações informa que blog e newsletter ainda não possuem editor nem publicação integrada.

A API e os arquivos estáticos foram preparados para servir sob o mesmo Worker, com rotas `/api/*` e `/health` direcionadas ao código do Worker e fallback de SPA para as demais rotas. Em desenvolvimento, Vite usa `http://127.0.0.1:5173` e proxy local para o Worker em `http://127.0.0.1:8787`. O token local fica no servidor Vite, nunca no JavaScript do navegador.

## Verificação funcional local

Em 20/10/2026, o navegador exibiu quatro artigos reais de metadados RSS da Smashing Magazine. Três candidatos foram aprovados no banco **local** para validar a interface, com justificativa registrada de que apenas os metadados foram conferidos; o texto integral não foi consultado. Isso não constitui revisão científica nem aval editorial para produção.

Foram verificados visualmente: For You com quatro referências; favorito independente da seleção; Salvos; criação de coleção, inclusão de item, nota pessoal e persistência; seleção das quatro fontes; navegação mobile; Oficina com carrossel de sete slides; prompt contendo as quatro referências e as limitações de acesso; cópia confirmada; retorno à edição sem perder parâmetros; remoção individual; e Publicações em estado de desenvolvimento. Links da fonte, ChatGPT e Gemini apontam para endereços externos em nova aba, sem envio automático do prompt. O navegador embutido preservou a aba do Lastro; o carregamento das abas externas depende do navegador do usuário.

`npm run verify` cobre tipagem, testes do backend e builds da interface e do Worker. A interface foi inspecionada em largura móvel. Não há uma suíte automatizada de testes visuais; a inspeção não substitui auditoria completa de acessibilidade.

## Dependências e limites de UX

- A API não fornece URL de imagem para os conteúdos. Os cartões usam uma composição gráfica identificada como substituto, sem sugerir que seja a imagem da matéria.
- A API não fornece catálogo de assuntos. A interface oferece uma lista provisória de filtros; a busca textual usa a API real. Coleções não têm busca no servidor, então seus filtros atuam sobre os itens carregados por página.
- O contrato de pacote tem `objective` e `notes`, sem campo próprio para argumento central. A interface mantém objetivo e argumento separados no formulário e envia o argumento identificado dentro de `notes`.
- O prompt gerado é um artefato de preparação e exige revisão humana. A API não lista pacotes anteriores; ao recarregar a página, o resultado atual não reaparece automaticamente, embora o pacote permaneça no banco.
- Publicações depende de APIs futuras para rascunhos, edição, pré-visualização, portfólio, newsletter e exportação HTML. Nenhuma dessas ações é apresentada como funcional.
- A identidade visual, as fontes tipográficas e a nomenclatura editorial são provisórias. Fontes web externas têm fallback local.

## Próximo ciclo

Definir identidade visual final; contrato de imagens e catálogo de assuntos; busca paginada em coleções; listagem e retomada de pacotes; editor/publicação com fluxos de revisão; e auditoria de teclado, leitor de tela e contraste em navegadores adicionais. Para colocar a aplicação privada online, configurar uma conta Cloudflare, D1, Access e hostname protegido conforme `OPERATIONS.md`; o repositório não contém credenciais ou banco remoto.
