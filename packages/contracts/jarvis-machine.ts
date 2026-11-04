import { memoryIntent, type MemoryPending } from "./jarvis-brain";
import { setup, assign, createActor } from "xstate";
import { labels, type Answer } from "./jarvis";
import { interpretQuestion } from "./jarvis-intents";
import {
  normalizeQuestion,
  stripSocialEdges,
  socialAnswer,
  clarificationChoice,
} from "./jarvis-social";
import { readPeriod, periodOnly } from "./jarvis-periods";
import {
  legacyIntent,
  type DialogueContext,
  type DialogueIntent,
  type Slots,
  type Metric,
  type Window,
} from "./jarvis-dialogue";

export const dialogueLabels: Record<DialogueIntent, string> = {
  ...labels,
  "analytics.total": "tráfego total do site",
  priorities: "prioridades do ecossistema",
};
const initial = (id: string): DialogueContext => ({
  version: 1,
  id,
  revision: 0,
  topic: null,
  intent: null,
  metric: "traffic",
  period: null,
  previous: null,
  pending: null,
  lastGrounded: null,
  response: null,
  plan: "reply",
  socialTurn: 0,
});
export function dialogueAnswer(
  text: string,
  period: Window | null = null,
): Answer {
  return {
    kind: "social",
    text,
    source: "Conversa contextual",
    period: {
      label: period?.label ?? "Conversa atual",
      from: period?.start ?? null,
      to: period?.end ?? "",
      days: period?.days === 7 ? 7 : period?.days === 30 ? 30 : null,
    },
    syncedAt: null,
    incomplete: false,
    stale: false,
    ai: { enabled: false, reason: "Diálogo determinístico, sem inferência." },
  };
}
const slots = (c: Slots): Slots => ({
  topic: c.topic,
  intent: c.intent,
  metric: c.metric,
  period: c.period,
});
const topicFor = (intent: DialogueIntent) => intent.split(".")[0];
function metricFor(text: string): Metric | null {
  if (/\b(sessoes|sessao)\b/.test(text)) return "sessions";
  if (/\b(visualizacoes|visualizacao|pageviews)\b/.test(text)) return "views";
  if (/\b(usuarios|usuario|pessoas)\b/.test(text)) return "users";
  if (/engajamento/.test(text)) return "engagement";
  if (/\b(acessos|trafego|visitas)\b/.test(text)) return "traffic";
  return null;
}
const needsPeriod = (i: DialogueIntent) =>
  ["analytics.total", "articles.top", "newsletters.performance"].includes(i);
type Message = {
  type: "MESSAGE";
  text: string;
  area: string;
  clock: number;
  tone: "formal" | "discreto";
};
type Event =
  | Message
  | {
      type: "RESULT";
      answer: Answer;
      unavailable?: boolean;
      memoryPending?: MemoryPending | null;
      memoryCandidates?: string[];
    }
  | { type: "FAIL" };

function interpret(c: DialogueContext, event: Message): DialogueContext {
  const next = {
    ...c,
    revision: c.revision + 1,
    plan: "reply" as const,
    memoryCommand: null,
    memoryCandidates: null,
  };
  const say = (
    text: string,
    patch: Partial<DialogueContext> = {},
  ): DialogueContext => ({
    ...next,
    ...patch,
    response: dialogueAnswer(text, patch.period ?? next.period),
  });
  const raw = event.text,
    text = stripSocialEdges(raw),
    normalized = normalizeQuestion(raw);
  const memory = memoryIntent(raw);
  if (memory) {
    const proposing = memory.action === "propose";
    return {
      ...next,
      pending: null,
      memoryCommand: memory,
      plan: "query",
      response: null,
      memoryCandidates:
        memory.action === "correct"
          ? c.memoryCandidates
          : memory.action === "create" || memory.action === "propose"
            ? [memory.id]
            : null,
      memoryPending: proposing
        ? { id: memory.id, version: 1, title: memory.draft.title }
        : null,
    };
  }
  if (
    c.memoryPending &&
    /^(sim|confirmo|aprovar|nao|rejeitar|cancelar)$/.test(normalized)
  ) {
    const approved = /^(sim|confirmo|aprovar)$/.test(normalized);
    return {
      ...next,
      pending: null,
      memoryPending: null,
      plan: "query",
      response: null,
      memoryCandidates: [c.memoryPending.id],
      memoryCommand:
        c.memoryPending.operation === "correct"
          ? approved
            ? {
                action: "update",
                id: c.memoryPending.id,
                version: c.memoryPending.version,
                draft: c.memoryPending.draft,
              }
            : { action: "cancelCorrection" }
          : {
              action: approved ? "approve" : "reject",
              id: c.memoryPending.id,
              version: c.memoryPending.version,
            },
    };
  }
  // A different substantive message cancels the scope of a bare confirmation.
  next.memoryPending = null;
  const period = readPeriod(text, event.clock, c.period);
  const found = interpretQuestion(text, event.area);
  // Guards are checked before any interpretation of confirmations or context.
  if (found.prohibitedWrite)
    return say(
      "Não envio, publico ou excluo pela conversa. Posso apresentar os dados e uma ação para sua revisão.",
      { pending: null },
    );
  if (
    /^(nao|nao obrigado|cancela|cancelar|deixa pra la|esquece)$/.test(
      normalized,
    )
  )
    return say(
      "Certo. Cancelei essa pergunta. Sobre o que gostaria de falar?",
      { pending: null },
    );
  const social = socialAnswer(raw, c.socialTurn, event.tone);
  if (social)
    return { ...next, response: social, socialTurn: c.socialTurn + 1 };
  if (
    /^(sim|isso|isso mesmo|pode ser|confirmo|pode consultar)$/.test(normalized)
  ) {
    if (!c.pending)
      return say(
        "Não tenho uma pergunta pendente para confirmar. O que deseja consultar?",
      );
    if (
      c.pending.kind !== "confirmation" ||
      c.pending.alternatives.length !== 1
    )
      return say(c.pending.question);
    return prepare(
      {
        ...next,
        intent: c.pending.alternatives[0],
        topic: topicFor(c.pending.alternatives[0]),
        pending: null,
      },
      period,
    );
  }
  if (
    /\b(voltar ao assunto anterior|retomar(?: o)? anterior|assunto anterior|volte ao anterior)\b/.test(
      text,
    )
  ) {
    if (!c.previous)
      return say("Ainda não tenho um assunto anterior para retomar.");
    return prepare(
      { ...next, ...c.previous, previous: slots(c), pending: null },
      null,
    );
  }
  if (/^(abrir|ver|mostrar)( os)? detalhes$/.test(text)) {
    if (c.intent && c.lastGrounded?.action)
      return prepare({ ...next, pending: null }, null);
    return say(
      "De qual assunto deseja abrir os detalhes? Posso consultar oportunidades, artigos ou rascunhos e apresentar a ação para sua revisão.",
    );
  }
  const metric = metricFor(text);
  let explicit: DialogueIntent | null = null;
  if (
    /\b(importante|prioridades|prioridade|merece (?:minha )?atencao)\b/.test(
      text,
    )
  )
    explicit = "priorities";
  else if (
    /\b(site|portfolio|trafego)\b/.test(text) &&
    !/\b(artigos?|posts?|newsletter)\b/.test(text)
  )
    explicit = "analytics.total";
  else if (
    /\b(artigos|posts)\b/.test(text) &&
    !/newsletter|distribui/.test(text) &&
    /acess|visita|lido|visualiz|^e os artigos$/.test(text)
  )
    explicit = "articles.top";
  else explicit = periodOnly(text) ? null : found.intent;
  // A direct new topic wins over pending alternatives. Short replies only use offered alternatives.
  const chosen = clarificationChoice(
    text,
    c.pending?.alternatives
      .filter(legacyIntent)
      .map((intent) => ({ intent, label: labels[intent] })),
  );
  if (!explicit && chosen) explicit = chosen;
  if (
    !explicit &&
    c.intent?.startsWith("opportunities.") &&
    /^(e )?(os |as )?(pendentes|atrasadas|atrasados|novas|novos)$/.test(text)
  )
    explicit = /nov/.test(text) ? "opportunities.new" : "opportunities.overdue";
  if (
    !explicit &&
    /^(e )?(os |as )?(rascunhos|artigos|newsletters|referencias)$/.test(text)
  )
    explicit = text.includes("rascunhos")
      ? "drafts.pending"
      : text.includes("newsletters")
        ? "newsletters.performance"
        : text.includes("artigos")
          ? "articles.top"
          : "research.unused";
  const metricOnly =
    /^(e )?(as |os |o )?(sessoes|sessao|visualizacoes|usuarios ativos|usuarios|engajamento|acessos)$/.test(
      text,
    );
  const followPeriod =
    periodOnly(text) || (c.pending?.kind === "period" && period !== null);
  if (!explicit && c.pending && c.pending.kind !== "period" && followPeriod)
    return say(c.pending.question, {
      period: period && period !== "unsupported" ? period : c.period,
    });
  if (!explicit && (followPeriod || metricOnly)) {
    if (!c.intent)
      return say(
        "Esse período ou métrica se refere ao tráfego do site, aos artigos ou a outro assunto?",
      );
    return prepare(
      { ...next, metric: metric ?? c.metric, pending: null },
      period,
    );
  }
  if (explicit) {
    const changed = c.intent && topicFor(explicit) !== c.topic;
    return prepare(
      {
        ...next,
        intent: explicit,
        topic: topicFor(explicit),
        metric: metric ?? (changed ? "traffic" : c.metric),
        previous: changed ? slots(c) : c.previous,
        pending: null,
      },
      period,
    );
  }
  const alternatives = found.entities.length
    ? found.choices.map((v) => v.intent)
    : [];
  if (alternatives.length) {
    const question =
      alternatives.length === 1
        ? `Você quer consultar ${dialogueLabels[alternatives[0]]}?`
        : `Você quer saber sobre ${alternatives.map((i) => dialogueLabels[i].toLowerCase()).join(" ou ")}?`;
    return say(question, {
      pending: {
        kind: alternatives.length === 1 ? "confirmation" : "clarification",
        question,
        alternatives,
      },
      ...(period && period !== "unsupported" ? { period } : {}),
    });
  }
  if (c.pending) return say(`Ainda preciso esclarecer: ${c.pending.question}`);
  return say(
    "Posso ajudar com o Lastro: tráfego do site, artigos, rascunhos, newsletters, oportunidades e referências. Qual desses assuntos você quer explorar?",
  );
}
function prepare(
  c: DialogueContext,
  p: Window | "unsupported" | null,
): DialogueContext {
  const period = p === "unsupported" ? c.period : (p ?? c.period);
  if (p === "unsupported" || (c.intent && needsPeriod(c.intent) && !period)) {
    const question =
      p === "unsupported"
        ? "Não consigo determinar esse período. Deseja consultar os últimos sete ou trinta dias?"
        : "Deseja consultar os últimos sete ou trinta dias?";
    return {
      ...c,
      period,
      pending: { kind: "period", question, alternatives: [] },
      plan: "reply",
      response: dialogueAnswer(question),
    };
  }
  return { ...c, period, pending: null, plan: "query", response: null };
}
export const dialogueMachine = setup({
  types: {
    context: {} as DialogueContext,
    events: {} as Event,
    input: {} as { id: string },
  },
  actions: {
    interpret: assign(({ context, event }) =>
      event.type === "MESSAGE" ? interpret(context, event) : context,
    ),
    receive: assign(({ context, event }) =>
      event.type === "RESULT"
        ? {
            response: event.answer,
            ...(event.memoryPending !== undefined
              ? { memoryPending: event.memoryPending }
              : {}),
            ...(event.memoryCandidates !== undefined
              ? { memoryCandidates: event.memoryCandidates }
              : {}),
            lastGrounded: event.unavailable
              ? context.lastGrounded
              : event.answer,
            pending: event.unavailable
              ? {
                  kind: "period" as const,
                  question:
                    "Deseja tentar os últimos sete ou trinta dias disponíveis?",
                  alternatives: [],
                }
              : null,
          }
        : {},
    ),
    fail: assign({
      memoryPending: () => null,
      memoryCommand: () => null,
      response: () =>
        dialogueAnswer(
          "Não consegui consultar agora. Seu assunto foi preservado; tente novamente.",
        ),
      plan: () => "reply" as const,
    }),
  },
  guards: {
    query: ({ context }) => context.plan === "query",
    period: ({ context }) => context.pending?.kind === "period",
    confirmation: ({ context }) => context.pending?.kind === "confirmation",
    clarification: ({ context }) => context.pending?.kind === "clarification",
  },
}).createMachine({
  id: "jarvis3",
  initial: "idle",
  context: ({ input }) => initial(input.id),
  on: { MESSAGE: { target: ".interpreting", actions: "interpret" } },
  states: {
    idle: {},
    interpreting: {
      always: [
        { guard: "query", target: "ready_to_query" },
        { target: "responding" },
      ],
    },
    ready_to_query: {
      on: {
        RESULT: { target: "responding", actions: "receive" },
        FAIL: { target: "responding", actions: "fail" },
      },
    },
    responding: {
      always: [
        { guard: "period", target: "awaiting_period" },
        { guard: "confirmation", target: "awaiting_confirmation" },
        { guard: "clarification", target: "awaiting_clarification" },
        { target: "resolved" },
      ],
    },
    awaiting_period: {},
    awaiting_confirmation: {},
    awaiting_clarification: {},
    resolved: {},
  },
});
export function newDialogue(id: string, snapshot?: unknown) {
  return createActor(dialogueMachine, {
    input: { id },
    ...(snapshot ? { snapshot: snapshot as any } : {}),
  }).start();
}
