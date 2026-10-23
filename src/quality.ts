import type {
  Candidate,
  Policy,
  Quality,
  Source,
} from "../packages/contracts/index";
import { folded, safeUrl } from "./normalize";
export function matchedTopics(c: Candidate, s: Source): string[] {
  const tokens = (v: string) =>
    folded(v)
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const text = ` ${tokens([c.title, ...c.topics].join(" "))} `;
  const aliases: Record<string, string[]> = {
    design: [
      "designer",
      "designers",
      "graphic design",
      "visual identity",
      "user interface",
    ],
    brand: ["branding", "brands", "brand identity"],
    typography: ["typeface", "typefaces", "fonts", "lettering", "tipografia"],
    type: ["typeface", "typefaces", "typography"],
    font: ["fonts", "typeface", "typefaces"],
    ux: ["user experience", "usability"],
    perception: ["perceptual", "percepcao"],
    cognition: ["cognitive", "cognicao"],
    creative: ["creativity", "criatividade"],
  };
  // Require evidence in title or provider topics; an incidental summary mention is insufficient.
  return s.topics
    .map(folded)
    .filter((t) =>
      [t, ...(aliases[t] ?? [])].some((term) =>
        text.includes(` ${tokens(term)} `),
      ),
    );
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

/** Empty reasons mean the metadata can be indexed without an individual review. */
export function automaticReviewReasons(
  c: Candidate,
  s: Source,
  p: Policy,
  q: Quality,
  at = Date.now(),
  similarTitle = false,
): string[] {
  const reasons: string[] = [];
  const gate = p.autoApproval;
  if (!s.autoApprove) reasons.push("source_manual_review");
  if (!c.publishedAt) reasons.push("missing_date");
  if (
    !c.authors.length ||
    c.authors.some(
      (a) =>
        /^(by|unknown|anonymous)$/i.test(a.name.trim()) ||
        folded(a.name).replace(/[’‘]/g, "'") ===
          folded(s.name).replace(/[’‘]/g, "'"),
    )
  )
    reasons.push("missing_author");
  if (!c.language) reasons.push("language_unverified");
  if (
    [...c.authors.map((a) => a.name), ...c.topics].some((v) =>
      /\b(sponsored|advertorial|paid promotion|partner content)\b/i.test(v),
    )
  )
    reasons.push("promotional_material");
  if (similarTitle) reasons.push("possible_title_duplicate");
  if (c.isPrimary === false) reasons.push("secondary_material");
  const titleTopics = matchedTopics(
    { ...c, topics: [] },
    { ...s, topics: s.autoTopics?.length ? s.autoTopics : s.topics },
  );
  if (!titleTopics.length) reasons.push("title_off_topic");
  if (
    c.publishedAt &&
    at - Date.parse(c.publishedAt) > gate.maximumAgeDays * 86400000
  )
    reasons.push("too_old_for_automatic_approval");
  if (q.score < p.approvalThreshold) reasons.push("below_auto_threshold");
  if (q.factors.authority < gate.minimumAuthority)
    reasons.push("authority_below_auto_minimum");
  if (q.factors.material < gate.minimumMaterial)
    reasons.push("material_below_auto_minimum");
  if (q.factors.relevance < gate.minimumRelevance)
    reasons.push("relevance_below_auto_minimum");
  if (q.factors.originality < gate.minimumOriginality)
    reasons.push("originality_below_auto_minimum");
  if (c.kind === "paper") {
    if (
      /\b(editorial|special issue|correction|erratum|retraction|protocol|review)\b/i.test(
        c.title,
      )
    )
      reasons.push("scientific_publication_type_unverified");
    if (q.factors.authority < gate.minimumScientificAuthority)
      reasons.push("scientific_authority_below_minimum");
    if (!c.publication || !c.identifiers.some((i) => i.scheme === "doi"))
      reasons.push("scientific_provenance_incomplete");
  }
  return reasons;
}
