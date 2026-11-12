import {
  editorialReference,
  type EditorialMemory,
  type EditorialReference,
  type EditorialArticle,
} from "../packages/contracts/editorial-article";
import { policy, rows, sourceView, type SourceRow } from "./db";
import { folded } from "./normalize";
import {
  evidenceAllowed,
  evidenceKey,
  evidenceSchema,
  itemRightsRestricted,
  permissionVersion,
  processingAllowed,
  sufficientEvidence,
} from "./synopsis-evidence";
import type { EligibilityReason } from "../packages/contracts/editorial-autopilot";

const day = 86400000;
const recentDays = 30;
const contextDays = 180;
export const injectionPattern =
  /(?:ignore|disregard|override|forget|esqueça|desconsidere|ignorar)\b.{0,100}\b(?:instructions?|instruções|prompts?|regras)|(?:system|developer) (?:prompt|message)|(?:mensagem|instruções) do sistema|\[\/?INST\]|<\|[^>]{1,50}\|>|(?:api[_ -]?key|access[_ -]?token).{0,30}(?:send|reveal|exiba|revele)/isu;
const themes = [
  [
    "identidade-visual",
    "Identidades visuais",
    /identidad\w* visua\w*|visual identit\w*|rebrand\w*|design de marcas|redesign\w* (?:de marca|do logotipo)|brand redesign/,
    /percepcao visual|visual perception|percepcao de marca|brand (?:perception|recognition)|reconhecimento de marca|logo (?:recognition|design)|(?:critica|analise) de identidade/,
  ],
  [
    "branding",
    "Estratégia de marca",
    /brand(?:ing| strategy| positioning)|estrategia de marca|posicionamento de marca/,
    /rebrand\w*|brand (?:perception|recognition)|percepcao de marca|memoria de marca|identidade visual|visual identity/,
  ],
  [
    "direcao-de-arte",
    "Tipografia",
    /typograph\w*|tipograf\w*|typeface\w*|lettering/,
  ],
  [
    "direcao-de-arte",
    "Ilustração e direção de arte",
    /illustrat\w*|ilustra\w*|art direction|direcao de arte/,
  ],
  [
    "referencias",
    "Arte contemporânea e exposições",
    /exposic\w*|exhibition\w*|arte contemporanea|contemporary art|curatori\w*/,
  ],
  [
    "referencias",
    "Memória gráfica e arquivos",
    /graphic histor\w*|design histor\w*|historia do design|memoria grafica|arquivo\w*|archiv\w*/,
  ],
  [
    "referencias",
    "Cultura visual e circulação de imagens",
    /cultura visual|visual culture|circulacao de imagens|image circulation/,
  ],
  [
    "processo",
    "Trabalho e processos criativos",
    /creative work|creative process|processo criativo|trabalho criativo|creative industr\w*|mercado criativo/,
  ],
  [
    "processo",
    "Autoria e licenças na criação",
    /creative commons|copyright|direitos autorais|autor\w*|authorship|licenc\w*/,
  ],
  [
    "tecnologia",
    "IA e criação",
    /inteligencia artificial|artificial intelligence|generativ\w*|\b(?:ia|ai)\b/,
  ],
  [
    "tecnologia",
    "Plataformas e cultura digital",
    /plataforma\w*|platform\w*|cultura digital|digital culture|social media|redes sociais/,
  ],
  [
    "tecnologia",
    "Dados e design",
    /data visuali\w*|visualizacao de dados|infograf\w*|infograph\w*|data design/,
  ],
  [
    "processo",
    "Acessibilidade e design",
    /accessib\w*|acessib\w*|inclusive design|design inclusivo/,
  ],
] as const satisfies readonly (readonly [
  EditorialArticle["category"],
  string,
  RegExp,
  RegExp?,
])[];

export type SourceEvidence = {
  reference: EditorialReference;
  materialKey: string;
  text: string;
  topics: string[];
  quality: number;
  authority: number;
  originality: number;
  evergreen: boolean;
};
export type SelectedSource = {
  reference: EditorialReference;
  fingerprint: string;
};
type CandidateRow = SourceRow & {
  content_id: string;
  canonical_url: string;
  title: string;
  published_at: string;
  quality_score: number;
  metadata_json: string;
  quality_json: string;
  evidence_json: string | null;
  legacy_evidence: string | null;
  evidence_version: number | null;
  block_code: string | null;
  item_rights: string | null;
  description_present: number | null;
  body_present: number | null;
  dismissed: number;
  purged_at: string | null;
};

export async function inspectEditorialCandidates(
  db: D1Database,
  at: number,
  ids?: string[],
) {
  const minimum = (await policy(db)).minimumQuality;
  const weekStart = new Date(at - 7 * day).toISOString();
  const candidates = await rows<CandidateRow>(
    db,
    `
    SELECT s.*, c.id content_id,c.canonical_url,c.title,c.published_at,
      c.quality_score,c.metadata_json,c.quality_json,c.purged_at,e.evidence_json,
      e.permission_version evidence_version,e.block_code,e.item_rights,e.description_present,e.body_present,
      sy.evidence_json legacy_evidence,
      EXISTS(SELECT 1 FROM interactions u WHERE u.content_id=c.id AND u.user_id='owner' AND u.type='dismissed' AND u.active=1) dismissed
    FROM contents c JOIN sources s ON s.id=c.source_id
    LEFT JOIN synopsis_evidence_cache e ON c.source_id=e.source_id AND c.canonical_url=e.canonical_url
    LEFT JOIN content_synopses sy ON sy.content_id=c.id AND sy.metadata_json=c.metadata_json AND sy.status='validated'
    WHERE c.editorial_status='approved' AND s.status='approved' AND c.published_at<=?
      AND ${
        ids
          ? "c.id IN (SELECT value FROM json_each(?))"
          : `(
        c.published_at>=? OR ((c.published_at>=? OR json_extract(c.metadata_json,'$.evergreen')=1)
          AND (e.evidence_json IS NOT NULL OR sy.evidence_json IS NOT NULL)))`
      }
    ORDER BY c.published_at DESC,c.id`,
    new Date(at).toISOString(),
    ...(ids
      ? [JSON.stringify(ids)]
      : [weekStart, new Date(at - contextDays * day).toISOString()]),
  );
  return candidates.map((row) => {
    const source = sourceView(row);
    const metadata = JSON.parse(row.metadata_json);
    const recent = row.published_at >= weekStart;
    const hasDescription =
      row.description_present === 1 || !!metadata.description?.trim();
    const base = {
      recent,
      hasDescription,
      title: row.title,
      publication: source.name,
      url: row.canonical_url,
    };
    const exclude = (reason: EligibilityReason) => ({
      ...base,
      reason,
      candidate: null,
    });
    const current = row.evidence_version === permissionVersion(source);
    const observedText = hasDescription || row.body_present === 1;
    if (
      row.purged_at ||
      row.dismissed ||
      metadata.retracted ||
      metadata.access === "unavailable"
    )
      return exclude("invalid");
    if (
      !source.metadataAllowed ||
      source.synopsisAllowed === false ||
      itemRightsRestricted(row.item_rights ?? "") ||
      (current && row.block_code === "rights")
    )
      return exclude("rights");
    if (!processingAllowed(source))
      return exclude(observedText ? "permission_unverified" : "no_text");
    const raw = current ? row.evidence_json : row.legacy_evidence;
    if (!raw) {
      if (
        row.description_present === 0 &&
        row.body_present === 0 &&
        !hasDescription
      )
        return exclude("no_text");
      return exclude(
        current && row.block_code === "insufficient_evidence"
          ? "insufficient"
          : "capture_pending",
      );
    }
    const parsed = evidenceSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.kind === "editorial_evidence")
      return exclude("capture_pending");
    if (!evidenceAllowed(parsed.data, source, row.canonical_url))
      return exclude("permission_unverified");
    if (!sufficientEvidence(parsed.data.text, row.title))
      return exclude("insufficient");
    if (
      injectionPattern.test(
        [row.title, source.name, parsed.data.text].join(" "),
      )
    )
      return exclude("invalid");
    if (row.quality_score < minimum) return exclude("quality");
    const reference = {
      contentId: row.content_id,
      sourceId: source.id,
      url: row.canonical_url,
      title: row.title.trim(),
      publication: source.name.trim(),
      publishedAt: row.published_at,
      kind: parsed.data.kind,
      ...(parsed.data.licenseUrl
        ? {
            attribution: {
              authors: (metadata.authors ?? [])
                .flatMap(({ name }: { name: string }) =>
                  typeof name === "string" &&
                  name.trim() &&
                  !/[\u0000-\u001f\u007f<>{}]/u.test(name)
                    ? [name.trim().slice(0, 100)]
                    : [],
                )
                .slice(0, 8),
              licenseUrl: parsed.data.licenseUrl,
            },
          }
        : {}),
    };
    if (!editorialReference(reference)) return exclude("invalid");
    const candidate: SourceEvidence = {
      reference,
      materialKey: evidenceKey(parsed.data),
      text: parsed.data.text.slice(0, 1800),
      topics: metadata.topics ?? [],
      quality: row.quality_score,
      authority: source.authority,
      originality: JSON.parse(row.quality_json).factors?.originality ?? 50,
      evergreen: metadata.evergreen === true,
    };
    return { ...base, reason: null, candidate };
  });
}

export async function editorialCandidates(
  db: D1Database,
  at: number,
  ids?: string[],
) {
  return (await inspectEditorialCandidates(db, at, ids)).flatMap(
    ({ candidate }) => (candidate ? [candidate] : []),
  );
}

const stopWords = new Set(
  "para pelo pela pelos pelas pelo sobre entre como pode quando onde ainda muito mais seus suas suas este esta estes estas isso esse essa esses essas them that with from have their this will about into other through work creative design visual designers artigo texto article through".split(
    " ",
  ),
);
export function terms(value: string) {
  return new Set(
    (folded(value).match(/[a-z]{4,}/g) ?? []).filter((w) => !stopWords.has(w)),
  );
}
function similarity(a: Set<string>, b: Set<string>) {
  if (a.size > b.size) [a, b] = [b, a];
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.max(1, a.size + b.size - shared);
}
export function repeatsArticle(
  article: EditorialMemory,
  history: EditorialMemory[],
) {
  const title = terms(article.title),
    thesis = terms(article.argument + " " + article.summary);
  return history.some(
    (past) =>
      folded(past.title) === folded(article.title) ||
      similarity(title, terms(past.title)) >= 0.65 ||
      similarity(thesis, terms(past.argument + " " + past.summary)) >= 0.4,
  );
}

export function selectEditorialSources(
  candidates: SourceEvidence[],
  history: EditorialMemory[],
  used: EditorialReference[],
  at: number,
) {
  const usedUrls = new Set(used.map((ref) => ref.url));
  const frequency = new Map<string, number>();
  for (const ref of used)
    frequency.set(ref.sourceId, (frequency.get(ref.sourceId) ?? 0) + 1);
  const pastTerms = history.map((item) =>
    terms(item.title + " " + item.summary + " " + item.argument),
  );
  const pool = candidates
    .flatMap((candidate) => {
      const { reference, text, topics, quality, authority, originality } =
        candidate;
      const age = (at - Date.parse(reference.publishedAt)) / day;
      if (
        age < 0 ||
        (age > contextDays && !candidate.evergreen) ||
        usedUrls.has(reference.url)
      )
        return [];
      const headline = terms(reference.title);
      const body = terms(text);
      const subject = terms([reference.title, ...topics].join(" "));
      const novelty = Math.max(
        0,
        ...pastTerms.map((past) => similarity(subject, past)),
      );
      const angle = folded([reference.title, ...topics].join(" "));
      const background = folded(text);
      const score =
        quality * 0.25 +
        authority * 0.15 +
        originality * 0.15 +
        (age <= recentDays
          ? 20 * Math.exp(-age / 5) + (age <= 7 ? 10 : 0)
          : 0) +
        Math.min(10, body.size / 6) -
        45 * novelty -
        4 * (frequency.get(reference.sourceId) ?? 0);
      return [
        {
          candidate,
          headline,
          body,
          angle,
          background,
          score,
          recent: age <= recentDays,
          host: new URL(reference.url).hostname.replace(/^www\./, ""),
        },
      ];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.reference.contentId.localeCompare(
          b.candidate.reference.contentId,
        ),
    );

  const pairs = new Map<string, number>();
  const connection = (a: (typeof pool)[number], b: (typeof pool)[number]) => {
    const left = a.candidate.reference,
      right = b.candidate.reference;
    if (
      left.sourceId === right.sourceId ||
      a.host === b.host ||
      left.url === right.url
    )
      return -1;
    const key = left.contentId + right.contentId; // Pairs are visited in ranking order.
    const saved = pairs.get(key);
    if (saved !== undefined) return saved;
    const overlap = similarity(a.body, b.body);
    const score =
      overlap >= 0.5 || similarity(a.headline, b.headline) >= 0.6
        ? -1
        : overlap;
    pairs.set(key, score);
    return score;
  };
  let best: {
    theme: string;
    category: EditorialArticle["category"];
    sources: SourceEvidence[];
    score: number;
  } | null = null;
  for (const [category, theme, pattern, related] of themes) {
    const perPublication = new Map<string, number>();
    const ranked = pool
      .flatMap((item) => {
        const focus = pattern.test(item.angle);
        const direct = focus || pattern.test(item.background);
        if (
          !direct &&
          !related?.test(item.angle) &&
          !related?.test(item.background)
        )
          return [];
        const count = perPublication.get(item.host) ?? 0;
        if (count >= 4) return [];
        perPublication.set(item.host, count + 1);
        return [{ ...item, focus, direct }];
      })
      .slice(0, 24);
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        const a = ranked[i],
          b = ranked[j];
        const ab = connection(a, b);
        if (ab < 0) continue;
        for (let k = j + 1; k < ranked.length; k++) {
          const c = ranked[k];
          const group = [a, b, c];
          const focus = group.filter((s) => s.focus).length;
          if (
            (!group.some((s) => s.recent && s.direct) &&
              !group.every((s) => s.candidate.evergreen)) ||
            (!related && focus < 2) ||
            (related && (!focus || group.filter((s) => s.direct).length < 2))
          )
            continue;
          const ac = connection(a, c),
            bc = connection(b, c);
          if (ac < 0 || bc < 0) continue;
          const score =
            a.score + b.score + c.score + 8 * focus + 6 * (ab + ac + bc);
          if (!best || score > best.score)
            best = {
              theme,
              category,
              score,
              sources: group.map((s) => s.candidate),
            };
        }
      }
    }
  }
  return best;
}

export async function sourceFingerprint(candidate: SourceEvidence) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([candidate.reference, candidate.materialKey]),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
