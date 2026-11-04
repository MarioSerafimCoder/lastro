import type { Answer } from "./jarvis";
export const normalizeQuestion = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type Social =
  "greeting" | "wellbeing" | "thanks" | "farewell" | "help" | "identity";
// Consume complete social phrases only; any remaining text belongs to the query.
const phrases: [Social, string][] = [
  ["help", "o que voce faz"],
  ["help", "o que pode fazer"],
  ["identity", "quem e voce"],
  ["wellbeing", "tudo bem"],
  ["wellbeing", "como vai"],
  ["greeting", "bom dia"],
  ["greeting", "boa tarde"],
  ["greeting", "boa noite"],
  ["greeting", "voce esta ai"],
  ["greeting", "esta ai"],
  ["greeting", "ta ai"],
  ["greeting", "ola"],
  ["greeting", "oi"],
  ["greeting", "jarvis"],
  ["thanks", "muito obrigado"],
  ["thanks", "muito obrigada"],
  ["thanks", "obrigado"],
  ["thanks", "obrigada"],
  ["thanks", "valeu"],
  ["farewell", "ate mais"],
  ["farewell", "ate logo"],
  ["farewell", "tchau"],
];
const priority: Record<Social, number> = {
  greeting: 0,
  wellbeing: 1,
  thanks: 2,
  farewell: 3,
  help: 4,
  identity: 4,
};
function splitSocial(raw: string) {
  let rest = normalizeQuestion(raw),
    kind: Social | null = null;
  let matched = true;
  while (rest && matched) {
    matched = false;
    for (const [category, phrase] of phrases) {
      if (
        rest === phrase ||
        rest.startsWith(phrase + " ") ||
        rest.endsWith(" " + phrase)
      ) {
        if (!kind || priority[category] > priority[kind]) kind = category;
        rest =
          rest === phrase
            ? ""
            : rest.startsWith(phrase + " ")
              ? rest.slice(phrase.length).trim()
              : rest.slice(0, -phrase.length).trim();
        matched = true;
        break;
      }
    }
  }
  return { rest, kind };
}
export const stripSocialEdges = (raw: string) => splitSocial(raw).rest;
const replies: Record<Social, string[]> = {
  greeting: [
    "À disposição. O que deseja consultar?",
    "Olá. Por onde começamos?",
    "À disposição. Uma coisa de cada vez — até o caos agradece.",
  ],
  wellbeing: [
    "À disposição para ajudar. E você, por onde gostaria de começar?",
    "Pronto para a conversa. O que merece sua atenção hoje?",
  ],
  thanks: [
    "À disposição, sempre que precisar.",
    "Por nada. É para isso que estou aqui.",
    "Por nada. Discrição faz parte do serviço.",
  ],
  farewell: [
    "Até mais. Quando voltar, retomamos por aqui.",
    "Até logo. Desejo um bom descanso.",
  ],
  help: [
    "Posso consultar oportunidades novas e atrasadas, artigos mais acessados, rascunhos, artigos sem newsletter, desempenho das newsletters, resumo semanal, falhas de integração e referências sem uso, além de ajudar a preparar uma pauta. As ações dependem da sua revisão.",
  ],
  identity: [
    "Sou Jarvis, seu assistente no Lastro. Organizo consultas ao ecossistema e indico próximos passos com base nos dados disponíveis. As decisões continuam sendo suas.",
  ],
};
export function socialAnswer(
  raw: string,
  turn = 0,
  tone: "formal" | "discreto" = "formal",
): Answer | null {
  const { rest, kind } = splitSocial(raw);
  if (rest || !kind) return null;
  const options = replies[kind];
  const count = tone === "formal" && options.length === 3 ? 2 : options.length;
  const greeting = normalizeQuestion(raw).match(
    /^(bom dia|boa tarde|boa noite)\b/,
  )?.[1];
  const prefix =
    kind === "greeting" && greeting
      ? greeting[0].toUpperCase() + greeting.slice(1) + ". "
      : "";
  return {
    kind: "social",
    text: prefix + options[Math.abs(Math.trunc(turn)) % count],
    source: "Interação local",
    period: { label: "Conversa atual", from: null, to: "", days: null },
    syncedAt: null,
    incomplete: false,
    stale: false,
    ai: {
      enabled: false,
      reason: "Resposta social determinística, sem inferência.",
    },
  };
}
