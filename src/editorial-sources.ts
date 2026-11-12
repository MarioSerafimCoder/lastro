import {
  editorialReference,
  type EditorialMemory,
  type EditorialReference,
  type EditorialArticle,
} from "../packages/contracts/editorial-article";
import { policy, rows, sourceView, type SourceRow } from "./db";
import { canonicalUrl, folded } from "./normalize";
import { evidenceAllowed, evidenceSchema } from "./synopsis-evidence";
import { sufficientEvidence } from "./synopses";

const day = 86400000;
export const injectionPattern =
  /(?:ignore|disregard|override|forget|esqueça|desconsidere|ignorar)\b.{0,100}\b(?:instructions?|instruções|prompts?|regras)|(?:system|developer) (?:prompt|message)|(?:mensagem|instruções) do sistema|\[\/?INST\]|<\|[^>]{1,50}\|>|(?:api[_ -]?key|access[_ -]?token).{0,30}(?:send|reveal|exiba|revele)/isu;
const themes = [
  [
    "identidade-visual",
    "Identidades visuais",
    /identidad\w* visua\w*|visual identit\w*|rebrand\w*|design de marcas/,
  ],
  [
    "branding",
    "Estratégia de marca",
    /brand(?:ing| strategy| positioning)|estrategia de marca|posicionamento de marca/,
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
  evidence_json: string;
  material_key: string;
};

export async function editorialCandidates(
  db: D1Database,
  at: number,
  ids?: string[],
) {
  const minimum = ids ? 0 : (await policy(db)).minimumQuality;
  const candidates = await rows<CandidateRow>(
    db,
    `
    SELECT s.*, c.id content_id,c.canonical_url,c.title,c.published_at,
      c.quality_score,c.metadata_json,c.quality_json,e.evidence_json,e.material_key
    FROM synopsis_evidence_cache e JOIN sources s ON s.id=e.source_id
    JOIN contents c ON c.source_id=s.id AND c.canonical_url=e.canonical_url
    WHERE c.editorial_status='approved' AND s.status='approved' AND c.purged_at IS NULL
      AND e.permission_version=s.synopsis_permission_version AND e.block_code IS NULL
      AND e.evidence_json IS NOT NULL AND c.quality_score>=? AND c.published_at<=?
      ${ids ? "" : "AND (c.published_at>=? OR json_extract(c.metadata_json,'$.evergreen')=1)"}
      AND NOT EXISTS(SELECT 1 FROM interactions u WHERE u.content_id=c.id AND u.user_id='owner' AND u.type='dismissed' AND u.active=1)
      ${ids ? "AND c.id IN (SELECT value FROM json_each(?))" : ""}
    ORDER BY (c.published_at>=?) DESC,c.quality_score DESC,c.published_at DESC,c.id LIMIT 48`,
    minimum,
    new Date(at).toISOString(),
    ids ? JSON.stringify(ids) : new Date(at - 30 * day).toISOString(),
    new Date(at - 7 * day).toISOString(),
  );
  return candidates.flatMap((row): SourceEvidence[] => {
    const source = sourceView(row);
    const parsed = evidenceSchema.safeParse(JSON.parse(row.evidence_json));
    if (
      !parsed.success ||
      parsed.data.kind === "editorial_evidence" ||
      !evidenceAllowed(parsed.data, source, row.canonical_url) ||
      canonicalUrl(parsed.data.url) !== row.canonical_url ||
      !sufficientEvidence(parsed.data.text, row.title) ||
      injectionPattern.test(
        [row.title, source.name, parsed.data.text].join(" "),
      )
    )
      return [];
    const metadata = JSON.parse(row.metadata_json);
    if (metadata.retracted) return [];
    const reference = {
      contentId: row.content_id,
      sourceId: source.id,
      url: row.canonical_url,
      title: row.title.trim(),
      publication: source.name.trim(),
      publishedAt: row.published_at,
      kind: parsed.data.kind,
    };
    if (!editorialReference(reference)) return [];
    return [
      {
        reference,
        materialKey: row.material_key,
        text: parsed.data.text.slice(0, 1800),
        topics: metadata.topics ?? [],
        quality: row.quality_score,
        authority: source.authority,
        originality: JSON.parse(row.quality_json).factors?.originality ?? 50,
        evergreen: metadata.evergreen === true,
      },
    ];
  });
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
        (age > 30 && !candidate.evergreen) ||
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
        (age <= 30 ? 20 * Math.exp(-age / 5) + (age <= 7 ? 10 : 0) : 0) +
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
  for (const [category, theme, pattern] of themes) {
    const ranked = pool
      .flatMap((item) => {
        const focus = pattern.test(item.angle);
        return focus || pattern.test(item.background)
          ? [{ ...item, focus }]
          : [];
      })
      .slice(0, 12);
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        const a = ranked[i],
          b = ranked[j];
        const ab = connection(a, b);
        if (ab < 0) continue;
        for (let k = j + 1; k < ranked.length; k++) {
          const c = ranked[k];
          const group = [a, b, c];
          if (group.filter((s) => s.focus).length < 2)
            continue;
          const ac = connection(a, c),
            bc = connection(b, c);
          if (ac < 0 || bc < 0) continue;
          const score =
            a.score +
            b.score +
            c.score +
            8 * group.filter((s) => s.focus).length +
            6 * (ab + ac + bc);
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
