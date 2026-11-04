import type { Env } from "./env";
import { first, rows, stmt, OWNER } from "./db";
import { ApiFault } from "./errors";
import {
  memoryCreateSchema,
  memoryChangeSchema,
  searchMemories,
  type BrainMemory,
  type MemorySearch,
  type MemoryCommand,
  type MemoryPending,
  type MemoryDraft,
  memoryKeywords,
} from "../packages/contracts/jarvis-brain";
import { dialogueAnswer } from "../packages/contracts/jarvis-machine";

type Row = {
  id: string;
  body_json: string;
  state: BrainMemory["state"];
  version: number;
  created_at: string;
  updated_at: string;
  drive_id: string | null;
  drive_version: number | null;
  sync: BrainMemory["sync"];
};
const decode = (r: Row): BrainMemory => ({
  ...JSON.parse(r.body_json),
  id: r.id,
  state: r.state,
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  driveId: r.drive_id,
  driveVersion: r.drive_version,
  sync: r.sync,
});
export async function brainBudget(env: Env, bytes = 0) {
  const day = new Date().toISOString().slice(0, 10);
  const result = await stmt(
    env.DB,
    `INSERT INTO jarvis_brain_budget(day,requests,bytes) VALUES (?,1,?)
    ON CONFLICT(day) DO UPDATE SET requests=requests+1,bytes=bytes+excluded.bytes
    WHERE requests<400 AND bytes+excluded.bytes<=2097152 RETURNING requests`,
    day,
    bytes,
  ).first();
  if (!result)
    throw new ApiFault(
      429,
      "brain_budget",
      "Limite diário da memória atingido. Tente amanhã.",
    );
  // Retain a bounded counter history; no scheduler or background indexing.
  await stmt(
    env.DB,
    "DELETE FROM jarvis_brain_budget WHERE day<?",
    new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
  ).run();
}
export async function memoryById(env: Env, id: string) {
  const row = await first<Row>(
    env.DB,
    "SELECT * FROM jarvis_brain WHERE owner=? AND id=?",
    OWNER,
    id,
  );
  if (!row)
    throw new ApiFault(404, "memory_missing", "Memória não encontrada.");
  return decode(row);
}
export async function listMemories(env: Env, filter: MemorySearch) {
  const list = await rows<Row>(
    env.DB,
    "SELECT * FROM jarvis_brain WHERE owner=? ORDER BY updated_at DESC LIMIT 256",
    OWNER,
  );
  return searchMemories(list.map(decode), filter);
}
// The optional guard binds a chat write to the exact snapshot won by its CAS.
export async function prepareMemoryCreate(
  env: Env,
  value: unknown,
  guard?: { sql: string; args: unknown[] },
) {
  const input = memoryCreateSchema.parse(value),
    body = JSON.stringify(input.draft);
  const previous = await first<Row>(
    env.DB,
    "SELECT * FROM jarvis_brain WHERE id=?",
    input.id,
  );
  if (previous) {
    if (previous.body_json !== body)
      throw new ApiFault(
        409,
        "memory_duplicate",
        "Esse ID já possui outro conteúdo.",
      );
    return { memory: decode(previous), statement: null };
  }
  const date = new Date().toISOString();
  const memory: BrainMemory = {
    ...input.draft,
    id: input.id,
    state: input.state,
    version: 1,
    createdAt: date,
    updatedAt: date,
    driveId: null,
    driveVersion: null,
    sync: "local",
  };
  return {
    memory,
    statement: stmt(
      env.DB,
      `INSERT OR IGNORE INTO jarvis_brain(id,body_json,state,created_at,updated_at)
    SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM jarvis_brain)<256 ${guard ? "AND (" + guard.sql + ")" : ""}`,
      input.id,
      body,
      input.state,
      date,
      date,
      ...(guard?.args ?? []),
    ),
  };
}
export async function prepareMemoryChange(
  env: Env,
  id: string,
  value: unknown,
  guard?: { sql: string; args: unknown[] },
) {
  const input = memoryChangeSchema.parse(value),
    old = await memoryById(env, id);
  if (old.version !== input.version)
    throw new ApiFault(
      409,
      "memory_conflict",
      "A memória mudou. Recarregue antes de alterar.",
    );
  if (input.operation === "excluir") {
    if (input.confirmation !== `EXCLUIR ${id}`)
      throw new ApiFault(
        400,
        "memory_confirmation",
        "Digite EXCLUIR seguido do ID da memória.",
      );
    if (old.driveId)
      throw new ApiFault(
        409,
        "memory_drive_link",
        "Remova primeiro o documento vinculado, com confirmação específica.",
      );
    return {
      memory: null,
      statement: stmt(
        env.DB,
        `DELETE FROM jarvis_brain WHERE id=? AND version=? ${guard ? "AND (" + guard.sql + ")" : ""}`,
        id,
        old.version,
        ...(guard?.args ?? []),
      ),
    };
  }
  if (input.operation === "corrigir" && !input.draft)
    throw new ApiFault(400, "memory_draft", "Informe a correção completa.");
  if (input.operation === "aprovar" && old.state !== "proposta")
    throw new ApiFault(
      409,
      "memory_state",
      "Somente propostas podem ser aprovadas.",
    );
  const draft = input.draft ?? {
    type: old.type,
    title: old.title,
    summary: old.summary,
    keywords: old.keywords,
    project: old.project,
    origin: old.origin,
    certainty: old.certainty,
  };
  const state =
    input.operation === "aprovar"
      ? "confirmada"
      : input.operation === "arquivar"
        ? "arquivada"
        : old.state;
  const date = new Date().toISOString();
  return {
    memory: {
      ...old,
      ...draft,
      state,
      version: old.version + 1,
      updatedAt: date,
      sync: old.driveId ? "pendente" : "local",
    } as BrainMemory,
    statement: stmt(
      env.DB,
      `UPDATE jarvis_brain SET body_json=?,state=?,version=version+1,updated_at=?,sync=CASE WHEN drive_id IS NULL THEN 'local' ELSE 'pendente' END
      WHERE id=? AND version=? ${guard ? "AND (" + guard.sql + ")" : ""}`,
      JSON.stringify(draft),
      state,
      date,
      id,
      old.version,
      ...(guard?.args ?? []),
    ),
  };
}
export async function applyMemory(
  env: Env,
  prepared:
    | Awaited<ReturnType<typeof prepareMemoryCreate>>
    | Awaited<ReturnType<typeof prepareMemoryChange>>,
) {
  if (prepared.statement && !(await prepared.statement.run()).meta.changes)
    throw new ApiFault(
      409,
      "memory_conflict",
      "Limite de 256 memórias ou alteração concorrente. Recarregue a memória.",
    );
  return prepared.memory;
}
export async function executeMemoryRead(
  env: Env,
  command: MemoryCommand,
  candidateIds?: string[] | null,
): Promise<{
  answer: import("../packages/contracts/jarvis").Answer;
  memoryPending?: MemoryPending | null;
  memoryCandidates?: string[];
}> {
  if (command.action === "manage")
    return { answer: dialogueAnswer(command.query) };
  if (command.action === "cancelCorrection")
    return {
      answer: dialogueAnswer(
        "Correção cancelada. A memória original foi preservada.",
      ),
      memoryPending: null,
    };
  if (command.action === "correct") {
    if (candidateIds && candidateIds.length > 1)
      return {
        answer: dialogueAnswer(
          "Há mais de uma memória candidata. Consulte uma pelo ID ou selecione o registro em Memória do Jarvis antes de corrigir. Nenhuma alteração foi proposta.",
        ),
        memoryPending: null,
        memoryCandidates: candidateIds.slice(0, 2),
      };
    const candidates = (
      await listMemories(env, {
        q: "",
        type: command.type,
        state: "confirmada",
      })
    ).filter((m) => (candidateIds ? candidateIds.includes(m.id) : true));
    if (candidates.length !== 1)
      return {
        answer: dialogueAnswer(
          candidates.length
            ? "Há mais de uma memória candidata. Consulte uma pelo ID ou selecione o registro em Memória do Jarvis antes de corrigir. Nenhuma alteração foi proposta."
            : "Não identifiquei uma memória confirmada para corrigir. Consulte o registro pelo ID ou selecione-o em Memória do Jarvis.",
        ),
        memoryPending: null,
        memoryCandidates: candidates.map((m) => m.id),
      };
    const old = candidates[0];
    const draft: MemoryDraft = {
      type: old.type,
      title: command.summary.slice(0, 120),
      summary: command.summary,
      keywords: [
        ...new Set([...old.keywords, ...memoryKeywords(command.summary)]),
      ].slice(0, 16),
      project: old.project,
      origin: old.origin,
      certainty: old.certainty,
    };
    return {
      answer: dialogueAnswer(
        `Proponho corrigir exclusivamente a memória ${old.id}, versão ${old.version}: “${old.summary}” → “${draft.summary}”. Confirma esta alteração?`,
      ),
      memoryPending: {
        id: old.id,
        version: old.version,
        title: old.title,
        operation: "correct",
        draft,
      },
      memoryCandidates: [old.id],
    };
  }
  if (command.action !== "search")
    throw Error("Memory write must be committed with dialogue");
  const found = await listMemories(env, {
    q: command.query,
    type: command.type,
  });
  const text = !found.length
    ? "Não possuo uma lembrança correspondente. Minha imaginação segue fora do expediente."
    : `${found.length > 1 ? "Encontrei várias lembranças; indique o ID para esclarecer qual deseja consultar." : "Encontrei esta lembrança."} São registros históricos; confirme se ainda se aplicam.\n` +
      found
        .slice(0, 5)
        .map(
          (m) =>
            `${m.id} · ${m.title}\n${found.length > 1 && m.summary.length > 240 ? m.summary.slice(0, 240) + "… (resumo completo na seção Memória)" : m.summary}\n${m.state} · ${m.certainty} · projeto: ${m.project ?? "não informado"} · origem: ${m.origin} · ${m.updatedAt}`,
        )
        .join("\n\n") +
      (found.length > 5 ? "\nRefine a busca na seção Memória do Jarvis." : "");
  return {
    answer: {
      ...dialogueAnswer(text),
      kind: undefined,
      source: "D1 · memória seletiva",
      incomplete: found.length > 1,
      stale: true,
    },
    memoryCandidates: found.slice(0, 2).map((m) => m.id),
  };
}
