import { intents, labels, type Intent, type Period } from "./jarvis";
export const normalizeQuestion = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      "visualizacoes",
    ],
  ],
  "drafts.pending": [
    ["rascunho", "rascunhos", "studio", "texto"],
    ["pendente", "pendentes", "parado", "parados", "continuar", "retomar"],
  ],
  "articles.without_newsletter": [
    ["artigo", "artigos", "publicacao", "publicado"],
    ["sem newsletter", "sem distribuicao", "nao distribuido", "sem envio"],
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
    ["semana", "semanal", "semanario", "7 dias"],
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
function has(text: string, term: string) {
  return (" " + text + " ").includes(" " + term + " ");
}
export function interpretQuestion(raw: string, area: string, choice?: Intent) {
  const text = normalizeQuestion(raw);
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
      return { intent, score };
    })
    .sort((a, b) => b.score - a.score);
  const unsupportedTime = /\b(ontem|mes passado|ano|amanha|90 dias)\b/.test(
    text,
  );
  const dominant =
    ranked[0].score >= 7 && ranked[0].score - ranked[1].score >= 2;
  return {
    intent: !unsupportedTime
      ? choice || (dominant ? ranked[0].intent : null)
      : null,
    entities: ranked.filter((r) => r.score >= 3).map((r) => r.intent),
    choices: (ranked[0].score
      ? ranked.filter((r) => r.score >= ranked[0].score - 3).slice(0, 4)
      : ranked.slice(0, 4)
    ).map((r) => ({ intent: r.intent, label: labels[r.intent] })),
    unsupportedTime,
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
