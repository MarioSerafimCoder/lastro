# Feed vivo — operação editorial

Em 23/10/2026, o Worker `lastro-api` foi publicado no domínio `lastro.marioserafim.com.br`, com o Cron existente de cinco em cinco minutos e a coleta habilitada. O D1, os dados pessoais, a autenticação, os favoritos, a seleção e os recursos existentes foram preservados. Não houve migração. Antes das alterações no cadastro de fontes, foi feito um export privado em `.wrangler/lastro-before-feed-vivo.sql` (ignorado pelo Git).

## Critérios

- A fonte precisa estar aprovada, com coleta de metadados autorizada e `autoApprove=true`. Essa opção agora pode ser configurada na Curadoria; cada edição de fonte ainda exige nova aprovação e gera decisão auditável.
- O item precisa passar pelo prefiltro de URL, assunto, idioma informado, data, acesso e retratação. URL/DOI/GUID e título semelhante impedem publicação duplicada. Título e autoria devem ser reais, e o título precisa corresponder a um assunto prioritário da fonte.
- Entradas identificadas como patrocinadas ou publieditoriais ficam para exceção editorial, fora da aprovação automática.
- A política versionada define limiares de confiabilidade, completude, relevância, originalidade, idade, pontuação geral e diversidade. A Curadoria permite alterar esses valores. Uma aprovação automática grava sua avaliação e decisão editorial; itens incertos permanecem na fila para exceções.
- Estudos OpenAlex só entram como **referências bibliográficas** com autoria, data, periódico, DOI e assunto explícito no título. Editoriais, revisões e registros sem procedência suficiente ficam pendentes. Indexação não valida método, resultados nem alegações científicas; afirmações de evidência continuam exigindo conferência humana.
- O RSS de A List Apart usa `dc:language` e pode trazer a autoria em HTML. O parser agora extrai esses campos sem confundir o texto “by” com o nome do autor. Entidades HTML do título são normalizadas.

RSS/Atom faz uma descoberta por fonte por dia UTC. OpenAlex faz uma rodada bibliográfica a cada dois meses UTC (janeiro/fevereiro, março/abril etc.). O Cron escolhe uma fonte elegível por execução, processa no máximo dois itens, preserva fila/lease/backoff e não coleta novamente no mesmo ciclo. A limpeza de sessões temporárias ocorre nos ciclos sem ingestão. Em teste isolado, o caso de dois itens aprováveis usou 42 consultas D1 na ingestão; com a seleção da fonte, fica abaixo do limite de 50 por execução.

Imagens aparecem somente se o RSS as fornecer por campo de mídia e a fonte tiver autorização explícita `imageAllowed`. Resumos só são exibidos se `summaryAllowed`; nenhuma das fontes atualmente ativas autoriza imagem ou resumo. Os cards mantêm título, procedência, autoria, data, categoria, ações pessoais e link original em nova aba. A ausência de resumo é informada, sem criar texto ou imagem fictícios.

## Fontes e verificação

Seis fontes estão cadastradas e aprovadas para atualização: A List Apart, Smashing Magazine, Creative Boom, It’s Nice That, Journal of Vision e Design Studies. Typographica permanece apenas no catálogo porque a amostra recente não passou no filtro automático. Frontiers in Psychology permanece apenas no catálogo devido ao ruído temático observado. Os direitos continuam limitados a metadados e links.

Na conferência de produção em 23/10/2026 às 12:21 UTC, havia 14 conteúdos elegíveis no For You, distribuídos pelas seis fontes; 19 pendentes, 1 conteúdo retirado do índice por identificação explícita como patrocinado, 97 itens na fila inicial e nenhuma execução com falha. Esse registro é uma fotografia: o Cron continua processando a fila e as contagens mudam. A retirada foi registrada em `editorial_decisions`, sem excluir o conteúdo ou dados pessoais.

O teste com feeds reais ocorreu em um D1 efêmero, sem copiar dados pessoais. Em oito fontes técnicas, 185 candidatos resultaram em 44 aprovações possíveis, 66 pendências e 75 rejeições; a evidência por fonte está em [feed-vivo-source-checks.json](examples/feed-vivo-source-checks.json). A contagem é da amostra isolada, não do acervo publicado em produção.

Validação: tipos do Worker e da interface, testes de API/ingestão/ranking, build de produção e testes Playwright em 1440, 1366, 768 e 390 px. O teste específico do feed confirma imagem autorizada, link em nova aba e persistência de favorito, seleção e leitura após recarregar no celular. A URL nova e a URL legada retornam 401 para `/api/feed` sem sessão.

## Acompanhamento

Conferir `GET /api/radar/status` com sessão de proprietário e as tabelas `ingestion_runs`, `ingestion_queue`, `ingestion_candidates`, `contents`, `editorial_decisions` e `sources` no D1. A carga inicial de cerca de 150 itens das seis fontes pode consumir várias horas a dois itens por execução; não antecipar aprovação para preencher a home. Revisar falhas repetidas, 403/429, contagem de itens por fonte, limite diário de D1 e pertinência dos estudos. Conteúdos pendentes não exigem ação para que novos itens qualificados entrem automaticamente.
