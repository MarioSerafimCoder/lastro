# Radar 2 — homologação da interface

Branch `codex/radar-2-ui`, baseada em `a92aebf` da Fase 01. Sem deploy, migration ou alteração de regras/backend. Custo incremental da execução: R$ 0; sem dependências, serviços ou IA novos.

## Interface

Mesa com Novidades, Para avaliar e Favoritos, cards compactos sem sinopse longa, lista densa e painel lateral nativo com foco contido, Escape e retorno ao card. Paleta, marca, animação global, temas e navegação existentes preservados. Botões realizam toda a triagem, sem arrastar. Atualização confirmada pela API antes de mover o card; falha oferece recuperação.

Feed e favoritos usam os mesmos registros de Salvos. Avaliação usa `seen`, favorito usa os endpoints existentes; descarte de favorito primeiro remove a preservação. Seleção da Oficina continua pelo fluxo existente. Pelo contrato do Astra, seleção na Oficina também implica “Para avaliar”; para devolver às novidades, remover antes essa seleção no painel.

## Contratos e limites

Cliente existente tipado com `Partial<RadarFeedQuery>`; nenhum contrato paralelo. Feed usa `scope=editorial|scientific` e ordenação da API; paginação carrega até 500 referências e até 500 favoritos. País, assunto, fonte, idioma, texto, não lidos e período combinam-se sobre esse conjunto carregado. Atualizar recarrega os dados. Pulso distingue coleta, descoberta, falhas e quantidade carregada ainda por avaliar; indisponibilidade é explícita.

O Diário continua limitado à semana civil de Fortaleza, inclusive com “Últimos nove dias”. Esse filtro restringe também a publicação no acervo salvo; não amplia a janela da API. Favoritos antigos continuam preservados e visíveis no recorte padrão. Fotografia e ilustração são uma categoria única do contrato: não foram inventadas subdivisões. País desconhecido é indicado. Científico tem todas as datas por padrão e não recebe retenção editorial. Datas sem horário não ganham deslocamento artificial de um dia.

Expiração é refletida a cada minuto; favorito nunca é ocultado por prazo. A limpeza continua pertencendo ao motor da Fase 01. Nenhuma exclusão foi executada.

## Validação

Playwright em Chrome desktop: amostra sintética de 40 referências (32 editoriais), triagem, favorito após recarga, combinação de filtros, vazio, teclado/painel, Oficina, lista, dark/light e largura 390 px. Cenários adicionais: 503/recuperação, avanço de nove dias preservando favorito, descarte e separação científica. Regressões direcionadas de login e Curadoria. TypeScript frontend/backend e build com dry-run. Asserções visuais históricas do antigo feed gigante não compõem esta seleção de testes e precisam ser substituídas antes de usar a suíte UI histórica completa como gate.

Capturas sintéticas revisadas: [escuro](examples/radar2-ui/desktop-dark.png), [claro](examples/radar2-ui/desktop-light.png), [lista](examples/radar2-ui/desktop-list.png). Não contêm dados de produção.

## Homologação seguinte

Revisar esta branch juntamente com a Fase 01. A API nova ainda não foi implantada: esta validação de navegador usa respostas sintéticas dos contratos, sem alegar homologação integrada em produção. Após implantação autorizada do motor e interface, repetir triagem e persistência com dados controlados; nenhuma ativação foi feita nesta fase. Rollback: restaurar os arquivos da interface ao commit base; não há alteração de dados para reverter.
