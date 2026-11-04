import type {
  Content,
  Explanation,
  FeedItem,
  Policy,
  Preferences,
  Candidate,
  Source,
  RadarCategory,
} from "../packages/contracts/index";
import { radarCategoryWeights } from "../packages/contracts/radar";
import { folded } from "./normalize";
import { editorialWeek, RETENTION_MS } from "./schedule";
const round = (n: number) => Math.round(n * 100) / 100;
export function rank(
  items: Content[],
  prefs: Preferences,
  p: Policy,
  at = Date.now(),
  affinityTopics: string[] = [],
): FeedItem[] {
  const interests = prefs.interests.map(folded),
    affinity = new Set(affinityTopics.map(folded));
  const candidates = items.filter(
    (c) =>
      c.editorialStatus === "approved" &&
      c.quality.score >= p.minimumQuality &&
      !c.state.dismissed &&
      (!prefs.languages.length ||
        (!!c.language && prefs.languages.includes(c.language))),
  );
  const base = candidates.map((c) => {
    const interest = c.topics.some((t) => interests.includes(folded(t)))
      ? 1
      : 0;
    const age = c.publishedAt
      ? Math.max(0, (at - Date.parse(c.publishedAt)) / 86400000)
      : null;
    const r = p.ranking,
      factors: Record<string, number> = {
        quality: (c.quality.score / 100) * r.quality,
        interests: interest * r.interests,
        originality: (c.quality.factors.originality / 100) * r.originality,
        freshness:
          (c.evergreen ? 0.7 : age === null ? 0.3 : Math.exp(-age / 180)) *
          r.freshness,
        affinity:
          (c.state.favorite || c.state.used
            ? 1
            : c.topics.some((t) => affinity.has(folded(t)))
              ? 0.6
              : 0) * r.affinity,
        seen: c.state.seen ? -r.seenPenalty : 0,
        read: c.state.read ? -r.readPenalty : 0,
      };
    return {
      content: c,
      explanation: {
        algorithmVersion: p.version,
        score: 0,
        factors,
        reasons: [
          "Fonte aprovada; qualidade editorial mínima atendida.",
          ...(interest ? ["Compatível com interesses declarados."] : []),
          ...(factors.affinity > 0
            ? ["Afinidade com referências salvas ou utilizadas."]
            : []),
          ...(c.state.read ? ["Já lido: prioridade reduzida."] : []),
        ],
        exploration: false,
      } as Explanation,
    };
  });
  const output: FeedItem[] = [],
    topicCounts = new Map<string, number>(),
    sourceCounts = new Map<string, number>();
  while (base.length) {
    const exploration = (output.length + 1) % p.ranking.explorationEvery === 0;
    const pool = exploration
      ? base.filter((i) => i.explanation.factors.interests === 0)
      : [];
    const choices = pool.length ? pool : base;
    const scored = choices
      .map((i) => {
        const repetition = Math.max(
          sourceCounts.get(i.content.sourceId) ?? 0,
          ...i.content.topics.map((t) => topicCounts.get(t) ?? 0),
        );
        const diversity = p.ranking.diversity / (1 + repetition);
        return {
          item: i,
          diversity,
          score:
            Object.values(i.explanation.factors).reduce((a, b) => a + b, 0) +
            diversity,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.item.content.id.localeCompare(b.item.content.id),
      );
    const chosen = scored[0];
    const item = chosen.item;
    item.explanation.factors.diversity = round(chosen.diversity);
    item.explanation.score = round(chosen.score);
    item.explanation.exploration = exploration && pool.length > 0;
    if (item.explanation.exploration)
      item.explanation.reasons.push(
        "Vaga reservada para descoberta fora dos interesses declarados.",
      );
    item.explanation.reasons.push(
      "Diversidade considera repetição de temas e fontes nesta sequência.",
    );
    output.push(item);
    base.splice(base.indexOf(item), 1);
    sourceCounts.set(
      item.content.sourceId,
      (sourceCounts.get(item.content.sourceId) ?? 0) + 1,
    );
    for (const t of item.content.topics)
      topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
  }
  return output;
}

// Interleave available pools without dropping any eligible surplus or unknown language.
export function balanceLanguages(
  items: FeedItem[],
  explicitLanguage = false,
): FeedItem[] {
  if (explicitLanguage) return items;
  const portuguese = items.filter((i) => i.content.language === "pt");
  const international = items.filter(
    (i) => i.content.language && i.content.language !== "pt",
  );
  const output: FeedItem[] = [];
  for (let i = 0; i < Math.max(portuguese.length, international.length); i++) {
    if (portuguese[i]) output.push(portuguese[i]);
    if (international[i]) output.push(international[i]);
  }
  return [...output, ...items.filter((i) => !i.content.language)];
}

export function classifyRadar(
  c: Pick<Candidate, "title" | "topics">,
  source?: Pick<Source, "radarCategory">,
): RadarCategory | null {
  const text =
    " " +
    folded([c.title, ...c.topics].join(" ")).replace(/[^\p{L}\p{N}]+/gu, " ") +
    " ";
  const groups: [RadarCategory, string[]][] = [
    [
      "architecture_objects",
      [
        "architecture",
        "arquitetura",
        "architectural",
        "architecte",
        "interior",
        "installation",
        "instalacao",
        "sculpture",
        "escultura",
        "furniture",
        "objet",
        "objects",
      ],
    ],
    [
      "creative_technology",
      [
        "creative coding",
        "creative technology",
        "tecnologia criativa",
        "generative",
        "generativo",
        "artificial intelligence",
        "inteligencia artificial",
        "digital art",
        "interactive",
      ],
    ],
    [
      "graphic_design",
      [
        "graphic",
        "grafico",
        "grafica",
        "identity",
        "identidade",
        "branding",
        "brand",
        "typography",
        "tipografia",
        "typeface",
        "lettering",
        "editorial design",
        "design graphique",
        "identite",
        "design",
      ],
    ],
    [
      "photo_illustration_motion",
      [
        "photography",
        "photographer",
        "fotografia",
        "photographie",
        "photo",
        "illustration",
        "illustrator",
        "ilustracao",
        "animation",
        "animacao",
        "motion",
        "film",
        "cinema",
      ],
    ],
    [
      "art_visual_culture",
      [
        "art",
        "arte",
        "artist",
        "artista",
        "painting",
        "pintura",
        "museum",
        "museu",
        "exhibition",
        "exposicao",
        "contemporary",
        "culture",
        "cultura",
        "visual",
        "craft",
      ],
    ],
  ];
  return (
    groups.find(([, words]) =>
      words.some((w) => text.includes(" " + w + " ")),
    )?.[0] ??
    source?.radarCategory ??
    null
  );
}
export function dailyEligible(
  c: Content,
  at = Date.now(),
  week = editorialWeek(at),
) {
  const published = c.publishedAt ? Date.parse(c.publishedAt) : NaN;
  return (
    c.kind !== "paper" &&
    Number.isFinite(published) &&
    published >= Date.parse(week.start) &&
    published < Date.parse(week.end) &&
    published <= at &&
    (c.state.favorite ||
      (!c.radar?.expiredAt &&
        at - Date.parse(c.radar?.firstSeenAt ?? c.collectedAt) < RETENTION_MS))
  );
}
/** Daily-only ranking; scientific scoring and evergreen policy remain in rank(). */
export function rankRadar(
  items: Content[],
  prefs: Preferences,
  p: Policy,
  at = Date.now(),
  affinityTopics: string[] = [],
  sort: "novidade" | "relevancia" = "relevancia",
) {
  const week = editorialWeek(at);
  const allowed = items.filter(
    (c) =>
      dailyEligible(c, at, week) &&
      c.editorialStatus === "approved" &&
      c.quality.score >= p.minimumQuality &&
      !c.state.dismissed &&
      (!prefs.languages.length ||
        (!!c.language && prefs.languages.includes(c.language))),
  );
  const affinity = new Set([...prefs.interests, ...affinityTopics].map(folded));
  const pool = allowed.map((content) => {
    const i = { content };
    const category = i.content.radar?.category ?? classifyRadar(i.content);
    const age = (at - Date.parse(i.content.publishedAt!)) / 86400000;
    const factors: Record<string, number> = {
      publication: 45 * Math.exp(-age / 2),
      theme: category ? (20 * radarCategoryWeights[category]) / 0.3 : 0,
      source:
        (15 *
          (i.content.quality.factors.authority ?? i.content.quality.score)) /
        100,
      affinity:
        5 * (i.content.topics.some((t) => affinity.has(folded(t))) ? 1 : 0),
    };
    return {
      content,
      baseScore: Object.values(factors).reduce((a, b) => a + b, 0),
      explanation: {
        score: 0,
        algorithmVersion: "radar-daily-2",
        factors,
        exploration: false,
        reasons: [
          "Publicação na semana civil de Fortaleza; metadados aprovados.",
          "Sinopse opcional, sujeita à autorização e validação.",
        ],
      },
    };
  });
  const result: FeedItem[] = [],
    sources = new Map<string, number>(),
    categories = new Map<string, number>();
  while (pool.length) {
    const score = (i: (typeof pool)[number]) => {
      const cat =
        i.content.radar?.category ?? classifyRadar(i.content) ?? "unknown";
      const diversity =
        15 /
        (1 +
          (sources.get(i.content.sourceId) ?? 0) +
          (categories.get(cat) ?? 0));
      return {
        diversity,
        total: i.baseScore + diversity,
      };
    };
    const compare = (a: (typeof pool)[number], b: (typeof pool)[number]) =>
      (sort === "novidade"
        ? Date.parse(b.content.publishedAt!) -
          Date.parse(a.content.publishedAt!)
        : score(b).total - score(a).total) ||
      a.content.id.localeCompare(b.content.id);
    let best = 0;
    for (let n = 1; n < pool.length; n++)
      if (compare(pool[n], pool[best]) < 0) best = n;
    const chosen = pool.splice(best, 1)[0],
      s = score(chosen),
      cat =
        chosen.content.radar?.category ??
        classifyRadar(chosen.content) ??
        "unknown";
    chosen.explanation.factors.diversity = round(s.diversity);
    chosen.explanation.score = round(s.total);
    result.push({ content: chosen.content, explanation: chosen.explanation });
    sources.set(
      chosen.content.sourceId,
      (sources.get(chosen.content.sourceId) ?? 0) + 1,
    );
    categories.set(cat, (categories.get(cat) ?? 0) + 1);
  }
  return result;
}
