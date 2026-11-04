import type { Env } from "./env";
import { first, stmt, OWNER } from "./db";
import { ApiFault } from "./errors";
import { brainBudget, memoryById } from "./jarvis-brain";

export const DRIVE_CALLBACK = "/api/jarvis/drive/oauth/callback";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const cookieName = "lastro_brain_oauth";
const b64 = (v: Uint8Array) =>
  btoa(String.fromCharCode(...v))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const unb64 = (v: string) =>
  Uint8Array.from(atob(v.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (v: string) =>
  b64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
  );
function config(env: Env) {
  if (
    env.BRAIN_DRIVE_ENABLED !== "true" ||
    env.BRAIN_DRIVE_FREE_CONFIRMED !== "true"
  )
    throw new ApiFault(
      503,
      "drive_disabled",
      "Drive desativado: confirme quotas gratuitas, ausência de Billing e armazenamento disponível antes de habilitar.",
    );
  if (
    !env.BRAIN_DRIVE_CLIENT_ID ||
    !env.BRAIN_DRIVE_CLIENT_SECRET ||
    !env.BRAIN_DRIVE_TOKEN_KEY ||
    !env.OWNER_EMAIL
  )
    throw new ApiFault(
      503,
      "drive_config",
      "OAuth exclusivo do Brain não configurado.",
    );
  if (
    (env.GOOGLE_OAUTH_CLIENT_ID &&
      env.BRAIN_DRIVE_CLIENT_ID === env.GOOGLE_OAUTH_CLIENT_ID) ||
    (env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.BRAIN_DRIVE_CLIENT_SECRET === env.GOOGLE_OAUTH_CLIENT_SECRET)
  )
    throw new ApiFault(
      503,
      "drive_isolation",
      "Use credenciais exclusivas do Brain; GA4 não pode ser reutilizado.",
    );
  let redirect: URL;
  try {
    redirect = new URL(env.BRAIN_DRIVE_REDIRECT_URI!);
  } catch {
    throw new ApiFault(
      503,
      "drive_config",
      "Callback HTTPS exato obrigatório.",
    );
  }
  if (
    redirect.protocol !== "https:" ||
    redirect.pathname !== DRIVE_CALLBACK ||
    redirect.search ||
    redirect.hash ||
    redirect.origin !== env.ALLOWED_ORIGIN
  )
    throw new ApiFault(
      503,
      "drive_config",
      "Callback deve corresponder à origem privada do Lastro.",
    );
  return redirect;
}
async function key(env: Env) {
  const bytes = unb64(env.BRAIN_DRIVE_TOKEN_KEY!);
  if (bytes.length !== 32)
    throw new ApiFault(503, "drive_key", "Chave AES de 256 bits obrigatória.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(env: Env, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return (
    b64(iv) +
    "." +
    b64(
      new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv,
            additionalData: new TextEncoder().encode("lastro-brain-v1"),
          },
          await key(env),
          new TextEncoder().encode(value),
        ),
      ),
    )
  );
}
export async function unseal(env: Env, value: string) {
  const [iv, body] = value.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unb64(iv),
        additionalData: new TextEncoder().encode("lastro-brain-v1"),
      },
      await key(env),
      unb64(body),
    ),
  );
}
async function bounded(response: Response, max = 32768) {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new ApiFault(413, "drive_size", "Documento excede 32 KiB.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > max)
        throw new ApiFault(
          413,
          "drive_size",
          "Resposta excede o limite autorizado.",
        );
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}
async function request(
  env: Env,
  url: string,
  init: RequestInit = {},
  allow404 = false,
  grant?: "authorization_code" | "refresh_token",
) {
  await brainBudget(env, 32768); // reserve the maximum response before every external request
  const signal = AbortSignal.timeout(8000);
  const diagnostic = {
    component: "jarvis-drive",
    host: new URL(url).hostname,
    operation: grant ?? "drive",
  };
  let response: Response;
  let body: string;
  try {
    response = await fetch(url, {
      ...init,
      // Workers rejects redirect:"error" before sending any request.
      // Never forward OAuth credentials or bearer headers to a redirect target.
      redirect: "manual",
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      console.warn(
        JSON.stringify({
          ...diagnostic,
          event: "upstream_redirect",
          status: response.status,
        }),
      );
      throw new ApiFault(
        502,
        "drive_redirect",
        "Redirecionamento do Google recusado. Revise a configuração.",
      );
    }
    if (allow404 && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    body = await bounded(response);
  } catch (error) {
    if (error instanceof ApiFault) throw error;
    const timeout =
      signal.aborted ||
      (error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError"));
    console.warn(
      JSON.stringify({
        ...diagnostic,
        event: "upstream_fetch_failed",
        category: timeout ? "timeout" : "connection",
      }),
    );
    throw new ApiFault(
      timeout ? 504 : 503,
      timeout ? "drive_timeout" : "drive_connection",
      timeout
        ? "Tempo de resposta do Google excedido; D1 preservado. Inicie nova autorização se estava conectando o Drive."
        : "Conexão com o Google indisponível; D1 preservado. Inicie nova autorização se estava conectando o Drive.",
    );
  }
  if (!response.ok) {
    let oauthError = "unknown";
    try {
      const value: unknown = JSON.parse(body)?.error;
      if (
        typeof value === "string" &&
        [
          "invalid_grant",
          "invalid_client",
          "unauthorized_client",
          "redirect_uri_mismatch",
          "invalid_request",
          "invalid_scope",
          "unsupported_grant_type",
          "invalid_token",
          "temporarily_unavailable",
          "server_error",
        ].includes(value)
      )
        oauthError = value;
    } catch {
      /* Provider bodies are never logged or returned. */
    }
    console.warn(
      JSON.stringify({
        ...diagnostic,
        event: "upstream_http_failed",
        status: response.status,
        ...(grant ? { oauthError } : {}),
      }),
    );
    if (
      response.status === 400 &&
      url === "https://oauth2.googleapis.com/revoke" &&
      oauthError === "invalid_token"
    )
      return { body: "", etag: null };
    const status = response.status;
    if (
      status >= 500 ||
      oauthError === "temporarily_unavailable" ||
      oauthError === "server_error"
    )
      throw new ApiFault(
        503,
        "drive_service",
        "Operação do Drive não confirmada: serviço Google temporariamente indisponível. D1 preservado.",
      );
    if (
      grant &&
      [
        "invalid_client",
        "unauthorized_client",
        "redirect_uri_mismatch",
        "invalid_request",
        "invalid_scope",
        "unsupported_grant_type",
      ].includes(oauthError)
    )
      throw new ApiFault(
        503,
        "drive_config",
        "Configuração OAuth recusada pelo Google. Revise cliente, callback e PKCE.",
      );
    if (grant && oauthError === "invalid_grant") {
      if (grant === "authorization_code")
        throw new ApiFault(
          400,
          "drive_oauth_code",
          "Código OAuth inválido, expirado ou incompatível com callback/PKCE. Inicie nova autorização.",
        );
      await stmt(
        env.DB,
        "UPDATE jarvis_brain_drive SET retry_at=? WHERE owner=?",
        Date.now() + 300000,
        OWNER,
      ).run();
      throw new ApiFault(
        401,
        "drive_refresh",
        "Autorização inválida, expirada ou revogada. Reconecte o Drive.",
      );
    }
    if (status === 401 || status === 403 || status === 429) {
      if (grant !== "authorization_code")
        await stmt(
          env.DB,
          "UPDATE jarvis_brain_drive SET retry_at=? WHERE owner=?",
          Date.now() + (status === 429 ? 60000 : 300000),
          OWNER,
        ).run();
      throw new ApiFault(
        status,
        "drive_authorization",
        status === 429
          ? "Limite do Drive; aguarde e tente novamente."
          : grant === "authorization_code"
            ? "Autorização inicial recusada pelo Google. Revise o cliente e inicie nova autorização."
            : "Acesso ao Drive expirado, revogado ou sem permissão. Revise a conexão.",
      );
    }
    throw new ApiFault(
      502,
      "drive_request",
      "Operação do Drive não confirmada. D1 preservado.",
    );
  }
  return { body, etag: response.headers.get("etag") };
}
async function tokenRequest(env: Env, params: Record<string, string>) {
  const grant = params.grant_type as "authorization_code" | "refresh_token";
  const result = await request(
    env,
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...params,
        client_id: env.BRAIN_DRIVE_CLIENT_ID!,
        client_secret: env.BRAIN_DRIVE_CLIENT_SECRET!,
      }),
    },
    false,
    grant,
  );
  let tokens;
  try {
    tokens = JSON.parse(result!.body);
  } catch {
    throw new ApiFault(
      502,
      "drive_response",
      "Resposta OAuth inválida do Google. Inicie nova autorização se estava conectando o Drive.",
    );
  }
  if (
    !tokens ||
    typeof tokens !== "object" ||
    typeof tokens.access_token !== "string" ||
    !tokens.access_token ||
    (tokens.refresh_token !== undefined &&
      typeof tokens.refresh_token !== "string") ||
    (tokens.scope !== undefined && typeof tokens.scope !== "string")
  )
    throw new ApiFault(
      502,
      "drive_response",
      "Resposta OAuth incompleta do Google. Revise a conexão.",
    );
  return tokens as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  };
}
export async function beginDriveOAuth(env: Env, req: Request) {
  const redirect = config(env);
  if (req.headers.get("Origin") !== redirect.origin)
    throw new ApiFault(403, "origin_forbidden", "Origem não autorizada.");
  const state = random(),
    nonce = random(),
    verifier = random();
  await stmt(
    env.DB,
    "DELETE FROM jarvis_brain_oauth WHERE expires_at<?",
    Date.now(),
  ).run();
  const created = await stmt(
    env.DB,
    "INSERT INTO jarvis_brain_oauth SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM jarvis_brain_oauth)<4",
    await hash(state),
    await hash(nonce),
    await seal(env, verifier),
    Date.now() + 600000,
  ).run();
  if (!created.meta.changes)
    throw new ApiFault(
      429,
      "drive_pending",
      "Há autorizações pendentes. Aguarde dez minutos.",
    );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.BRAIN_DRIVE_CLIENT_ID!,
    redirect_uri: redirect.href,
    response_type: "code",
    scope: DRIVE_SCOPE + " openid email",
    state,
    code_challenge: await hash(verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
  }).toString();
  return {
    url: url.href,
    cookie: `${cookieName}=${nonce}; Path=${DRIVE_CALLBACK}; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  };
}
export async function finishDriveOAuth(env: Env, req: Request) {
  const redirect = config(env),
    url = new URL(req.url);
  if (url.origin !== redirect.origin || url.pathname !== redirect.pathname)
    throw new ApiFault(400, "drive_callback", "Callback inválido.");
  const nonce = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((s) => s.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  const state = url.searchParams.get("state");
  if (!nonce || !state || state.length > 100 || nonce.length > 100)
    throw new ApiFault(400, "drive_state", "Autorização inválida ou expirada.");
  const pending = await stmt(
    env.DB,
    "DELETE FROM jarvis_brain_oauth WHERE state_hash=? AND nonce_hash=? AND expires_at>? RETURNING verifier_cipher",
    await hash(state),
    await hash(nonce),
    Date.now(),
  ).first<{ verifier_cipher: string }>();
  if (!pending)
    throw new ApiFault(400, "drive_state", "State já utilizado ou expirado.");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048 || url.searchParams.has("error"))
    throw new ApiFault(
      400,
      "drive_consent",
      "Autorização do Drive não concedida.",
    );
  const tokens = await tokenRequest(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect.href,
    code_verifier: await unseal(env, pending.verifier_cipher),
  });
  if (
    !tokens.access_token ||
    !tokens.refresh_token ||
    !tokens.scope?.split(" ").includes(DRIVE_SCOPE) ||
    tokens.scope
      .split(" ")
      .some((scope) => scope.includes("/auth/drive") && scope !== DRIVE_SCOPE)
  )
    throw new ApiFault(
      400,
      "drive_scope",
      "Consentimento offline incompleto; reconecte o Drive.",
    );
  const user = JSON.parse(
    (await request(env, "https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }))!.body,
  );
  if (
    user.email_verified !== true ||
    typeof user.email !== "string" ||
    user.email.toLowerCase() !== env.OWNER_EMAIL!.toLowerCase()
  )
    throw new ApiFault(
      403,
      "drive_owner",
      "Conta Google diferente do proprietário autorizado.",
    );
  const connected = await stmt(
    env.DB,
    `INSERT INTO jarvis_brain_drive(owner,token_cipher) VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET token_cipher=excluded.token_cipher,retry_at=0 WHERE lock_until<?`,
    OWNER,
    await seal(env, tokens.refresh_token),
    Date.now(),
  ).run();
  if (!connected.meta.changes)
    throw new ApiFault(
      409,
      "drive_busy",
      "Uma operação está em andamento. Aguarde e refaça a conexão.",
    );
  return new Response(
    "Google Drive autorizado. Volte ao Lastro e selecione uma memória para testar gravação e leitura.",
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Set-Cookie": `${cookieName}=; Path=${DRIVE_CALLBACK}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      },
    },
  );
}
type Connection = {
  token_cipher: string;
  root_id: string | null;
  memories_id: string | null;
  retry_at: number;
};
export async function driveStatus(env: Env) {
  const row = await first<{ retry_at: number }>(
    env.DB,
    "SELECT retry_at FROM jarvis_brain_drive WHERE owner=?",
    OWNER,
  );
  return {
    enabled:
      env.BRAIN_DRIVE_ENABLED === "true" &&
      env.BRAIN_DRIVE_FREE_CONFIRMED === "true",
    connected: !!row,
    retryAt: row?.retry_at ?? 0,
    message: row
      ? "Envie uma memória de teste e leia o documento para verificar a conexão."
      : "Autorize uma conta Google exclusiva do proprietário para salvar documentos selecionados.",
  };
}
async function withDrive<T>(
  env: Env,
  operation: (
    api: (
      path: string,
      init?: RequestInit,
      allow404?: boolean,
    ) => Promise<{ body: string; etag: string | null } | null>,
    row: Connection,
  ) => Promise<T>,
  refresh = true,
) {
  config(env);
  const lock = crypto.randomUUID();
  const row = await stmt(
    env.DB,
    "UPDATE jarvis_brain_drive SET lock_id=?,lock_until=? WHERE owner=? AND lock_until<? AND (retry_at<=? OR ?=0) RETURNING token_cipher,root_id,memories_id,retry_at",
    lock,
    Date.now() + 180000,
    OWNER,
    Date.now(),
    Date.now(),
    refresh ? 1 : 0,
  ).first<Connection>();
  if (!row)
    throw new ApiFault(
      409,
      "drive_busy",
      "Drive desconectado, ocupado ou aguardando nova tentativa.",
    );
  try {
    const tokens = refresh
      ? await tokenRequest(env, {
          grant_type: "refresh_token",
          refresh_token: await unseal(env, row.token_cipher),
        })
      : { access_token: "" };
    if (refresh && !tokens.access_token)
      throw new ApiFault(
        401,
        "drive_refresh",
        "Autorização expirada ou revogada; reconecte o Drive.",
      );
    const api = (path: string, init: RequestInit = {}, allow404 = false) =>
      request(
        env,
        "https://www.googleapis.com/" + path,
        {
          ...init,
          headers: {
            ...init.headers,
            Authorization: `Bearer ${tokens.access_token}`,
          },
        },
        allow404,
      );
    return await operation(api, row);
  } finally {
    await stmt(
      env.DB,
      "UPDATE jarvis_brain_drive SET lock_id=NULL,lock_until=0 WHERE owner=? AND lock_id=?",
      OWNER,
      lock,
    ).run();
  }
}
const jsonHeaders = { "Content-Type": "application/json" };
const validId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(id))
    throw new ApiFault(400, "drive_id", "ID do Drive inválido.");
  return id;
};
export async function syncMemory(env: Env, id: string, version: number) {
  const memory = await memoryById(env, id);
  if (memory.version !== version || memory.state !== "confirmada")
    throw new ApiFault(
      409,
      "memory_conflict",
      "Revise uma memória confirmada na versão atual.",
    );
  try {
    return await withDrive(env, async (api, row) => {
      const generate = async () =>
        validId(
          JSON.parse(
            (await api(
              "drive/v3/files/generateIds?count=1&space=drive&type=files",
            ))!.body,
          ).ids[0],
        );
      const folder = async (
        field: "root_id" | "memories_id",
        name: string,
        parent?: string,
      ) => {
        let folderId = row[field];
        if (!folderId) {
          folderId = await generate();
          await stmt(
            env.DB,
            `UPDATE jarvis_brain_drive SET ${field}=? WHERE owner=?`,
            folderId,
            OWNER,
          ).run();
          row[field] = folderId;
        }
        const old = await api(
          `drive/v3/files/${validId(folderId)}?fields=id,mimeType,trashed,appProperties,parents,shared,ownedByMe`,
          {},
          true,
        );
        if (!old)
          await api("drive/v3/files?fields=id", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              id: folderId,
              name,
              mimeType: "application/vnd.google-apps.folder",
              ...(parent ? { parents: [parent] } : {}),
              appProperties: { lastroBrain: "1" },
            }),
          });
        else {
          const meta = JSON.parse(old.body);
          if (
            meta.shared ||
            meta.ownedByMe === false ||
            meta.trashed ||
            meta.mimeType !== "application/vnd.google-apps.folder" ||
            meta.appProperties?.lastroBrain !== "1" ||
            (parent && !meta.parents?.includes(parent))
          )
            throw new ApiFault(
              409,
              "drive_folder",
              "Pasta Brain alterada ou indisponível. Revise a conexão.",
            );
        }
        return folderId;
      };
      const root = await folder("root_id", "LASTRO — JARVIS BRAIN");
      const parent = await folder("memories_id", "Memórias", root);
      let fileId = memory.driveId;
      if (!fileId) {
        fileId = await generate();
        const saved = await stmt(
          env.DB,
          "UPDATE jarvis_brain SET drive_id=?,sync='pendente' WHERE id=? AND version=? AND drive_id IS NULL",
          fileId,
          id,
          version,
        ).run();
        if (!saved.meta.changes)
          throw new ApiFault(
            409,
            "memory_conflict",
            "Memória alterada durante a sincronização.",
          );
      }
      const old = await api(
        `drive/v3/files/${validId(fileId)}?fields=id,trashed,appProperties,parents,shared,ownedByMe`,
        {},
        true,
      );
      const meta = old ? JSON.parse(old.body) : null;
      if (
        meta &&
        (meta.shared ||
          meta.ownedByMe === false ||
          meta.trashed ||
          meta.appProperties?.memoryId !== id ||
          !meta.parents?.includes(parent))
      )
        throw new ApiFault(
          409,
          "drive_link",
          "Documento alterado fora do Brain; revise o vínculo.",
        );
      if (meta && Number(meta.appProperties?.version) > version)
        throw new ApiFault(
          409,
          "drive_version",
          "O documento contém versão posterior. Revise antes de sobrescrever.",
        );
      if (!meta || Number(meta.appProperties?.version) !== version) {
        const boundary = "brain-" + crypto.randomUUID();
        const metadata = {
          ...(!old ? { id: fileId, parents: [parent] } : {}),
          name: `${id}.json`,
          mimeType: "application/json",
          appProperties: { memoryId: id, version: String(version) },
        };
        const document = JSON.stringify({
          schema: "lastro-brain-1",
          id,
          version,
          type: memory.type,
          title: memory.title,
          summary: memory.summary,
          keywords: memory.keywords,
          project: memory.project,
          origin: memory.origin,
          certainty: memory.certainty,
          createdAt: memory.createdAt,
          updatedAt: memory.updatedAt,
        });
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${document}\r\n--${boundary}--`;
        await api(
          `upload/drive/v3/files${old ? "/" + validId(fileId) : ""}?uploadType=multipart&fields=id`,
          {
            method: old ? "PATCH" : "POST",
            headers: {
              "Content-Type": `multipart/related; boundary=${boundary}`,
              ...(old?.etag ? { "If-Match": old.etag } : {}),
            },
            body,
          },
        );
      }
      await stmt(
        env.DB,
        "UPDATE jarvis_brain SET drive_version=?,sync=CASE WHEN version=? THEN 'sincronizada' ELSE 'pendente' END WHERE id=? AND drive_id=?",
        version,
        version,
        id,
        fileId,
      ).run();
      return memoryById(env, id);
    });
  } catch (error) {
    await stmt(
      env.DB,
      "UPDATE jarvis_brain SET sync='erro' WHERE id=?",
      id,
    ).run();
    throw error;
  }
}
export async function readMemoryDocument(env: Env, id: string) {
  const memory = await memoryById(env, id);
  if (!memory.driveId)
    throw new ApiFault(
      404,
      "drive_link",
      "Esta memória não possui documento no Drive.",
    );
  return withDrive(env, async (api) => {
    const meta = JSON.parse(
      (await api(
        `drive/v3/files/${validId(memory.driveId!)}?fields=appProperties,trashed,shared,ownedByMe`,
      ))!.body,
    );
    if (
      meta.shared ||
      meta.ownedByMe === false ||
      meta.trashed ||
      meta.appProperties?.memoryId !== id
    )
      throw new ApiFault(
        409,
        "drive_link",
        "Documento não corresponde à memória.",
      );
    return {
      content: (await api(
        `drive/v3/files/${validId(memory.driveId!)}?alt=media`,
      ))!.body,
      version: memory.driveVersion,
    };
  });
}
export async function deleteMemoryDocument(
  env: Env,
  id: string,
  version: number,
  confirmation: string,
) {
  const memory = await memoryById(env, id);
  if (memory.version !== version || confirmation !== `EXCLUIR DRIVE ${id}`)
    throw new ApiFault(
      400,
      "drive_confirmation",
      "Confirme o ID e a versão do documento a excluir.",
    );
  if (!memory.driveId) return memory;
  await withDrive(env, async (api) => {
    const old = await api(
      `drive/v3/files/${validId(memory.driveId!)}?fields=appProperties,trashed,shared,ownedByMe`,
      {},
      true,
    );
    if (
      old &&
      (JSON.parse(old.body).shared ||
        JSON.parse(old.body).ownedByMe === false ||
        JSON.parse(old.body).appProperties?.memoryId !== id)
    )
      throw new ApiFault(409, "drive_link", "Vínculo do documento alterado.");
    if (old)
      await api(
        `drive/v3/files/${validId(memory.driveId!)}`,
        { method: "DELETE", headers: old.etag ? { "If-Match": old.etag } : {} },
        true,
      );
    await stmt(
      env.DB,
      "UPDATE jarvis_brain SET drive_id=NULL,drive_version=NULL,sync='local' WHERE id=? AND drive_id=?",
      id,
      memory.driveId,
    ).run();
  });
  return memoryById(env, id);
}
export async function disconnectDrive(env: Env, confirmation: string) {
  config(env);
  if (confirmation !== "REVOGAR DRIVE")
    throw new ApiFault(
      400,
      "drive_confirmation",
      "Digite REVOGAR DRIVE para confirmar.",
    );
  // A held lease also prevents a sync from refreshing a token after revocation.
  await withDrive(
    env,
    async (_api, row) => {
      await request(env, "https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: await unseal(env, row.token_cipher),
        }),
      });
      await stmt(
        env.DB,
        "DELETE FROM jarvis_brain_drive WHERE owner=?",
        OWNER,
      ).run();
    },
    false,
  );
  return { connected: false };
}
