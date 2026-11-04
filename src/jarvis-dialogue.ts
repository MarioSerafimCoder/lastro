import type { MemoryPending } from "../packages/contracts/jarvis-brain";
import {
  brainBudget,
  executeMemoryRead,
  prepareMemoryCreate,
  prepareMemoryChange,
} from "./jarvis-brain";
import type { Env } from "./env";
import { first, stmt } from "./db";
import { ApiFault } from "./errors";
import {
  newDialogue,
  dialogueAnswer,
  dialogueLabels,
} from "../packages/contracts/jarvis-machine";
import {
  legacyIntent,
  type DialogueContext,
  type DialogueView,
  type DialogueReply,
} from "../packages/contracts/jarvis-dialogue";
import { answerJarvis, jarvisPreferences, jarvisState } from "./jarvis";
import { answerDialogueAnalytics } from "./jarvis-analytics";
import type { Answer } from "../packages/contracts/jarvis";

export type Scope = { hash: string; expires: number; cookie?: string };
const cookieName = "jarvis_dialogue";
const cookieValue = (request: Request, name: string) =>
  request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
// Call only behind the existing authentication middleware. The nonce separates local
// browser sessions; the digest also binds production state to the authenticated token.
export async function dialogueScope(
  request: Request,
  clock = Date.now(),
  create = true,
): Promise<Scope | null> {
  const auth =
    cookieValue(request, "lastro_session") ||
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    request.headers.get("authorization");
  if (!auth) return null;
  const existing = cookieValue(request, cookieName);
  if (!existing && !create) return null;
  const nonce =
    existing && /^[a-f0-9-]{36}$/.test(existing)
      ? existing
      : crypto.randomUUID();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(auth + "\n" + nonce),
  );
  let expires = clock + 8 * 3600000;
  if (auth.startsWith("v1."))
    expires = Math.min(expires, Number(auth.split(".")[1]) * 1000);
  else if (request.headers.has("Cf-Access-Jwt-Assertion")) {
    try {
      const payload = JSON.parse(
        atob(auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      );
      expires = Math.min(expires, payload.exp * 1000);
    } catch {
      return null;
    }
  }
  if (!Number.isFinite(expires) || expires <= clock) return null;
  return {
    hash: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
    expires,
    ...(!existing
      ? {
          cookie: `${cookieName}=${nonce}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=28800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
        }
      : {}),
  };
}
export const clearDialogueCookie = `${cookieName}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0; Secure`;
type Row = {
  session_hash: string;
  conversation_id: string;
  revision: number;
  schema_version: number;
  snapshot_json: string;
  expires_at: number;
};
const view = (
  c: DialogueContext,
  state: string,
  restored = false,
): DialogueView => ({
  id: c.id,
  revision: c.revision,
  state,
  pending:
    c.pending ??
    (c.memoryPending
      ? {
          kind: "confirmation",
          alternatives: [],
          question:
            c.memoryPending.operation === "correct"
              ? `Correção pendente para a memória ${c.memoryPending.id}, versão ${c.memoryPending.version}: “${c.memoryPending.draft.summary}”. Confirma esta alteração?`
              : `Proposta pendente: “${c.memoryPending.title}”. Memória ${c.memoryPending.id}, versão ${c.memoryPending.version}. Aprova esta memória?`,
        }
      : null),
  topic: c.topic,
  metric: c.metric,
  period: c.period,
  restored,
});
function decode(row: Row) {
  const snap = JSON.parse(row.snapshot_json);
  if (
    row.schema_version !== 1 ||
    snap.context?.version !== 1 ||
    snap.context.id !== row.conversation_id ||
    snap.context.revision !== row.revision ||
    ![
      "idle",
      "resolved",
      "awaiting_period",
      "awaiting_confirmation",
      "awaiting_clarification",
    ].includes(snap.value)
  )
    throw new ApiFault(
      409,
      "dialogue_version",
      "Reinicie a conversa para usar esta versão.",
    );
  return snap;
}
export async function loadDialogue(env: Env, scope: Scope, clock = Date.now()) {
  await stmt(
    env.DB,
    "DELETE FROM jarvis_conversations WHERE expires_at<=?",
    clock,
  ).run();
  let row = await first<Row>(
    env.DB,
    "SELECT * FROM jarvis_conversations WHERE session_hash=?",
    scope.hash,
  );
  if (!row) {
    const actor = newDialogue(crypto.randomUUID());
    const c = actor.getSnapshot().context;
    const serialized = JSON.stringify(actor.getPersistedSnapshot());
    actor.stop();
    await stmt(
      env.DB,
      "INSERT OR IGNORE INTO jarvis_conversations SELECT ?,?,0,1,?,?,? WHERE (SELECT COUNT(*) FROM jarvis_conversations)<64",
      scope.hash,
      c.id,
      serialized,
      Math.min(scope.expires, clock + 1800000),
      clock,
    ).run();
    row = (await first<Row>(
      env.DB,
      "SELECT * FROM jarvis_conversations WHERE session_hash=?",
      scope.hash,
    ))!;
    if (!row)
      throw new ApiFault(
        429,
        "dialogue_capacity",
        "Limite temporário de sessões. Aguarde a expiração de uma conversa.",
      );
  }
  const snapshot = decode(row);
  return {
    row,
    snapshot,
    conversation: view(snapshot.context, snapshot.value, row.revision > 0),
  };
}
export async function resetDialogue(
  env: Env,
  scope: Scope,
  id: string,
  revision: number,
) {
  const deleted = await stmt(
    env.DB,
    "DELETE FROM jarvis_conversations WHERE session_hash=? AND conversation_id=? AND revision=?",
    scope.hash,
    id,
    revision,
  ).run();
  if (!deleted.meta.changes)
    throw new ApiFault(
      409,
      "dialogue_conflict",
      "A conversa mudou em outra aba. Recarregue o contexto antes de limpar.",
    );
  return (await loadDialogue(env, scope)).conversation;
}
export async function eraseDialogue(env: Env, request: Request) {
  const scope = await dialogueScope(request, Date.now(), false);
  if (scope)
    await stmt(
      env.DB,
      "DELETE FROM jarvis_conversations WHERE session_hash=?",
      scope.hash,
    ).run();
}
async function execute(
  env: Env,
  c: DialogueContext,
  area: string,
): Promise<{
  answer: Answer;
  unavailable?: boolean;
  memoryPending?: MemoryPending | null;
  memoryCandidates?: string[];
}> {
  if (c.memoryCommand) {
    await brainBudget(env);
    const m = c.memoryCommand;
    if (
      m.action === "search" ||
      m.action === "manage" ||
      m.action === "correct" ||
      m.action === "cancelCorrection"
    )
      return executeMemoryRead(env, m, c.memoryCandidates);
    const text =
      m.action === "create"
        ? `Memória confirmada no D1: ${m.draft.title}. ID: ${m.id}. Arquivo no Drive depende de ação separada.`
        : m.action === "propose"
          ? `Proponho guardar: “${m.draft.summary}”. Tipo: ${m.draft.type}; natureza: ${m.draft.certainty}. Aprova esta memória? ID: ${m.id}.`
          : m.action === "update"
            ? `Memória ${m.id} corrigida no D1 para a versão ${m.version + 1}: ${m.draft.summary}`
            : m.action === "approve"
              ? `Memória ${m.id} aprovada no D1.`
              : `Proposta ${m.id} arquivada, sem confirmação como fato.`;
    return {
      answer: {
        ...dialogueAnswer(text),
        kind: undefined,
        source: "D1 · memória seletiva",
      },
    };
  }
  if (
    c.intent === "analytics.total" ||
    c.intent === "articles.top" ||
    c.intent === "newsletters.performance"
  )
    return answerDialogueAnalytics(env, c);
  if (c.intent === "priorities") {
    const state = await jarvisState(env),
      notice = state.notices[0];
    return {
      answer: {
        ...dialogueAnswer(
          notice
            ? notice.text
            : "Não há alertas elegíveis nos dados observados. Isso não garante que todos os serviços estejam atualizados.",
        ),
        kind: undefined,
        source: "D1 · prioridades observadas",
        syncedAt: state.syncedAt,
        incomplete: true,
        action: notice?.action,
      },
    };
  }
  if (!c.intent || !legacyIntent(c.intent)) throw Error("Invalid query state");
  const answer = await answerJarvis(
    env,
    { text: dialogueLabels[c.intent], area, choice: c.intent },
    c.period
      ? {
          label: c.period.label + " · America/Fortaleza",
          from: c.period.start + "T03:00:00.000Z",
          to: c.period.end + "T03:00:00.000Z",
          days: c.period.days === 7 ? 7 : c.period.days === 30 ? 30 : null,
        }
      : undefined,
  );
  return { answer };
}
export async function advanceDialogue(
  env: Env,
  scope: Scope,
  input: {
    text: string;
    area: string;
    conversationId: string;
    revision: number;
  },
  clock = Date.now(),
): Promise<DialogueReply> {
  const { row, snapshot } = await loadDialogue(env, scope, clock);
  if (
    row.conversation_id !== input.conversationId ||
    row.revision !== input.revision
  )
    throw new ApiFault(
      409,
      "dialogue_conflict",
      "A conversa foi atualizada em outra aba ou expirou. O contexto será recarregado; envie sua mensagem novamente.",
    );
  const actor = newDialogue(row.conversation_id, snapshot);
  try {
    const prefs = await jarvisPreferences(env);
    actor.send({
      type: "MESSAGE",
      text: input.text,
      area: input.area,
      clock,
      tone: prefs.communication,
    });
    if (actor.getSnapshot().matches("ready_to_query")) {
      try {
        const result = await execute(
          env,
          actor.getSnapshot().context,
          input.area,
        );
        actor.send({ type: "RESULT", ...result });
      } catch {
        actor.send({ type: "FAIL" });
      }
    }
    const current = actor.getSnapshot(),
      answer = current.context.response!;
    const persisted = structuredClone(actor.getPersistedSnapshot()) as any;
    // Persist safe context only, not customer references or the message transcript.
    for (const key of ["response", "lastGrounded"]) {
      const a = persisted.context[key];
      if (a)
        persisted.context[key] = {
          ...a,
          action: a.action ? { kind: a.action.kind } : undefined,
        };
    }
    persisted.context.memoryCommand = null;
    const body = JSON.stringify(persisted);
    if (body.length > 16384)
      throw new ApiFault(
        413,
        "dialogue_size",
        "Contexto excedeu o limite. Limpe a conversa.",
      );
    const command =
      current.context.plan === "query" ? current.context.memoryCommand : null;
    const guard = {
      sql: "EXISTS (SELECT 1 FROM jarvis_conversations WHERE session_hash=? AND conversation_id=? AND revision=? AND snapshot_json=?)",
      args: [scope.hash, row.conversation_id, current.context.revision, body],
    };
    const prepared =
      command && (command.action === "create" || command.action === "propose")
        ? await prepareMemoryCreate(
            env,
            {
              id: command.id,
              draft: command.draft,
              state: command.action === "create" ? "confirmada" : "proposta",
            },
            guard,
          )
        : command &&
            (command.action === "approve" ||
              command.action === "reject" ||
              command.action === "update")
          ? await prepareMemoryChange(
              env,
              command.id,
              {
                version: command.version,
                operation:
                  command.action === "update"
                    ? "corrigir"
                    : command.action === "approve"
                      ? "aprovar"
                      : "arquivar",
                ...(command.action === "update"
                  ? { draft: command.draft }
                  : {}),
              },
              guard,
            )
          : null;
    const conversationUpdate = stmt(
      env.DB,
      "UPDATE jarvis_conversations SET revision=?,snapshot_json=?,expires_at=?,updated_at=? WHERE session_hash=? AND conversation_id=? AND revision=? AND expires_at>?",
      current.context.revision,
      body,
      Math.min(scope.expires, clock + 1800000),
      clock,
      scope.hash,
      row.conversation_id,
      row.revision,
      Date.now(),
    );
    let committed: D1Result[];
    try {
      committed = await env.DB.batch([
        conversationUpdate,
        ...(prepared?.statement
          ? [
              prepared.statement,
              stmt(
                env.DB,
                "INSERT INTO jarvis_brain_commit_guard(ok) VALUES (changes())",
              ),
              stmt(env.DB, "DELETE FROM jarvis_brain_commit_guard"),
            ]
          : []),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("CHECK constraint failed")
      )
        throw new ApiFault(
          409,
          "memory_conflict",
          "A conversa ou memória mudou, ou atingiu o limite. Recarregue antes de tentar novamente.",
        );
      throw error;
    }
    const saved = committed[0];
    if (!saved.meta.changes)
      throw new ApiFault(
        409,
        "dialogue_conflict",
        "Outra mensagem atualizou a conversa. Sua resposta foi descartada; recarregue o contexto.",
      );
    if (prepared?.statement && !committed[1]?.meta.changes)
      throw new ApiFault(
        409,
        "memory_conflict",
        "A memória mudou ou atingiu o limite de 256 registros. Recarregue e revise antes de tentar novamente.",
      );
    return {
      ...answer,
      conversation: view(current.context, String(current.value)),
    };
  } finally {
    actor.stop();
  }
}
