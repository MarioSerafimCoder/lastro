# Jarvis 2.1 — conversa social e leitura

Interações sociais são resolvidas localmente, com variações determinísticas e respeito ao tom escolhido. Pedidos mistos preservam as dez intenções operacionais e Fuse.js. A API também reconhece mensagens sociais antes de consultar dados. Respostas locais não apresentam sincronização fictícia.

Sugestões usam duas colunas, com quebra de texto. Cabeçalho e compositor permanecem fixos; apenas o histórico rola, incluindo preferências. A leitura acima do fim não é interrompida por respostas recebidas.

Validação: TypeScript backend/frontend e build aprovados; suíte completa com 131 testes aprovada, seguida de quatro testes sociais após refinamento de precedência; oito testes de interface aprovados, incluindo 1440/1280/390 px, teclado, texto longo, ausência de overflow, zero consultas sociais e pedidos mistos.

Sem dependências, migrations, alterações de segurança ou IA. Publicação autorizada pelo proprietário. Versão anterior para rollback: `29961181-293b-4597-ac40-70169dcee74e`. Não há alterações de esquema a reverter.

## Correção após teste real do proprietário

Reproduzida em produção a frase “olá Jarvis está por ai?”. O classificador reconhece presença e suas variações, priorizando a frase mais longa. Removidos botões de sugestões, de seleção de intenção e a sugestão contextual fixa. Esclarecimentos são feitos em texto; respostas como “as atrasadas” selecionam somente alternativas da pergunta anterior. Assuntos não relacionados não aparecem entre as alternativas.

Validação: 18 testes de backend, oito de interface, TypeScript e build. Testes digitados diretamente no chat com API local real: frase original, variação coloquial, pergunta ambígua seguida de esclarecimento, solicitação mista e pergunta fora do escopo. IA, segurança e banco preservados.
