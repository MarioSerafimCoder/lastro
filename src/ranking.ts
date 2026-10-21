import type {
  Content,
  Explanation,
  FeedItem,
  Policy,
  Preferences,
} from "../packages/contracts/index";
import { folded } from "./normalize";
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
