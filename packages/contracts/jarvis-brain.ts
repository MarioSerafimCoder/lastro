import { z } from "zod";
import Fuse from "fuse.js";
import { normalizeQuestion } from "./jarvis-social";

export const memoryTypes = [
  "preferencia",
  "decisao",
  "projeto",
  "aprendizado",
  "referencia",
] as const;
export const memoryDraftSchema = z
  .object({
    type: z.enum(memoryTypes),
    title: z.string().trim().min(3).max(120),
    summary: z.string().trim().min(3).max(1600),
    keywords: z.array(z.string().trim().min(1).max(40)).max(16).default([]),
    project: z.string().trim().min(1).max(100).nullable().default(null),
    origin: z.string().trim().min(1).max(240),
    certainty: z
      .enum(["fato", "preferencia", "hipotese", "provisoria"])
      .default("fato"),
  })
  .strict();
export type MemoryDraft = z.infer<typeof memoryDraftSchema>;
export type BrainMemory = MemoryDraft & {
  id: string;
  state: "proposta" | "confirmada" | "arquivada";
  version: number;
  createdAt: string;
  updatedAt: string;
  driveId: string | null;
  driveVersion: number | null;
  sync: "local" | "pendente" | "sincronizada" | "erro";
};
export const memoryCreateSchema = z
  .object({
    id: z.uuid(),
    draft: memoryDraftSchema,
    state: z.enum(["proposta", "confirmada"]),
  })
  .strict();
export const memoryChangeSchema = z
  .object({
    version: z.number().int().positive(),
    operation: z.enum(["corrigir", "aprovar", "arquivar", "excluir"]),
    draft: memoryDraftSchema.optional(),
    confirmation: z.string().max(100).optional(),
  })
  .strict();
export const memorySearchSchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    type: z.enum(memoryTypes).optional(),
    project: z.string().max(100).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    state: z.enum(["proposta", "confirmada", "arquivada"]).optional(),
  })
  .strict();
export type MemorySearch = z.infer<typeof memorySearchSchema>;
export function searchMemories(memories: BrainMemory[], filter: MemorySearch) {
  const candidates = memories.filter(
    (m) =>
      (filter.state ? m.state === filter.state : m.state !== "arquivada") &&
      (!filter.type || m.type === filter.type) &&
      (!filter.project ||
        normalizeQuestion(m.project ?? "") ===
          normalizeQuestion(filter.project)) &&
      (!filter.from || m.updatedAt >= filter.from) &&
      (!filter.to || m.updatedAt <= filter.to),
  );
  if (!filter.q)
    return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const q = normalizeQuestion(filter.q);
  const exact = candidates.filter(
    (m) =>
      m.id === filter.q ||
      m.driveId === filter.q ||
      [m.title, ...m.keywords].some((k) => normalizeQuestion(k) === q),
  );
  const normalized = candidates.map((m) => ({
    memory: m,
    title: normalizeQuestion(m.title),
    summary: normalizeQuestion(m.summary),
    keywords: [...m.keywords, ...memoryKeywords(m.summary)].map(
      normalizeQuestion,
    ),
    project: normalizeQuestion(m.project ?? ""),
  }));
  const fuzzy = new Fuse(normalized, {
    keys: ["title", "summary", "keywords", "project"],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.4,
    minMatchCharLength: 3,
  }).search(q);
  return [
    ...exact.sort(
      (a, b) =>
        Number(b.state === "confirmada") - Number(a.state === "confirmada"),
    ),
    ...fuzzy
      .filter((r) => !exact.some((m) => m.id === r.item.memory.id))
      .sort(
        (a, b) =>
          (a.score ?? 1) +
          (a.item.memory.state === "confirmada" ? 0 : 0.08) -
          ((b.score ?? 1) + (b.item.memory.state === "confirmada" ? 0 : 0.08)),
      )
      .map((r) => r.item.memory),
  ];
}
export type MemoryCommand =
  | { action: "create" | "propose"; id: string; draft: MemoryDraft }
  | { action: "approve" | "reject"; id: string; version: number }
  | { action: "correct"; summary: string; type?: BrainMemory["type"] }
  | { action: "update"; id: string; version: number; draft: MemoryDraft }
  | { action: "cancelCorrection" }
  | { action: "search"; query: string; type?: BrainMemory["type"] }
  | { action: "manage"; query: string };
export type MemoryPending =
  | { id: string; version: number; title: string; operation?: "approve" }
  | {
      id: string;
      version: number;
      title: string;
      operation: "correct";
      draft: MemoryDraft;
    };
// Curated vocabulary expands retrieval only; it never assigns a project or asserts a fact.
export function memoryKeywords(summary: string) {
  const n = normalizeQuestion(summary);
  return /\b(textos?|tom|comunicacao|humor|informal|formal|escrita|linguagem)\b/.test(
    n,
  )
    ? ["comunicação", "tom", "escrita"]
    : [];
}
export function memoryIntent(raw: string): MemoryCommand | null {
  const text = raw.replace(/^\s*Jarvis[,!:\s]+/i, "").trim();
  const n = normalizeQuestion(text);
  if (/^na verdade[, ]+/i.test(text)) {
    const summary = text.replace(/^na verdade[, ]+/i, "").trim();
    if (/^(eu )?prefiro\b/i.test(summary))
      return { action: "correct", summary, type: "preferencia" };
  }
  const explicit =
    /^(lembre(?:-se)?(?: que| de)?|guarde|salve|registre)\b/i.exec(text);
  if (
    /^(registre|salve|guarde)\s+(?:(?:uma?|o|a)\s+)?(?:oportunidade|lead|cliente|campanha|newsletter|artigo|rascunho)\b/i.test(
      text,
    )
  )
    return null;
  const preference =
    /^(prefiro|eu prefiro|decidimos|essa dire[cç][aã]o de arte foi aprovada)\b/i.test(
      text,
    );
  if (
    !explicit &&
    preference &&
    /\b(hoje|amanha|temporariamente|so agora|neste momento|senha|password|token|credencial|cpf|cnpj|cartao|dados bancarios|chave privada|chave api)\b/.test(
      n,
    )
  )
    return null;
  if (explicit || preference) {
    const summary = explicit ? text.slice(explicit[0].length).trim() : text;
    if (
      summary.length < 3 ||
      /^(essa|esta|isso|aquela|aquela decisao|essa decisao|esta decisao|essa pesquisa|esta pesquisa)$/.test(
        normalizeQuestion(summary),
      )
    )
      return {
        action: "manage",
        query:
          "Informe o conteúdo exato que deseja guardar; não vou adivinhar a decisão.",
      };
    const type = /prefiro|preferencia|humor/.test(n)
      ? "preferencia"
      : /decis|aprovad/.test(n)
        ? "decisao"
        : /pesquisa|referencia/.test(n)
          ? "referencia"
          : "aprendizado";
    const draft: MemoryDraft = {
      type,
      title: summary.slice(0, 120),
      summary: summary.slice(0, 1600),
      keywords: memoryKeywords(summary),
      project: null,
      origin: "Conversa com o proprietário",
      certainty: /talvez|hipotese/.test(n)
        ? "hipotese"
        : /provisori|por enquanto/.test(n)
          ? "provisoria"
          : type === "preferencia"
            ? "preferencia"
            : "fato",
    };
    return {
      action: explicit ? "create" : "propose",
      id: crypto.randomUUID(),
      draft,
    };
  }
  if (
    /^(corrija|corrigir|esqueca|esquecer|exclua|apague)\b.*(lembranca|memoria|informacao)/.test(
      n,
    )
  )
    return {
      action: "manage",
      query:
        "Abra Memória do Jarvis, selecione o registro e revise a alteração. Exclusões exigem o ID explícito.",
    };
  if (/preferencias/.test(n) && /^(mostre|mostrar|quais|minhas)/.test(n))
    return { action: "search", query: "", type: "preferencia" };
  if (
    /^(o que (voce )?lembra|lembra d|qual foi a decisao|busque (na )?memoria)/.test(
      n,
    )
  ) {
    const query = n
      .replace(
        /^(o que (voce )?lembra( sobre)?|lembra d[ao](quela|quele)?|qual foi a decisao( d[ao](quele|quela)?)?|busque (na )?memoria)\s*/,
        "",
      )
      .replace(/\?$/, "")
      .trim();
    const subject = query
      .replace(
        /^(daquela |daquele |aquela |aquele )?(decisao|decisoes)( sobre| do| da)?\s+/,
        "",
      )
      .replace(/^(sobre|do|da|o|a)\s+/, "");
    return {
      action: "search",
      query: /^(minha |a minha |meu |o meu )/.test(subject)
        ? subject.replace(/^(a minha |o meu |minha |meu )/, "")
        : subject,
      ...(/^qual foi a decisao/.test(n) ? { type: "decisao" as const } : {}),
    };
  }
  return null;
}
