const frame = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Lastro</title><style>body{font:17px/1.7 system-ui,sans-serif;background:#f6f4ef;color:#242720;max-width:760px;margin:5rem auto;padding:0 1.5rem}a{color:#456348}h1{font-size:2.2rem;line-height:1.2}p{margin:1.3rem 0}</style><main>${body}</main></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
export function analyticsInfo() {
  return frame(
    "Lastro Analytics",
    '<h1>Lastro Analytics</h1><p>Módulo privado de leitura do Google Analytics, mantido por Mário Serafim. Exibe indicadores agregados, páginas, origens e campanhas para o proprietário, com acesso somente de leitura e cache de 12 horas.</p><p>Os relatórios exigem autenticação no Lastro. Esta página informativa não concede acesso aos dados.</p><p><a href="/api/analytics/privacy">Política de privacidade</a> · <a href="/">Acessar Lastro</a></p>',
  );
}
export function analyticsPrivacy() {
  return frame(
    "Privacidade — Lastro Analytics",
    `<h1>Privacidade — Lastro Analytics</h1><p>O Lastro Analytics é um módulo privado de leitura de relatórios do Google Analytics, mantido por Mário Serafim. A autorização solicitada é somente <code>analytics.readonly</code>; ela não permite alterar a propriedade, publicar artigos ou enviar campanhas.</p><p>Os relatórios são usados para exibir indicadores agregados, páginas, origens e campanhas no painel privado do proprietário. Não armazenamos identificadores individuais de visitantes. As credenciais ficam nos Secrets do Cloudflare Worker e não são entregues ao frontend. Os resultados agregados ficam no D1, com cache de 12 horas; não representam dados em tempo real.</p><p>O processamento utiliza Google Analytics e Cloudflare. Não vendemos esses dados nem os utilizamos para publicidade ou treinamento de IA neste módulo.</p><p>O proprietário pode revogar a autorização em <a href="https://myaccount.google.com/connections">sua Conta Google</a>. A revogação interrompe novas leituras; os snapshots já armazenados permanecem até sua remoção administrativa pelo proprietário. Desabilitar o módulo também interrompe novas consultas.</p><p>Contato: <a href="mailto:marioserafim.da@gmail.com">marioserafim.da@gmail.com</a>.</p><p>Atualizado em 3 de novembro de 2026.</p><p><a href="/api/analytics/info">Sobre o Lastro Analytics</a></p>`,
  );
}
