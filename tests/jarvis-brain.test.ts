import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { migrationStatements } from "./migration-statements";
import { app } from "../src/index";
import {
  applyMemory,
  prepareMemoryCreate,
  prepareMemoryChange,
  listMemories,
  memoryById,
  brainBudget,
} from "../src/jarvis-brain";
import {
  loadDialogue,
  advanceDialogue,
  type Scope,
} from "../src/jarvis-dialogue";
import {
  beginDriveOAuth,
  finishDriveOAuth,
  syncMemory,
  readMemoryDocument,
  deleteMemoryDocument,
  disconnectDrive,
  seal,
  unseal,
  DRIVE_SCOPE,
  DRIVE_CALLBACK,
} from "../src/jarvis-drive";
import {
  memoryIntent,
  type MemoryDraft,
} from "../packages/contracts/jarvis-brain";
import type { Env } from "../src/env";
let mf: Miniflare, env: Env;
const realFetch = globalThis.fetch;
const draft = (
  summary = "Prefiro textos com humor seco.",
  project: string | null = null,
): MemoryDraft => ({
  type: "preferencia",
  title: summary,
  summary,
  keywords: ["humor seco"],
  project,
  origin: "Proprietário · teste",
  certainty: "preferencia",
});
const scope = (id = crypto.randomUUID()): Scope => ({
  hash: id,
  expires: Date.now() + 3600000,
});
const create = async (d = draft(), state = "confirmada") =>
  applyMemory(
    env,
    await prepareMemoryCreate(env, {
      id: crypto.randomUUID(),
      draft: d,
      state,
    }),
  );
async function chat(s = scope()) {
  let view = (await loadDialogue(env, s)).conversation;
  return {
    get view() {
      return view;
    },
    async send(text: string) {
      const answer = await advanceDialogue(env, s, {
        text,
        area: "for-you",
        conversationId: view.id,
        revision: view.revision,
      });
      view = answer.conversation;
      return answer;
    },
  };
}
before(async () => {
  mf = new Miniflare(
    await convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-10-01",
      d1Databases: { DB: "brain-test" },
    }),
  );
  env = {
    DB: await mf.getD1Database("DB"),
    ENVIRONMENT: "development",
    DEV_TOKEN: "test-owner-token-".repeat(4),
  } as Env;
  for (const f of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
    ))
      await env.DB.prepare(sql).run();
});
beforeEach(async () => {
  for (const table of [
    "jarvis_brain",
    "jarvis_brain_budget",
    "jarvis_brain_oauth",
    "jarvis_brain_drive",
    "jarvis_conversations",
    "request_budgets",
    "jarvis_brain_commit_guard",
  ])
    await env.DB.prepare("DELETE FROM " + table).run();
  for (const field of [
    "BRAIN_DRIVE_ENABLED",
    "BRAIN_DRIVE_FREE_CONFIRMED",
    "BRAIN_DRIVE_CLIENT_ID",
    "BRAIN_DRIVE_CLIENT_SECRET",
    "BRAIN_DRIVE_TOKEN_KEY",
    "BRAIN_DRIVE_REDIRECT_URI",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
  ] as const)
    delete env[field];
  globalThis.fetch = async () => {
    throw Error("Unexpected external request");
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  await mf.dispose();
});

test("explicit memory survives a new authenticated session without saving ordinary messages", async () => {
  const c = await chat();
  await c.send("Olá, Jarvis");
  assert.equal((await listMemories(env, { q: "" })).length, 0);
  assert.match(
    (await c.send("Lembre que prefiro textos com humor seco.")).text,
    /confirmada no D1/,
  );
  const remembered = await (await chat()).send("Mostre minhas preferências");
  assert.match(remembered.text, /humor seco/);
  assert.match(remembered.text, /origem:/);
  assert.equal(remembered.stale, true);
  const snapshots = await env.DB.prepare(
    "SELECT snapshot_json FROM jarvis_conversations",
  ).all<{ snapshot_json: string }>();
  for (const row of snapshots.results)
    assert.equal(JSON.parse(row.snapshot_json).context.memoryCommand, null);
});
test("specific proposal approval and rejection; unrelated yes never saves", async () => {
  const c = await chat();
  await c.send("sim");
  assert.equal((await listMemories(env, { q: "" })).length, 0);
  assert.match(
    (await c.send("Prefiro textos com humor seco.")).text,
    /Proponho guardar/,
  );
  let m = (await listMemories(env, { q: "" }))[0];
  assert.equal(m.state, "proposta");
  await c.send("sim");
  m = await memoryById(env, m.id);
  assert.equal(m.state, "confirmada");
  assert.equal(m.version, 2);
  await c.send("Prefiro cores quentes.");
  await c.send("não");
  assert.equal(
    (await listMemories(env, { q: "", state: "arquivada" })).length,
    1,
  );
  await c.send("Prefiro tipografia serifada.");
  await c.send("o que você faz?");
  await c.send("sim");
  assert.equal(
    (await listMemories(env, { q: "", state: "proposta" })).length,
    1,
  );
});
test("ambiguous references do not invent memories, projects, or deletes", async () => {
  assert.equal(memoryIntent("Registre uma oportunidade para o cliente."), null);
  for (const text of [
    "Guarde essa decisão.",
    "Guarde esta pesquisa.",
    "Esqueça essa informação.",
    "Corrija aquela lembrança.",
  ]) {
    const c = await chat();
    await c.send(text);
    await c.send("sim");
  }
  assert.equal((await listMemories(env, { q: "" })).length, 0);
  const cmd = memoryIntent("Lembre que talvez usemos uma marca azul.");
  assert.equal(cmd?.action, "create");
  if (cmd?.action === "create") {
    assert.equal(cmd.draft.certainty, "hipotese");
    assert.equal(cmd.draft.project, null);
  }
});
test("exact identifiers, approximate keywords, project/type/date/state filters and contradictory preferences", async () => {
  const one = (await create(draft("Prefiro humor seco.", "Portfólio")))!;
  const two = (await create(draft("Prefiro textos sem humor.", "Outro")))!;
  assert.equal((await listMemories(env, { q: one.id }))[0].id, one.id);
  assert.equal(
    (await listMemories(env, { q: "humor seko", project: "portfolio" }))[0].id,
    one.id,
  );
  assert.equal((await listMemories(env, { q: "", type: "decisao" })).length, 0);
  assert.equal(
    (await listMemories(env, { q: "", from: "2099-01-01T00:00:00Z" })).length,
    0,
  );
  assert.equal(
    (await listMemories(env, { q: "", to: "2000-01-01T00:00:00Z" })).length,
    0,
  );
  const c = await chat();
  const answer = await c.send("Mostre minhas preferências");
  assert.match(answer.text, /várias lembranças/);
  assert.match(answer.text, /confirme se ainda se aplicam/);
  assert.match(answer.text, new RegExp(two.id));
});
test("correction CAS, archive, strict deletion confirmation, idempotency and capacity", async () => {
  const id = crypto.randomUUID(),
    input = { id, draft: draft(), state: "confirmada" };
  const m = (await applyMemory(env, await prepareMemoryCreate(env, input)))!;
  assert.equal(
    (await applyMemory(env, await prepareMemoryCreate(env, input)))!.version,
    1,
  );
  await assert.rejects(
    () =>
      prepareMemoryCreate(env, { ...input, draft: draft("Outro conteúdo") }),
    /outro conteúdo/,
  );
  const pending = await prepareMemoryChange(env, id, {
    version: 1,
    operation: "corrigir",
    draft: draft("Prefiro cores quentes."),
  });
  await applyMemory(env, pending);
  await assert.rejects(() => applyMemory(env, pending), /concorrente/);
  await assert.rejects(
    () =>
      prepareMemoryChange(env, id, {
        version: m.version,
        operation: "arquivar",
      }),
    /mudou/,
  );
  await assert.rejects(
    () =>
      prepareMemoryChange(env, id, {
        version: 2,
        operation: "excluir",
        confirmation: "sim",
      }),
    /EXCLUIR/,
  );
  await applyMemory(
    env,
    await prepareMemoryChange(env, id, { version: 2, operation: "arquivar" }),
  );
  assert.equal((await listMemories(env, { q: "" })).length, 0);
  await applyMemory(
    env,
    await prepareMemoryChange(env, id, {
      version: 3,
      operation: "excluir",
      confirmation: `EXCLUIR ${id}`,
    }),
  );
  await assert.rejects(() => memoryById(env, id), /não encontrada/);
  await env.DB.batch(
    Array.from({ length: 256 }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO jarvis_brain(id,body_json,state,created_at,updated_at) VALUES (?,?,'confirmada','2026','2026')",
      ).bind(String(i), JSON.stringify(draft())),
    ),
  );
  await assert.rejects(() => create(), /256/);
});
test("concurrent chat writes commit only with the winning conversation revision", async () => {
  const s = scope(),
    view = (await loadDialogue(env, s)).conversation;
  const input = {
    area: "for-you",
    conversationId: view.id,
    revision: view.revision,
  };
  const results = await Promise.allSettled([
    advanceDialogue(env, s, { ...input, text: "Lembre que prefiro azul." }),
    advanceDialogue(env, s, { ...input, text: "Lembre que prefiro verde." }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await listMemories(env, { q: "" })).length, 1);
  assert.equal((await loadDialogue(env, s)).conversation.revision, 1);
  assert.equal(
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM jarvis_brain_commit_guard",
    ).first("n"),
    0,
  );
});
test("failed approval and exhausted budget never save memory or advance a successful write response", async () => {
  const c = await chat();
  await c.send("Prefiro humor discreto.");
  const m = (await listMemories(env, { q: "" }))[0];
  await applyMemory(
    env,
    await prepareMemoryChange(env, m.id, {
      operation: "arquivar",
      version: m.version,
    }),
  );
  const revision = c.view.revision;
  await assert.rejects(() => c.send("sim"), /mudou/);
  assert.equal(c.view.revision, revision);
  await env.DB.prepare(
    "INSERT OR REPLACE INTO jarvis_brain_budget VALUES (?,400,0)",
  )
    .bind(new Date().toISOString().slice(0, 10))
    .run();
  assert.match(
    (await c.send("Lembre que prefiro branco.")).text,
    /Não consegui/,
  );
  assert.equal(
    (await listMemories(env, { q: "", state: "confirmada" })).length,
    0,
  );
});
test("all private brain/Drive endpoints require Lastro authentication and reject cross-origin writes", async () => {
  for (const [path, method] of [
    ["brain", "GET"],
    ["brain", "POST"],
    ["drive", "GET"],
    ["drive/oauth", "POST"],
    ["brain/" + crypto.randomUUID() + "/sync", "POST"],
  ]) {
    const res = await app.request(
      "http://localhost/api/jarvis/" + path,
      { method },
      env,
    );
    assert.equal(res.status, 401);
  }
  const response = await app.request(
    "http://localhost/api/jarvis/brain",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.DEV_TOKEN,
        Origin: "https://evil.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        draft: draft(),
        state: "confirmada",
      }),
    },
    env,
  );
  assert.equal(response.status, 403);
});
function enableDrive() {
  Object.assign(env, {
    BRAIN_DRIVE_ENABLED: "true",
    BRAIN_DRIVE_FREE_CONFIRMED: "true",
    BRAIN_DRIVE_CLIENT_ID: "brain-only-client",
    BRAIN_DRIVE_CLIENT_SECRET: "mock-client-secret",
    BRAIN_DRIVE_TOKEN_KEY: btoa("x".repeat(32)),
    BRAIN_DRIVE_REDIRECT_URI: "https://lastro.test" + DRIVE_CALLBACK,
    ALLOWED_ORIGIN: "https://lastro.test",
    OWNER_EMAIL: "owner@example.test",
  });
}
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", etag: '"test-etag"' },
  });
async function oauth(user = "owner@example.test") {
  enableDrive();
  const started = await beginDriveOAuth(
    env,
    new Request("https://lastro.test/api/jarvis/drive/oauth", {
      method: "POST",
      headers: { Origin: "https://lastro.test" },
    }),
  );
  const auth = new URL(started.url),
    state = auth.searchParams.get("state")!;
  const request = new Request(
    env.BRAIN_DRIVE_REDIRECT_URI + "?code=authorized-code&state=" + state,
    { headers: { Cookie: started.cookie.split(";")[0] } },
  );
  const calls: { url: string; body: string }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    if (String(url).endsWith("/token"))
      return reply({
        access_token: "mock-access",
        refresh_token: "mock-refresh",
        scope: DRIVE_SCOPE + " openid email",
        expires_in: 3600,
      });
    if (String(url).endsWith("/userinfo"))
      return reply({ email: user, email_verified: true });
    throw Error("Unexpected OAuth request");
  };
  return { started, auth, request, calls };
}
test("Drive remains disabled without free-cost evidence; GA4 credentials cannot be reused", async () => {
  const m = (await create())!;
  await assert.rejects(() => syncMemory(env, m.id, 1), /desativado/);
  enableDrive();
  env.BRAIN_DRIVE_FREE_CONFIRMED = "false";
  await assert.rejects(
    () => beginDriveOAuth(env, new Request("https://lastro.test")),
    /desativado/,
  );
  env.BRAIN_DRIVE_FREE_CONFIRMED = "true";
  env.GOOGLE_OAUTH_CLIENT_ID = env.BRAIN_DRIVE_CLIENT_ID;
  await assert.rejects(
    () => beginDriveOAuth(env, new Request("https://lastro.test")),
    /exclusivas/,
  );
  env.GOOGLE_OAUTH_CLIENT_ID = "different-ga4";
  env.BRAIN_DRIVE_REDIRECT_URI = "http://lastro.test" + DRIVE_CALLBACK;
  await assert.rejects(
    () => beginDriveOAuth(env, new Request("https://lastro.test")),
    /Callback/,
  );
});
test("OAuth uses independent minimal scope, PKCE, exact HTTPS, single-use state and encrypted tokens", async () => {
  const flow = await oauth();
  assert.equal(
    flow.auth.searchParams.get("scope"),
    DRIVE_SCOPE + " openid email",
  );
  assert.equal(flow.auth.searchParams.get("access_type"), "offline");
  assert.equal(flow.auth.searchParams.get("code_challenge_method"), "S256");
  assert.match(flow.started.cookie, /HttpOnly; Secure; SameSite=Lax/);
  const result = await finishDriveOAuth(env, flow.request);
  assert.equal(result.status, 200);
  const params = new URLSearchParams(flow.calls[0].body);
  const verifier = params.get("code_verifier")!;
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");
  assert.equal(challenge, flow.auth.searchParams.get("code_challenge"));
  assert.equal(params.get("redirect_uri"), env.BRAIN_DRIVE_REDIRECT_URI);
  const stored = await env.DB.prepare(
    "SELECT token_cipher FROM jarvis_brain_drive",
  ).first<string>("token_cipher");
  assert.ok(stored);
  assert.ok(!stored.includes("mock-refresh"));
  assert.equal(await unseal(env, stored), "mock-refresh");
  assert.ok(!(await result.text()).includes("mock-access"));
  await assert.rejects(() => finishDriveOAuth(env, flow.request), /State/);
});
test("OAuth rejects wrong owner, replay, expired state, wrong nonce and tampered ciphertext", async () => {
  let flow = await oauth("intruder@example.test");
  await assert.rejects(
    () => finishDriveOAuth(env, flow.request),
    /proprietário/,
  );
  assert.equal(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM jarvis_brain_drive").first(
      "n",
    ),
    0,
  );
  flow = await oauth();
  await assert.rejects(
    () =>
      finishDriveOAuth(
        env,
        new Request(flow.request.url, {
          headers: { Cookie: "lastro_brain_oauth=wrong" },
        }),
      ),
    /State/,
  );
  await env.DB.prepare("UPDATE jarvis_brain_oauth SET expires_at=0").run();
  await assert.rejects(() => finishDriveOAuth(env, flow.request), /State/);
  const cipher = await seal(env, "sensitive");
  const altered = cipher.slice(0, -4) + "AAAA";
  await assert.rejects(() => unseal(env, altered));
});
// Fake Drive stores only synthetic Brain files. It supports uncertain writes and ETag checks.
async function fakeDrive() {
  enableDrive();
  await env.DB.prepare(
    "INSERT INTO jarvis_brain_drive(owner,token_cipher) VALUES ('owner',?)",
  )
    .bind(await seal(env, "mock-refresh"))
    .run();
  const files = new Map<string, { meta: any; content: string }>();
  let generated = 0,
    failUpload = false,
    failAfterUpload = false;
  let failure: number | null = null;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    calls.push(u.pathname);
    const method = init?.method ?? "GET";
    if (u.pathname.endsWith("/token"))
      return reply({ access_token: "mock-access" });
    if (u.pathname.endsWith("/revoke"))
      return new Response(null, { status: 200 });
    if (failure) return reply({ error: "mock" }, failure);
    if (u.pathname.endsWith("/generateIds"))
      return reply({ ids: ["generated-" + ++generated] });
    if (u.pathname.startsWith("/upload/")) {
      if (failUpload) {
        failUpload = false;
        return reply({}, 503);
      }
      const parts = String(init?.body).split("\r\n");
      const meta = JSON.parse(parts[3]);
      const content = parts[7];
      const id = meta.id ?? u.pathname.split("/").pop()!;
      const old = files.get(id);
      if (old)
        assert.equal(
          (init?.headers as Record<string, string>)["If-Match"],
          '"test-etag"',
        );
      files.set(id, { meta: { ...old?.meta, ...meta }, content });
      if (failAfterUpload) {
        failAfterUpload = false;
        throw Error("connection lost after commit");
      }
      return reply({ id });
    }
    if (method === "POST") {
      const meta = JSON.parse(String(init?.body));
      files.set(meta.id, { meta, content: "" });
      return reply({ id: meta.id });
    }
    const id = u.pathname.split("/").pop()!,
      file = files.get(id);
    if (!file) return reply({}, 404);
    if (method === "DELETE") {
      files.delete(id);
      return new Response(null, { status: 204 });
    }
    return u.searchParams.get("alt") === "media"
      ? new Response(file.content)
      : reply(file.meta);
  };
  return {
    files,
    calls,
    failUpload: () => {
      failUpload = true;
    },
    failAfterUpload: () => {
      failAfterUpload = true;
    },
    status: (s: number | null) => {
      failure = s;
    },
  };
}
test("manual Drive sync creates only root/Memórias; reads by linked ID and versions idempotently", async () => {
  const drive = await fakeDrive(),
    m = (await create())!;
  const synced = await syncMemory(env, m.id, 1);
  assert.equal(synced.sync, "sincronizada");
  assert.equal(synced.driveVersion, 1);
  assert.equal(drive.files.size, 3);
  assert.ok(
    [...drive.files.values()].some(
      (f) => f.meta.name === "LASTRO — JARVIS BRAIN",
    ),
  );
  const doc = await readMemoryDocument(env, m.id);
  assert.equal(JSON.parse(doc.content).summary, m.summary);
  await syncMemory(env, m.id, 1);
  assert.equal(drive.files.size, 3);
  await applyMemory(
    env,
    await prepareMemoryChange(env, m.id, {
      version: 1,
      operation: "corrigir",
      draft: draft("Prefiro outra direção."),
    }),
  );
  const next = await syncMemory(env, m.id, 2);
  assert.equal(next.driveId, synced.driveId);
  assert.equal(next.driveVersion, 2);
  await assert.rejects(
    () =>
      prepareMemoryChange(env, m.id, {
        version: 2,
        operation: "excluir",
        confirmation: `EXCLUIR ${m.id}`,
      }),
    /documento vinculado/,
  );
});
test("partial/uncertain Drive writes preserve D1 and retry a stable file ID without duplicates", async () => {
  const drive = await fakeDrive(),
    m = (await create())!;
  drive.failUpload();
  await assert.rejects(() => syncMemory(env, m.id, 1), /não confirmada/);
  const partial = await memoryById(env, m.id);
  assert.equal(partial.sync, "erro");
  assert.ok(partial.driveId);
  assert.equal(partial.driveVersion, null);
  drive.failAfterUpload();
  await assert.rejects(() => syncMemory(env, m.id, 1), /indisponível/);
  assert.equal((await memoryById(env, m.id)).driveVersion, null);
  const recovered = await syncMemory(env, m.id, 1);
  assert.equal(recovered.driveId, partial.driveId);
  assert.equal(recovered.sync, "sincronizada");
  assert.equal(drive.files.size, 3);
});
test("Drive unavailable documents, 401/403/429, shared files and bounded downloads never erase D1", async () => {
  const drive = await fakeDrive(),
    m = (await create())!;
  const synced = await syncMemory(env, m.id, 1);
  const file = drive.files.get(synced.driveId!)!;
  file.meta.shared = true;
  await assert.rejects(() => readMemoryDocument(env, m.id), /não corresponde/);
  file.meta.shared = false;
  file.content = "x".repeat(32769);
  await assert.rejects(() => readMemoryDocument(env, m.id), /limite/);
  for (const status of [401, 403, 429]) {
    await env.DB.prepare("UPDATE jarvis_brain_drive SET retry_at=0").run();
    drive.status(status);
    await assert.rejects(
      () => readMemoryDocument(env, m.id),
      status === 429 ? /Limite/ : /Acesso/,
    );
    assert.equal((await memoryById(env, m.id)).summary, m.summary);
    await assert.rejects(() => readMemoryDocument(env, m.id), /aguardando/);
  }
  drive.status(null);
  await env.DB.prepare("UPDATE jarvis_brain_drive SET retry_at=0").run();
  drive.files.delete(synced.driveId!);
  await assert.rejects(() => readMemoryDocument(env, m.id), /não confirmada/);
  assert.equal((await memoryById(env, m.id)).id, m.id);
});
test("Drive document deletion needs exact confirmation; revocation preserves D1 and files", async () => {
  const drive = await fakeDrive(),
    m = (await create())!;
  const synced = await syncMemory(env, m.id, 1);
  await assert.rejects(
    () => deleteMemoryDocument(env, m.id, 1, "sim"),
    /Confirme/,
  );
  await deleteMemoryDocument(env, m.id, 1, `EXCLUIR DRIVE ${m.id}`);
  assert.equal((await memoryById(env, m.id)).driveId, null);
  assert.equal(drive.files.size, 2);
  await syncMemory(env, m.id, 1);
  await disconnectDrive(env, "REVOGAR DRIVE");
  assert.equal(
    await env.DB.prepare("SELECT COUNT(*) AS n FROM jarvis_brain_drive").first(
      "n",
    ),
    0,
  );
  assert.equal((await memoryById(env, m.id)).id, m.id);
  assert.equal(drive.files.size, 3);
  assert.ok(!drive.files.has(synced.driveId!));
});
test("Drive lease prevents concurrent operations; budget stops before an external request", async () => {
  const drive = await fakeDrive(),
    m = (await create())!;
  await env.DB.prepare("UPDATE jarvis_brain_drive SET lock_until=?")
    .bind(Date.now() + 60000)
    .run();
  await assert.rejects(() => syncMemory(env, m.id, 1), /ocupado/);
  assert.equal(drive.calls.length, 0);
  await env.DB.prepare("UPDATE jarvis_brain_drive SET lock_until=0").run();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO jarvis_brain_budget VALUES (?,1,2097152)",
  )
    .bind(new Date().toISOString().slice(0, 10))
    .run();
  await assert.rejects(() => syncMemory(env, m.id, 1), /Limite diário/);
  assert.equal(drive.calls.length, 0);
  await assert.rejects(() => brainBudget(env, 1), /Limite diário/);
});

test("complete conversations recover a past project without inferring links or current truth", async () => {
  const m = (await create({
    ...draft("Decidimos usar uma identidade minimalista.", "Portfólio"),
    type: "decisao",
    certainty: "fato",
    keywords: ["portfólio"],
  }))!;
  const c = await chat();
  assert.match(
    (await c.send("Jarvis, lembra daquela decisão sobre o portfólio?")).text,
    new RegExp(m.id),
  );
  assert.match(
    (await c.send("Qual foi a decisão daquele portfólio?")).text,
    /minimalista/,
  );
  assert.match(
    (await c.send("O que você lembra sobre galáxia desconhecida?")).text,
    /Não possuo/,
  );
  assert.equal((await memoryById(env, m.id)).project, "Portfólio");
  for (let i = 0; i < 5; i++)
    await create({
      ...draft("x".repeat(1600)),
      title: "Preferência extensa " + i,
      origin: "Origem " + "z".repeat(220),
    });
  assert.match(
    (await c.send("Mostre minhas preferências")).text,
    /resumo completo/,
  );
});

test("refresh revocation is sanitized and revocation itself does not require a working refresh token", async () => {
  await fakeDrive();
  const m = (await create())!;
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url).endsWith("/revoke")
      ? new Response(null)
      : reply(
          {
            error: "invalid_grant",
            error_description: "private-provider-detail",
          },
          400,
        );
  };
  await assert.rejects(
    () => syncMemory(env, m.id, 1),
    (error) =>
      error instanceof Error &&
      /revogada/.test(error.message) &&
      !error.message.includes("private-provider-detail"),
  );
  const count = calls.length;
  await disconnectDrive(env, "REVOGAR DRIVE");
  assert.equal(calls.length, count + 1);
  assert.match(calls.at(-1)!, /revoke$/);
  assert.equal((await memoryById(env, m.id)).summary, m.summary);
});
