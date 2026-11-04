import { intents, labels, type Intent, type Period } from "./jarvis";
import Fuse from "fuse.js";
import { normalizeQuestion, stripSocialEdges } from "./jarvis-social";
export { normalizeQuestion } from "./jarvis-social";
const terms: Record<Intent, [string[], string[]]> = {
  "opportunities.new": [
    [
      "oportunidade",
      "oportunidades",
      "orcamento",
      "orcamentos",
      "cliente",
      "clientes",
      "contato",
      "contatos",
      "pedido",
      "pedidos",
      "lead",
      "leads",
      "prospecto",
      "prospectos",
    ],
    [
      "novo",
      "novos",
      "nova",
      "novas",
      "recebido",
      "recebidos",
      "responder",
      "atender",
      "sem atendimento",
    ],
  ],
  "opportunities.overdue": [
    [
      "oportunidade",
      "oportunidades",
      "orcamento",
      "orcamentos",
      "cliente",
      "clientes",
      "contato",
      "contatos",
      "pedido",
      "pedidos",
      "lead",
      "leads",
      "prospecto",
      "prospectos",
      "follow up",
    ],
    [
      "atrasado",
      "atrasados",
      "atrasada",
      "atrasadas",
      "vencido",
      "vencidos",
      "vencida",
      "vencidas",
      "acompanhamento",
      "follow up",
      "pendente",
      "pendentes",
      "retorno",
    ],
  ],
  "articles.top": [
    ["artigo", "artigos", "pagina", "blog", "audiencia"],
    [
      "mais acessado",
      "mais acessados",
      "mais lido",
      "mais lidos",
      "popular",
      "populares",
      "top",
      "visitas",
      "acesso",
      "acessos",
      "visualizacoes",
      "bombou",
    ],
  ],
  "drafts.pending": [
    ["rascunho", "rascunhos", "studio", "texto"],
    ["pendente", "pendentes", "parado", "parados", "continuar", "retomar"],
  ],
  "articles.without_newsletter": [
    ["artigo", "artigos", "publicacao", "publicado"],
    [
      "sem newsletter",
      "sem distribuicao",
      "nao distribuido",
      "nao distribuidos",
      "nao distribuidas",
      "sem envio",
    ],
  ],
  "newsletters.performance": [
    ["newsletter", "newsletters", "campanha", "campanhas", "cafezinho"],
    [
      "desempenho",
      "performance",
      "resultado",
      "resultados",
      "trafego",
      "sessao",
      "sessoes",
      "visitas",
      "engajamento",
    ],
  ],
  "ecosystem.weekly": [
    ["ecossistema", "resumo", "balanco"],
    ["semana", "semanal", "semanais", "semanario", "7 dias"],
  ],
  "integrations.failures": [
    ["integracao", "integracoes", "servico", "servicos", "sincronizacao"],
    [
      "falha",
      "falhas",
      "erro",
      "erros",
      "problema",
      "problemas",
      "indisponivel",
    ],
  ],
  "research.unused": [
    ["referencia", "referencias", "pesquisa", "repertorio"],
    [
      "sem uso",
      "nao usada",
      "nao usadas",
      "nao utilizado",
      "aproveitar",
      "disponivel",
    ],
  ],
  "editorial.prepare": [
    ["briefing", "pauta", "oficina", "proposta editorial"],
    ["preparar", "montar", "criar", "organizar", "comecar"],
  ],
};
type IntentPhrase = { intent: Intent; phrase: string };
const sourcePhrases: IntentPhrase[] = [
  ...[
    "tem cliente me esperando",
    "chegou algum orcamento",
    "alguem pediu projeto",
    "algum pedido de orcamento novo",
    "contatos aguardando atendimento",
    "orcamentos recebidos recentemente",
    "chegou pedido de cliente",
    "novos pedidos para analisar",
    "recebi algum orcamento",
    "recebeu novo pedido",
    "chegou cliente novo",
    "orcamento acabou de chegar",
  ].map((phrase) => ({ intent: "opportunities.new" as const, phrase })),
  ...[
    "quem esta esperando retorno",
    "tem lead parado",
    "estou devendo resposta para alguem",
    "cliente esperando uma resposta",
    "orcamento pendente de retorno",
    "acompanhamento atrasado de cliente",
    "lead sem resposta ha dias",
    "quem precisa de um retorno",
  ].map((phrase) => ({ intent: "opportunities.overdue" as const, phrase })),
  ...[
    "como anda meu site",
    "qual post bombou",
    "o que estao lendo",
    "artigos com mais acesso",
    "artigos com mais acessos",
    "artigo mais acessos",
    "artigos mais vistos",
    "posts populares do blog",
    "conteudos mais lidos",
    "trafego do blog",
    "pagina mais visitada",
  ].map((phrase) => ({ intent: "articles.top" as const, phrase })),
  ...[
    "tenho textos pela metade",
    "o que falta publicar",
    "tem rascunho parado",
    "textos esperando continuacao",
    "o que preciso terminar no studio",
    "rascunhos aguardando revisao",
    "quais textos estao incompletos",
  ].map((phrase) => ({ intent: "drafts.pending" as const, phrase })),
  ...[
    "tem artigo sem divulgacao",
    "publicacao ainda nao divulgada",
    "artigo sem distribuicao",
    "quais artigos faltam compartilhar",
    "artigo sem campanha de newsletter",
    "texto publicado que nao foi divulgado",
    "publicacoes sem newsletter vinculada",
  ].map((phrase) => ({
    intent: "articles.without_newsletter" as const,
    phrase,
  })),
  ...[
    "como anda o cafezinho",
    "minha newsletter trouxe visitas",
    "quais campanhas tiveram resultado",
    "trafego vindo da newsletter",
    "engajamento das campanhas de email",
    "visitas geradas pelo cafezinho",
    "campanhas com melhor desempenho",
    "newsletter esta trazendo leitores",
  ].map((phrase) => ({
    intent: "newsletters.performance" as const,
    phrase,
  })),
  ...[
    "o que aconteceu essa semana",
    "o que rolou essa semana",
    "balanco semanal do ecossistema",
    "resumo dos ultimos sete dias",
    "atividade desta semana no lastro",
    "como foi a semana da operacao",
    "como foi minha semana",
    "principais acontecimentos da semana",
  ].map((phrase) => ({ intent: "ecosystem.weekly" as const, phrase })),
  ...[
    "esta tudo funcionando",
    "tem algo dando problema",
    "alguma coisa quebrou no sistema",
    "integracoes fora do ar",
    "falhas na sincronizacao",
    "servicos com erro",
    "algo parou de funcionar",
    "status das integracoes",
    "falhas na integracao",
    "falhas de integracao",
    "problemas de integracao",
  ].map((phrase) => ({
    intent: "integrations.failures" as const,
    phrase,
  })),
  ...[
    "o que posso aproveitar das pesquisas",
    "referencias ainda sem uso",
    "fontes que nao usei em artigos",
    "pesquisas que ainda nao viraram texto",
    "o que esta guardado para aproveitar",
    "referencias sem vinculo com rascunhos",
  ].map((phrase) => ({ intent: "research.unused" as const, phrase })),
  ...[
    "me ajuda a comecar um artigo",
    "preparar uma pauta editorial",
    "montar um briefing para o proximo texto",
    "quero estruturar um artigo novo",
    "abrir oficina para pensar uma pauta",
    "planejar a proxima publicacao",
  ].map((phrase) => ({ intent: "editorial.prepare" as const, phrase })),
];
const filler = new Set([
  "a",
  "as",
  "o",
  "os",
  "um",
  "uma",
  "uns",
  "umas",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "no",
  "na",
  "nos",
  "nas",
  "ao",
  "aos",
  "em",
  "por",
  "para",
  "com",
  "que",
  "qual",
  "quais",
  "quem",
  "como",
  "meu",
  "minha",
  "meus",
  "minhas",
  "tem",
  "tenho",
  "teve",
  "foi",
  "tudo",
  "essa",
  "este",
  "esta",
  "nesta",
  "neste",
  "desta",
  "deste",
  "ajuda",
  "favor",
  "lastro",
]);
const compact = (value: string) =>
  value
    .split(" ")
    .filter((word) => word && !filler.has(word))
    .join(" ");
const phrases = sourcePhrases.map((item) => ({
  ...item,
  phrase: compact(item.phrase),
}));
const fuse = new Fuse(phrases, {
  keys: ["phrase"],
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.42,
  minMatchCharLength: 3,
});
function has(text: string, term: string) {
  return (" " + text + " ").includes(" " + term + " ");
}
export function interpretQuestion(raw: string, area: string, choice?: Intent) {
  const text = stripSocialEdges(raw);
  const ranked = intents
    .map((intent) => {
      const [entities, verbs] = terms[intent];
      const e = entities.some((t) => has(text, t)),
        v = verbs.some((t) => has(text, t));
      let score = (e ? 3 : 0) + (v ? 4 : 0);
      if (e && v) score += 3;
      if (
        e &&
        ((area === "oportunidades" && intent.startsWith("opportunities.")) ||
          (area === "newsletters" && intent === "newsletters.performance"))
      )
        score += 1;
      return { intent, score, entity: e, verb: v };
    })
    .sort((a, b) => b.score - a.score);
  const unsupportedTime =
    /\b(ontem|anteontem|mes passado|mes anterior|ultimos? mes|ano passado|ano|amanha|semana passada|semana anterior|ultima semana|noventa dias|trimestre|ultimo trimestre)\b/.test(
      text,
    ) ||
    [...text.matchAll(/\b(\d+)\s+dias\b/g)].some(
      (match) => match[1] !== "7" && match[1] !== "30",
    ) ||
    /\b20\d{2}\b/.test(text);
  const dominant =
    ranked[0].score >= 7 && ranked[0].score - ranked[1].score >= 2;
  const prohibitedWrite =
    /^(?:(?:por favor|faz favor|pode|voce pode)\s+)?(?:publique|envie|responda|apague|exclua|delete|aprove)\b/.test(
      text,
    ) ||
    /\b(quero|preciso|deve|pode)\s+(?:que\s+)?(?:publicar|enviar|responder|apagar|excluir|deletar|aprovar)\b/.test(
      text,
    ) ||
    /\b(pare de|nao quero|nao me (?:mostre|abra)|nunca)\b/.test(text) ||
    /\b(crie|criar|cadastre|registre)\b.{0,30}\b(oportunidade|lead|cliente|campanha|newsletter|artigo)\b/.test(
      text,
    );
  const negated =
    /\b(nao|nunca|jamais)\b/.test(text) &&
    !/\b(nao distribuido|nao distribuidos|nao distribuidas|nao divulgados|nao divulgadas|nao divulgado|nao divulgada|nao compartilhado|nao usada|nao usadas|nao utilizado)\b/.test(
      text,
    );
  const exactIntent = dominant ? ranked[0].intent : null;
  const fuzzyAllowed =
    !exactIntent &&
    !choice &&
    !unsupportedTime &&
    !prohibitedWrite &&
    !negated &&
    text.length >= 9 &&
    text.length <= 180 &&
    text.split(" ").filter(Boolean).length >= 2 &&
    !/^\w{1,5}$/.test(text);
  let matchedIntent: Intent | null = null;
  let fuzzyRanked: { intent: Intent; score: number }[] = [];
  if (fuzzyAllowed) {
    const query = compact(text);
    const enoughSignal =
      query.split(" ").filter(Boolean).length >= 2 ||
      phrases.some((item) => item.phrase === query);
    const matches =
      query && enoughSignal ? fuse.search(query).slice(0, 40) : [];
    const best = new Map<Intent, number>();
    for (const match of matches) {
      if (match.score === undefined) continue;
      best.set(
        match.item.intent,
        Math.min(best.get(match.item.intent) ?? 1, match.score),
      );
    }
    fuzzyRanked = intents
      .map((intent) => {
        const exact = ranked.find((entry) => entry.intent === intent)!;
        const evidence = (exact.entity ? 0.035 : 0) + (exact.verb ? 0.035 : 0);
        const contextual =
          exact.entity &&
          ((area === "oportunidades" && intent.startsWith("opportunities.")) ||
            (area === "newsletters" && intent === "newsletters.performance"))
            ? 0.025
            : 0;
        return {
          intent,
          score: Math.max(0, (best.get(intent) ?? 1) - evidence - contextual),
        };
      })
      .sort((a, b) => a.score - b.score);
    if (
      fuzzyRanked[0].score <= 0.3 &&
      fuzzyRanked[1].score - fuzzyRanked[0].score >= 0.07
    )
      matchedIntent = fuzzyRanked[0].intent;
  }
  const selected =
    unsupportedTime || prohibitedWrite
      ? null
      : choice || (negated ? null : exactIntent) || matchedIntent;
  const options =
    fuzzyRanked.length && !matchedIntent
      ? fuzzyRanked.filter((entry) => entry.score <= fuzzyRanked[0].score + 0.1)
      : ranked[0].score
        ? ranked.filter(
            (entry) => entry.score >= Math.max(1, ranked[0].score - 3),
          )
        : ranked;
  return {
    intent: selected,
    entities: ranked.filter((r) => r.score >= 3).map((r) => r.intent),
    choices: matchedIntent
      ? []
      : options.slice(0, 4).map((r) => ({
          intent: r.intent,
          label: labels[r.intent],
        })),
    unsupportedTime,
    prohibitedWrite,
  };
}
export function resolvePeriod(raw: string, clock = Date.now()): Period {
  const text = normalizeQuestion(raw),
    end = new Date(clock).toISOString();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(clock);
  const value = (type: string) => date.find((p) => p.type === type)!.value;
  const midnight = Date.parse(
    `${value("year")}-${value("month")}-${value("day")}T03:00:00Z`,
  );
  if (/\bhoje\b/.test(text))
    return {
      label: "Hoje · America/Sao_Paulo",
      from: new Date(midnight).toISOString(),
      to: end,
      days: null,
    };
  if (/\b30 dias\b/.test(text))
    return {
      label: "Últimos 30 dias completos",
      from: new Date(midnight - 30 * 86400000).toISOString(),
      to: new Date(midnight).toISOString(),
      days: 30,
    };
  if (/\b7 dias\b/.test(text))
    return {
      label: "Últimos 7 dias completos",
      from: new Date(midnight - 7 * 86400000).toISOString(),
      to: new Date(midnight).toISOString(),
      days: 7,
    };
  if (/\b(semana|semanal|semanario)\b/.test(text))
    return {
      label: "Semana atual · America/Sao_Paulo",
      from: new Date(
        midnight - ((new Date(midnight).getUTCDay() + 6) % 7) * 86400000,
      ).toISOString(),
      to: end,
      days: null,
    };
  return { label: "Estado atual", from: null, to: end, days: null };
}
