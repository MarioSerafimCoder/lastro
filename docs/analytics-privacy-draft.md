# Privacidade — Lastro Analytics

O Lastro Analytics é um módulo privado de leitura de relatórios do Google Analytics, mantido por Mário Serafim. A autorização solicitada é somente `analytics.readonly`; ela não permite alterar a propriedade, publicar artigos ou enviar campanhas.

Os relatórios são usados para exibir indicadores agregados, páginas, origens e campanhas no painel privado do proprietário. Não armazenamos identificadores individuais de visitantes. As credenciais ficam nos Secrets do Cloudflare Worker e não são entregues ao frontend. Os resultados agregados ficam no D1, com cache de 12 horas; não representam dados em tempo real.

O processamento utiliza Google Analytics e Cloudflare. Não vendemos esses dados nem os utilizamos para publicidade ou treinamento de IA neste módulo.

O proprietário pode revogar a autorização em https://myaccount.google.com/connections. A revogação interrompe novas leituras; os snapshots já armazenados permanecem até sua remoção administrativa pelo proprietário. Desabilitar o módulo também interrompe novas consultas.

Contato: marioserafim.da@gmail.com.

Atualizado em 3 de novembro de 2026.
