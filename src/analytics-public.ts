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

export function searchConsoleInfo() {
  return frame(
    "Lastro Search Console",
    '<h1>Lastro Search Console</h1><p>O Lastro apresenta ao proprietário relatórios privados de pesquisa orgânica do Google Search Console para marioserafim.com.br.</p><p>O painel exige autenticação no Lastro e autorização de leitura na Conta Google.</p><p><a href="/api/analytics/search-console/privacy">Política de privacidade</a> · <a href="/api/analytics/search-console/terms">Termos de uso</a> · <a href="/">Acessar Lastro</a></p>',
  );
}

export function searchConsolePrivacy() {
  return frame(
    "Privacidade — Lastro Search Console",
    '<h1>Privacidade — Lastro Search Console</h1><p>O Lastro solicita o escopo <code>webmasters.readonly</code> para identificar a propriedade autorizada e consultar cliques, impressões, CTR, posição média, consultas e páginas. O painel compara esses resultados com métricas agregadas do GA4. O Jarvis pode apresentar os resultados já armazenados ao proprietário.</p><p>O Cloudflare Worker guarda a credencial do aplicativo nos Secrets do Cloudflare e o token de renovação cifrado no D1. O D1 também guarda os relatórios agregados, com cache de 24 horas por período. Os relatórios ficam disponíveis no Lastro autenticado.</p><p>Para interromper novas consultas, o proprietário pode revogar a autorização na <a href="https://myaccount.google.com/connections">Conta Google</a>. Para solicitar a remoção de dados já armazenados, entre em contato com <a href="mailto:marioserafim.da@gmail.com">marioserafim.da@gmail.com</a>.</p><p><a href="/api/analytics/search-console/info">Sobre o Lastro Search Console</a></p>',
  );
}

export function searchConsoleTerms() {
  return frame(
    "Termos de uso — Lastro Search Console",
    '<h1>Termos de uso — Lastro Search Console</h1><p>O módulo destina-se ao uso pessoal do proprietário do Lastro. Ao conectar a Conta Google, o proprietário autoriza o Lastro a ler dados da propriedade à qual tem acesso. Os relatórios dependem da disponibilidade e da cobertura do Google Search Console.</p><p>Para revogar o acesso ou solicitar a remoção de dados armazenados, consulte a <a href="/api/analytics/search-console/privacy">Política de privacidade</a>.</p><p><a href="/api/analytics/search-console/info">Sobre o Lastro Search Console</a></p>',
  );
}
export function analyticsPrivacy() {
  return frame(
    "Privacidade — Lastro Analytics",
    `<h1>Privacidade — Lastro Analytics</h1><p>O Lastro Analytics é um módulo privado de leitura de relatórios do Google Analytics, mantido por Mário Serafim. A autorização solicitada é somente <code>analytics.readonly</code>; ela não permite alterar a propriedade, publicar artigos ou enviar campanhas.</p><p>Os relatórios são usados para exibir indicadores agregados, páginas, origens e campanhas no painel privado do proprietário. Não armazenamos identificadores individuais de visitantes. As credenciais ficam nos Secrets do Cloudflare Worker e não são entregues ao frontend. Os resultados agregados ficam no D1, com cache de 12 horas; não representam dados em tempo real.</p><p>O processamento utiliza Google Analytics e Cloudflare. Não vendemos esses dados nem os utilizamos para publicidade ou treinamento de IA neste módulo.</p><p>O proprietário pode revogar a autorização em <a href="https://myaccount.google.com/connections">sua Conta Google</a>. A revogação interrompe novas leituras; os snapshots já armazenados permanecem até sua remoção administrativa pelo proprietário. Desabilitar o módulo também interrompe novas consultas.</p><p>Contato: <a href="mailto:marioserafim.da@gmail.com">marioserafim.da@gmail.com</a>.</p><p>Atualizado em 3 de novembro de 2026.</p><p><a href="/api/analytics/info">Sobre o Lastro Analytics</a></p>`,
  );
}
