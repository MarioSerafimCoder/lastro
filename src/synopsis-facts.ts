import { folded } from "./normalize";

const numberWords: Record<string, string> = {
  dois: "2",
  duas: "2",
  two: "2",
  tres: "3",
  three: "3",
  quatro: "4",
  four: "4",
  cinco: "5",
  five: "5",
  seis: "6",
  six: "6",
  sete: "7",
  seven: "7",
  oito: "8",
  eight: "8",
  nove: "9",
  nine: "9",
  dez: "10",
  ten: "10",
  onze: "11",
  eleven: "11",
  doze: "12",
  twelve: "12",
  treze: "13",
  thirteen: "13",
  catorze: "14",
  quatorze: "14",
  fourteen: "14",
  quinze: "15",
  fifteen: "15",
  dezesseis: "16",
  sixteen: "16",
  dezessete: "17",
  seventeen: "17",
  dezoito: "18",
  eighteen: "18",
  dezenove: "19",
  nineteen: "19",
  vinte: "20",
  twenty: "20",
};
export function numericAnchors(text: string) {
  const f = folded(text);
  return new Set([
    ...(
      f.match(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?:\s*%)?(?![\p{L}\p{N}])/gu) ??
      []
    ).map((n) => n.replace(/\s+/g, "")),
    ...(f.match(/\b[a-z]+\b/g) ?? []).flatMap((w) =>
      numberWords[w] ? [numberWords[w]] : [],
    ),
  ]);
}
const monthGroups = [
  "janeiro january jan",
  "fevereiro february feb fev",
  "marco march mar",
  "abril april apr abr",
  "maio may mai",
  "junho june jun",
  "julho july jul",
  "agosto august aug ago",
  "setembro september sep sept set",
  "outubro october oct out",
  "novembro november nov",
  "dezembro december dec dez",
];
const months = Object.fromEntries(
  monthGroups.flatMap((g, i) => g.split(" ").map((m) => [m, String(i + 1)])),
);
function dates(text: string) {
  const t = folded(text).replace(/\./g, "");
  const out = new Set<string>();
  for (const m of t.matchAll(
    /\b(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})\b/g,
  ))
    if (months[m[2]]) out.add(`${m[3]}-${months[m[2]]}-${Number(m[1])}`);
  for (const m of t.matchAll(/\b([a-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/g))
    if (months[m[1]]) out.add(`${m[3]}-${months[m[1]]}-${Number(m[2])}`);
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
    out.add(`${m[1]}-${Number(m[2])}-${Number(m[3])}`);
  return out;
}
export function anchorErrors(text: string, evidence: string) {
  const available = numericAnchors(evidence),
    errors: string[] = [];
  if ([...numericAnchors(text)].some((n) => !available.has(n)))
    errors.push("Número não sustentado pela evidência.");
  const sourceDates = dates(evidence);
  if ([...dates(text)].some((date) => !sourceDates.has(date)))
    errors.push("Data não sustentada pela evidência.");
  return errors;
}
// Exact quotes are provenance, not proof of entailment. Risky factual claims are
// held even if a model returns a positive opinion with a real but irrelevant quote.
export function scopeErrors(text: string, evidence: string) {
  const negative = /\b(nao|sem|not|without|never)\b/;
  const themes = [
    /\b(conformidade|compliance)\b/,
    /\b(metodo\w*|method\w*)\b/,
    /\b(resultado\w*|outcome\w*|results?)\b/,
    /\b(eficacia|efficacy|effectiveness)\b/,
    /\b(causalidade|causality)\b/,
  ];
  const denied =
    folded(evidence).match(/\b(?:nao|sem|not|without|never)\b[^.!?;]*/g) ?? [];
  return text.split(/(?<=[.!?])\s+/u).some((sentence) => {
    const s = folded(sentence);
    return (
      !negative.test(s) &&
      themes.some(
        (theme) => theme.test(s) && denied.some((clause) => theme.test(clause)),
      )
    );
  })
    ? ["O escopo afirmado conflita com uma limitação explícita da evidência."]
    : [];
}
export function automaticFactualErrors(text: string, evidence = "") {
  const t = folded(text),
    errors: string[] = [];
  if (
    /\b(comprov\w*|demonstr\w*|garant\w*|caus\w*|provoc\w*|cura|elimina\w*|eficac\w*|inovador\w*|bem-sucedid\w*|aument\w*|reduz\w*|melhora\w*|previne\w*|resultou|conclu\w*|revelou|todos|todas|sempre|nunca|definitiv\w*)\b/.test(
      t,
    ) ||
    /\b(leva a|levou a|devido a|por causa|mais eficaz|compreensao mais profunda)\b/.test(
      t,
    )
  )
    errors.push(
      "Conclusão, causalidade ou generalização exige revisão editorial.",
    );
  if (
    /\b(sera|serao|tera|terao|lancara|lancarao|preve|previsto|prevista)\b/.test(
      t,
    )
  )
    errors.push(
      "Afirmação sobre evento futuro exige revisão editorial de temporalidade.",
    );
  for (const sentence of text.split(/(?<=[.!?])\s+/u).filter(Boolean)) {
    const s = folded(sentence);
    if (
      !/\b(aborda\w*|discut\w*|examina\w*|apresenta\w*|explora\w*|descreve\w*|compara\w*|analis\w*|investiga\w*|contextualiza\w*|relata\w*|encontra\w*|argument\w*|enfatiza\w*|defende\w*|critica\w*|questiona\w*|contrapoe\w*|explica\w*|situa\w*|propoe\w*)\b/.test(
        s,
      ) &&
      !/\b(foco|enfoque|reflexao|percurso)\b/.test(s)
    )
      errors.push(
        "Afirmação além da descrição editorial exige revisão de suporte factual.",
      );
  }
  return [...new Set([...errors, ...scopeErrors(text, evidence)])];
}
