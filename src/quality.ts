import type {
  Candidate,
  Policy,
  Quality,
  Source,
} from "../packages/contracts/index";
import { folded, safeUrl } from "./normalize";
export function matchedTopics(c: Candidate, s: Source): string[] {
  const text = folded(
    [c.title, c.description, ...c.topics].filter(Boolean).join(" "),
  );
  return s.topics.map(folded).filter((t) => text.includes(t));
}
export function prefilter(c: Candidate, s: Source, at = Date.now()): string[] {
  const failures: string[] = [];
  if (s.status !== "approved") failures.push("source_not_approved");
  if (!s.metadataAllowed) failures.push("metadata_not_authorized");
  if (!c.title) failures.push("missing_title");
  try {
    safeUrl(c.url);
  } catch {
    failures.push("invalid_url");
  }
  if (!matchedTopics(c, s).length) failures.push("off_topic");
  if (c.language && s.languages.length && !s.languages.includes(c.language))
    failures.push("language_excluded");
  if (c.publishedAt && Date.parse(c.publishedAt) > at + 86400000)
    failures.push("future_date");
  if (
    c.publishedAt &&
    s.maxAgeDays !== null &&
    at - Date.parse(c.publishedAt) > s.maxAgeDays * 86400000
  )
    failures.push("outside_period");
  if (c.access === "unavailable") failures.push("unavailable");
  if (c.retracted) failures.push("retracted");
  return failures;
}
export function evaluate(
  c: Candidate,
  s: Source,
  p: Policy,
  at = Date.now(),
  manual?: { materialScore?: number; originalityScore?: number },
): Quality {
  const limitations: string[] = [];
  if (c.kind === "paper")
    limitations.push(
      "Metadados não verificam método, amostra, causalidade ou validade científica; revisão humana necessária.",
    );
  if (!c.authors.length) limitations.push("Autoria não informada.");
  if (!c.publishedAt) limitations.push("Data não informada.");
  if (!c.language) limitations.push("Idioma não informado.");
  if (!c.description)
    limitations.push("Resumo não disponível ou não autorizado.");
  if (c.access !== "open")
    limitations.push("Texto integral não consultado; acesso " + c.access + ".");
  if (c.isPrimary === null)
    limitations.push("Originalidade e procedência primária não verificadas.");
  const age = c.publishedAt
    ? Math.max(0, (at - Date.parse(c.publishedAt)) / 86400000)
    : null;
  const factors = {
    authority: s.authority,
    material:
      manual?.materialScore ??
      20 +
        (c.authors.length ? 20 : 0) +
        (c.publishedAt ? 20 : 0) +
        (c.description ? 20 : 0) +
        (c.identifiers.length ? 20 : 0),
    relevance: matchedTopics(c, s).length ? 100 : 0,
    originality:
      manual?.originalityScore ??
      (c.isPrimary === true ? 85 : c.isPrimary === false ? 25 : 50),
    freshness: c.evergreen
      ? 70
      : age === null
        ? 30
        : Math.round(100 * Math.exp(-age / 180)),
  };
  const entries = Object.entries(p.qualityWeights) as [
    keyof typeof factors,
    number,
  ][];
  const score =
    entries.reduce((a, [k, w]) => a + factors[k] * w, 0) /
    entries.reduce((a, [, w]) => a + w, 0);
  return {
    version: p.version,
    score: Math.round(score * 100) / 100,
    factors,
    limitations,
  };
}
