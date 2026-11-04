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

export function jarvisDriveInfo() {
  return frame(
    "LASTRO — JARVIS BRAIN",
    '<h1>LASTRO — JARVIS BRAIN</h1><p>O Brain guarda memórias seletivas do proprietário no D1 do Lastro. Quando o proprietário escolhe salvar uma memória confirmada no Google Drive pela interface Memória do Jarvis, o Lastro cria um documento JSON em uma pasta privada própria.</p><p>O aplicativo solicita apenas acesso aos arquivos que ele mesmo usa (<code>drive.file</code>) e a identificação básica da Conta Google (<code>openid</code> e <code>email</code>) para confirmar o proprietário autorizado. Ele não lista, pesquisa, importa ou sincroniza arquivos preexistentes e não usa IA.</p><p><a href="/api/jarvis/drive/privacy">Política de privacidade</a> · <a href="/">Acessar o Lastro</a></p>',
  );
}

export function jarvisDrivePrivacy() {
  return frame(
    "Privacidade — LASTRO JARVIS BRAIN",
    '<h1>Privacidade — LASTRO JARVIS BRAIN</h1><p>O recurso Drive é um arquivo opcional e manual das memórias seletivas do proprietário. O D1 do Lastro continua sendo a memória principal. Nenhum arquivo do Drive é importado, pesquisado, lido ou sincronizado em massa.</p><h2>Dados acessados e uso</h2><p>O Lastro solicita <code>drive.file</code> para criar, atualizar, ler e remover somente os arquivos que o próprio aplicativo usa. Solicita <code>openid</code> e <code>email</code> para validar que a Conta Google tem o e-mail verificado do proprietário autorizado. O endereço recebido da Google é usado só nessa validação; o e-mail esperado fica como Secret no Worker e não é incluído nos documentos JSON.</p><p>Quando o proprietário seleciona uma memória confirmada para arquivamento, o Lastro envia seus campos estruturados em JSON ao Google Drive. O aplicativo cria a pasta privada “LASTRO — JARVIS BRAIN/Memórias” e guarda no D1 os IDs, versões e o estado de sincronização. O aplicativo não compartilha os documentos; se uma pasta ou documento vinculado aparecer compartilhado, a operação é recusada.</p><h2>Armazenamento, segurança e retenção</h2><p>O D1 do Cloudflare mantém a memória original, os metadados de vínculo e o refresh token OAuth cifrado com AES-GCM. Segredos ficam nos Secrets do Worker; access tokens são mantidos somente em memória durante cada operação. O conteúdo JSON é enviado ao Google Drive da conta autorizada para que o proprietário possa acessá-lo.</p><p>Os documentos ficam no Drive até serem removidos pelo proprietário. A remoção individual pela interface apaga o documento do Drive e preserva a memória do D1. Desconectar ou revogar o acesso interrompe novas operações, mas não apaga documentos já arquivados nem memórias do D1. O proprietário também pode revogar o acesso nas <a href="https://myaccount.google.com/connections">conexões da Conta Google</a>.</p><p>O recurso usa Google Drive e Cloudflare para prestar essa função. O LASTRO não vende esses dados, não os usa para publicidade nem os envia a serviços de IA.</p><p>Contato: <a href="mailto:marioserafim.da@gmail.com">marioserafim.da@gmail.com</a>. Atualizado em 4 de novembro de 2026.</p><p><a href="/api/jarvis/drive/info">Sobre o LASTRO JARVIS BRAIN</a></p>',
  );
}
