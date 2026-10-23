# For You 2.0 — direção editorial e operação

O feed preserva a identidade claro/escuro do LASTRO. A grade agora entrega até 16 referências por lote, em quatro colunas quando há espaço, três ou duas em tablet e uma no celular. Dois cards por lote recebem peso tipográfico moderado. Sem imagem licenciada, o card usa título, categoria, fonte, autoria, data, idioma e ações; não cria capa ou resumo. Salvar e marcar como lido têm resposta visual imediata e reversão em erro. A seleção e os links externos mantêm os fluxos anteriores.

## Distribuição por idioma

A classificação usa idioma declarado no item; quando ausente, usa apenas marcadores linguísticos fortes no título e, por fim, o idioma declarado pelo feed. Títulos ambíguos permanecem sem idioma e não entram na aprovação automática. O ranking editorial é calculado como antes; dois pools preservam a ordem de cada idioma e são intercalados PT/outro. Cada lote par e cada página do cursor contém pares completos. Faltando conteúdo qualificado de qualquer lado, o lote é menor: não há empréstimo nem aprovação forçada. Filtro explícito para um único idioma mantém seu recorte. A Curadoria mostra estoques aprovados PT, outros e sem idioma.

O snapshot mantém a sequência por 30 minutos. Itens que perdem aprovação, fonte ou elegibilidade durante a paginação são revalidados, e o par é omitido para não quebrar a proporção. Itens descartados pelo usuário seguem ocultos. O feed não se atualiza sozinho enquanto a pessoa lê; o botão Atualizar solicita nova seleção.

## Fontes examinadas

O catálogo recebeu nove candidatas: Design Culture, Revista Pesquisa FAPESP, Arcos Design (UERJ), Designerd, UX Collective Brasil, Plau Entrelinha, Meio & Mensagem, Projeto Draft e B9. O teste com feeds reais ocorreu em D1 efêmero, com aprovação automática simulada para medir potencial, sem copiar dados pessoais. Os resultados por fonte e exemplos estão em [for-you-2-source-checks.json](examples/for-you-2-source-checks.json).

Somente **UX Collective Brasil** e **Plau Entrelinha** foram selecionadas para ativação automática. Os títulos úteis, autoria e datas apareceram no RSS; o primeiro não informa idioma e só terá idioma inferido quando o título contiver evidência linguística forte. A Plau declara português no feed. Ambas entram apenas com metadados e link, sem imagem, resumo ou texto integral.

As demais seguem no catálogo: Design Culture trouxe premiações e inscrições promocionais entre as aprovações simuladas; Pesquisa FAPESP não trouxe referência elegível no recorte recente, embora seja fonte confiável; Arcos exige classificação científica e idioma por artigo antes de ativar; Designerd, Meio & Mensagem, Draft e B9 geraram pouco conteúdo qualificado no recorte. Zupi foi examinada, mas seu RSS traz edições antigas; Cartema estava indisponível no teste. Essas decisões não impedem reavaliação futura.

## Infraestrutura e verificação

O Worker, D1, autenticação, favoritos, domínio e Cron de cinco minutos permanecem. RSS faz descoberta diária por fonte; OpenAlex mantém o ciclo bimestral. Cada execução processa no máximo dois itens e o teste de Cron mediu 42 consultas D1 de ingestão mais três de agendamento, abaixo do teto de 50 do plano Free. As duas novas fontes acrescentam duas descobertas diárias, sem nova API paga ou recurso Cloudflare.

Validação: `npm run verify` (tipos, 39 testes, build e dry-run), testes Playwright com fixtures isoladas em 1440, 1366, 768, 390 e 320 px, temas claro/escuro e movimento reduzido; fotos de referência em [desktop](examples/for-you-2-1440-dark.png) e [celular](examples/for-you-2-390-dark.png). Os testes de ranking verificam 12, 16 e 20 itens, falta de estoque e ausência de duplicatas.

Em 23/10/2026, a conferência com o D1 de produção pelo mesmo Worker em sessão local autenticada confirmou oito fontes ativas, 29 conteúdos aprovados (seis PT, 22 internacionais, um sem idioma verificado) e 34 pendentes. Os pedidos de 12, 16 e 20 referências entregaram 12 itens: seis PT e seis internacionais. As filas iniciais de UX Collective e Plau foram concluídas pela rotina manual existente, sem aprovação em massa. A home publicada respondeu 200; a API pública sem sessão respondeu 401. O deploy usa a versão `0ed72857-6f4f-45d3-951e-0eceffa39057`. A sessão local de validação foi encerrada.

Filtros e modo de visualização persistem no navegador após recarregar. Atualizações solicitadas pelo usuário mostram a quantidade de referências novas, sem trocar a sequência durante a leitura. Não houve migração nem alteração de dados pessoais. Um export privado anterior ao cadastro foi preservado em `.wrangler/lastro-before-for-you-2.sql`, fora do Git.
