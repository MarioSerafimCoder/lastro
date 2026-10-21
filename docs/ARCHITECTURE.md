# Decisões da etapa 01

Em 20/10/2026 o diretório F:\\lastro estava vazio, sem repositório ou AGENTS.md. O PDF de visão v1.0 foi fornecido posteriormente em `C:/Users/pc mario/Documents/Lastro_Hub_Criativo_Documento_de_Visao_v1.0_2026-10-20.pdf` e suas 18 páginas foram lidas. Ele é a referência conceitual; o briefing de etapa 01 determina o escopo de implementação. As propostas de blog/newsletter do documento não antecipam sua construção nesta entrega. Nenhum arquivo de portfólio é necessário.

## Stack

API TypeScript em Cloudflare Workers, Hono para rotas, Zod para contratos e validação, SQL explícito com D1/SQLite e migrações versionadas. Wrangler fornece execução local sem conta. O frontend poderá usar React/Vite e importar `packages/contracts`; SSR/Next.js não traz benefício necessário para este hub privado. R2, filas, ORM, vetores e geração por IA ficam fora da etapa.

Uma única API e banco reduzem manutenção. Cloudflare é um destino preparado, não um serviço contratado: sem deploy, cobrança ou criação de conta nesta etapa. Os limites de ingestão favorecem baixo volume. Quotas devem ser verificadas na conta antes de publicar. Rejeições, falhas e itens pendentes são persistidos; nunca são substituídos por dados fictícios.

## Segurança

Todas as rotas /api exigem autenticação. Local: token aleatório e apenas host de loopback. Produção: JWT Cloudflare Access verificado criptograficamente, emissor, audience e email do único proprietário; configurações ausentes falham fechadas. A interface deve usar o mesmo domínio protegido por Access. POST/PUT/PATCH/DELETE com Origin exigem origem configurada ou mesmo domínio. Sem segredos no bundle do frontend. A coleta usa HTTPS e allowlist exata de hosts, sem IPs, credenciais ou redirects; a allowlist é controlada pelo operador. Não há download de artigos ou tentativa de atravessar paywalls.

## Limites deliberados

Coleta incremental por janela recente: uma página de até 25 registros por fonte é persistida numa fila local D1; cada invocação processa duas entradas e o cron escolhe uma fonte. Isso mantém as consultas abaixo do orçamento gratuito por invocação, com retomada e sem perder o restante da resposta recebida. Não é um importador histórico. RSS só preserva resumo curto quando o cadastro autoriza, e nunca usa content:encoded. Metadados acadêmicos não comprovam validade científica. A avaliação automática é uma heurística editorial, com lacunas explícitas, revisão humana e parâmetros versionados. O índice privado para o usuário inclui apenas aprovados de fontes atualmente aprovadas.

O For You opera sobre até 500 candidatos recentes do índice, com desempate por ID e snapshot de IDs/pontuações válido por 30 minutos. Páginas seguintes usam esse snapshot e rechecagem de elegibilidade. Busca cobre o índice completo com filtros e paginação por offset. Escala maior pede índice de busca e candidatos persistidos, não antecipados aqui. Favoritos e interações são tabelas distintas da seleção; publicações futuras têm vínculo próprio.

## Referências técnicas consultadas

- [D1 local](https://developers.cloudflare.com/d1/best-practices/local-development/) e [migrações](https://developers.cloudflare.com/d1/reference/migrations/).
- [Validação de JWT Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
- [OpenAlex autenticação](https://help.openalex.org/api/authentication/): chave opcional para consultas básicas; sem cursor de próxima página nesta versão. Segredo opcional somente no servidor. Nenhum plano pago necessário.
