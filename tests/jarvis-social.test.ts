import test from "node:test";
import assert from "node:assert/strict";
import { socialAnswer } from "../packages/contracts/jarvis-social";
import { interpretQuestion } from "../packages/contracts/jarvis-intents";
import { answerJarvis } from "../src/jarvis";
import type { Env } from "../src/env";
test("social phrases stay local and never access operational data", async () => {
  const env = new Proxy({} as Env, {
    get() {
      throw Error("Unexpected data access");
    },
  });
  for (const text of [
    "Bom dia",
    "boa tarde",
    "Boa noite!",
    "Olá",
    "oi",
    "Jarvis, está aí?",
    "Tudo bem?",
    "Como vai?",
    "Obrigado",
    "valeu",
    "Até mais",
    "tchau",
    "O que você faz?",
    "Quem é você?",
    "Olá Jarvis, tudo bem?",
    "Até mais, boa noite",
  ]) {
    const a = await answerJarvis(env, { text, area: "oportunidades" });
    assert.equal(a.kind, "social", text);
    assert.equal(a.source, "Interação local");
    assert.equal(a.syncedAt, null);
    assert.equal(a.intent, undefined);
    assert.equal(a.choices, undefined);
    assert.equal(a.action, undefined);
    assert.equal(a.ai.enabled, false);
  }
});
test("real requests take priority over social phrases, including write guards", () => {
  for (const [text, intent] of [
    ["Bom dia, Jarvis. Tenho clientes pendentes?", "opportunities.overdue"],
    ["Obrigado, quais artigos mais acessados?", "articles.top"],
    ["Quais rascunhos pendentes? Valeu", "drafts.pending"],
    ["Oi, chegou algum orçamento?", "opportunities.new"],
    ["Bom dia, envie newsletters", null],
    ["Bom dia, oportunidades", null],
    ["Olá, qual a capital da França?", null],
    ["Tudo bem com meus clientes?", null],
  ] as const) {
    assert.equal(socialAnswer(text), null, text);
    assert.equal(interpretQuestion(text, "for-you").intent, intent, text);
  }
});
test("social variations are deterministic and respect formal tone", () => {
  assert.deepEqual(socialAnswer("Oi", 1), socialAnswer("Oi", 1));
  assert.notEqual(socialAnswer("Oi", 0)?.text, socialAnswer("Oi", 1)?.text);
  assert.match(socialAnswer("Oi", 2, "discreto")!.text, /caos/);
  assert.doesNotMatch(socialAnswer("Oi", 2, "formal")!.text, /caos/);
  for (const text of [
    "obrigado pelo orçamento",
    "boa noite amanhã",
    "oi publique artigo",
    "quem é você no CRM?",
    "como vai meu site?",
  ])
    assert.equal(socialAnswer(text), null, text);
});

test("greetings do not hide identity, capabilities or farewell", () => {
  assert.match(socialAnswer("Oi Jarvis, quem é você?")!.text, /Sou Jarvis/);
  assert.match(
    socialAnswer("Bom dia, o que você faz?")!.text,
    /Posso consultar/,
  );
  assert.match(socialAnswer("Obrigado, até mais, boa noite")!.text, /Até/);
});
