import test from "node:test";
import assert from "node:assert/strict";
import {
  socialAnswer,
  clarificationChoice,
} from "../packages/contracts/jarvis-social";
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

test("presence variants from the real chat remain local, mixed requests remain operational", async () => {
  for (const text of [
    "olá Jarvis está por ai?",
    "oi, você tá por aí?",
    "Jarvis, consegue me ouvir?",
    "tá aí?",
    "Olá, tudo certo?",
  ]) {
    const reply = await answerJarvis(
      new Proxy({} as Env, {
        get() {
          throw Error("Unexpected data access");
        },
      }),
      { text, area: "for-you" },
    );
    assert.equal(reply.kind, "social", text);
    assert.equal(reply.choices, undefined);
  }
  assert.equal(
    socialAnswer("Olá Jarvis está por aí? Tenho clientes pendentes?"),
    null,
  );
  assert.equal(
    interpretQuestion(
      "Olá Jarvis está por aí? Tenho clientes pendentes?",
      "for-you",
    ).intent,
    "opportunities.overdue",
  );
});
test("clarification is conversational, scoped to the preceding alternatives", async () => {
  const reply = await answerJarvis({} as Env, {
    text: "oportunidades",
    area: "for-you",
  });
  assert.match(reply.text, /novos pedidos.*ou.*atrasados/);
  assert.deepEqual(
    reply.choices?.map((c) => c.intent),
    ["opportunities.new", "opportunities.overdue"],
  );
  assert.equal(
    clarificationChoice("as atrasadas", reply.choices),
    "opportunities.overdue",
  );
  assert.equal(
    clarificationChoice("novas", reply.choices),
    "opportunities.new",
  );
  for (const text of [
    "envie as atrasadas",
    "não quero atrasadas",
    "artigos",
    "qual a capital da França?",
  ])
    assert.equal(clarificationChoice(text, reply.choices), undefined);
  assert.equal(clarificationChoice("atrasadas", undefined), undefined);
  const outside = await answerJarvis({} as Env, {
    text: "qual a capital da França?",
    area: "for-you",
  });
  assert.equal(outside.choices, undefined);
  assert.doesNotMatch(outside.text, /admite mais/);
  const blocked = await answerJarvis({} as Env, {
    text: "Oi Jarvis, envie as newsletters",
    area: "for-you",
  });
  assert.equal(blocked.choices, undefined);
  assert.match(blocked.text, /Não executo/);
});
