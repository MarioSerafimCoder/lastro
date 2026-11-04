import test from "node:test";
import assert from "node:assert/strict";
import {
  newDialogue,
  dialogueAnswer,
} from "../packages/contracts/jarvis-machine";
import { readPeriod } from "../packages/contracts/jarvis-periods";
import type {
  DialogueIntent,
  Metric,
} from "../packages/contracts/jarvis-dialogue";
const clock = Date.parse("2026-11-04T12:00:00Z");
type Step = [string, string, (DialogueIntent | null)?, Metric?];
const scenarios: Record<string, Step[]> = {
  A: [
    ["Bom dia, Jarvis", "resolved"],
    ["Tem alguma coisa importante?", "query", "priorities"],
    ["e oportunidades?", "awaiting_clarification"],
    ["sim", "awaiting_clarification"],
    ["novas", "query", "opportunities.new"],
    ["e pendentes?", "query", "opportunities.overdue"],
    ["obrigado", "resolved"],
    ["e antes?", "awaiting_period"],
    ["sete", "query", "opportunities.overdue"],
    ["tchau", "resolved"],
  ],
  B: [
    ["quantos acessos teve meu site?", "awaiting_period", "analytics.total"],
    ["sim", "awaiting_period"],
    ["Sete.", "query", "analytics.total", "traffic"],
    ["e sessões?", "query", "analytics.total", "sessions"],
    ["e antes?", "query", "analytics.total", "sessions"],
    ["e os artigos?", "query", "articles.top"],
    ["trinta dias", "query", "articles.top"],
    ["e as newsletters?", "query", "newsletters.performance"],
    ["voltar ao assunto anterior", "query", "articles.top"],
    ["obrigado", "resolved"],
  ],
  C: [
    ["clientes novos", "query", "opportunities.new"],
    ["pendentes", "query", "opportunities.overdue"],
    ["oportunidades", "awaiting_clarification"],
    ["sim", "awaiting_clarification"],
    ["não", "resolved"],
    ["oportunidades", "awaiting_clarification"],
    ["as atrasadas", "query", "opportunities.overdue"],
    ["abrir detalhes", "resolved"],
    ["envie uma resposta ao cliente", "resolved"],
    ["clientes novos hoje", "query", "opportunities.new"],
    ["até mais", "resolved"],
  ],
  D: [
    ["resumo", "awaiting_confirmation"],
    ["sim", "query", "ecosystem.weekly"],
    ["e rascunhos", "query", "drafts.pending"],
    ["e os artigos?", "awaiting_period", "articles.top"],
    ["sete", "query", "articles.top"],
    ["e newsletters?", "query", "newsletters.performance"],
    ["novos clientes", "query", "opportunities.new"],
    ["assunto anterior", "query", "newsletters.performance"],
    ["e referências?", "query", "research.unused"],
    ["preparar briefing", "query", "editorial.prepare"],
    ["tchau", "resolved"],
  ],
  E: [
    ["me ajuda", "resolved"],
    ["oportunidades", "awaiting_clarification"],
    ["sim", "awaiting_clarification"],
    ["não", "resolved"],
    ["sim", "resolved"],
    ["integracoes", "awaiting_confirmation"],
    ["sete", "awaiting_confirmation"],
    ["sim", "query", "integrations.failures"],
    ["qual a capital da França?", "resolved"],
    ["como vai?", "resolved"],
  ],
  G: [
    ["acessos do site mês passado", "awaiting_period", "analytics.total"],
    ["sete", "query", "analytics.total"],
    ["e antes?", "query", "analytics.total"],
    ["usuários ativos", "query", "analytics.total", "users"],
    ["hoje", "query", "analytics.total"],
    ["ontem", "query", "analytics.total"],
    ["semana passada", "query", "analytics.total"],
    ["esta semana", "query", "analytics.total"],
    ["nessa última semana", "query", "analytics.total"],
    ["trinta", "query", "analytics.total"],
    ["e antes?", "query", "analytics.total"],
    ["valeu", "resolved"],
  ],
};
for (const [name, steps] of Object.entries(scenarios))
  test(`dialogue ${name}: ${steps.length} messages with restored XState actors`, () => {
    let actor = newDialogue("test"),
      snapshot: unknown;
    for (const [text, state, intent, metric] of steps) {
      actor.send({
        type: "MESSAGE",
        text,
        area: "for-you",
        clock,
        tone: "discreto",
      });
      const current = actor.getSnapshot();
      assert.equal(
        String(current.value),
        state === "query" ? "ready_to_query" : state,
        `${name}: ${text}`,
      );
      if (intent) assert.equal(current.context.intent, intent, text);
      if (metric) assert.equal(current.context.metric, metric, text);
      if (state === "query")
        actor.send({
          type: "RESULT",
          answer: {
            ...dialogueAnswer("Resultado sintético de teste."),
            kind: undefined,
            source: "Fixture isolada",
            syncedAt: new Date(clock).toISOString(),
          },
        });
      snapshot = JSON.parse(JSON.stringify(actor.getPersistedSnapshot()));
      actor.stop();
      actor = newDialogue("test", snapshot);
    }
    assert.equal(actor.getSnapshot().context.revision, steps.length);
    actor.stop();
  });
test("calendar periods distinguish rolling days, civil weeks, Fortaleza midnight and previous windows", () => {
  assert.deepEqual(readPeriod("nessa ultima semana", clock), {
    start: "2026-10-28",
    end: "2026-11-04",
    label: "Últimos 7 dias completos",
    kind: "rolling",
    days: 7,
  });
  const last = readPeriod("semana passada", clock);
  assert.notEqual(last, "unsupported");
  assert.equal((last as any).start, "2026-10-26");
  assert.equal((last as any).end, "2026-11-02");
  assert.equal(
    (readPeriod("ontem", Date.parse("2026-11-04T02:00:00Z")) as any).start,
    "2026-11-02",
  );
  assert.equal(
    (readPeriod("antes", clock, last as any) as any).start,
    "2026-10-19",
  );
});
test("pending questions survive social exchanges; yes never confirms writes", () => {
  const actor = newDialogue("test");
  for (const text of ["oportunidades", "oi", "obrigado", "sim"]) {
    actor.send({
      type: "MESSAGE",
      text,
      area: "for-you",
      clock,
      tone: "formal",
    });
    assert.equal(String(actor.getSnapshot().value), "awaiting_clarification");
  }
  actor.send({
    type: "MESSAGE",
    text: "envie as newsletters",
    area: "for-you",
    clock,
    tone: "formal",
  });
  assert.equal(actor.getSnapshot().context.pending, null);
  assert.equal(actor.getSnapshot().context.plan, "reply");
  actor.send({
    type: "MESSAGE",
    text: "sim",
    area: "for-you",
    clock,
    tone: "formal",
  });
  assert.equal(actor.getSnapshot().context.plan, "reply");
  actor.stop();
});
