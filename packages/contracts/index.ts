import { z } from "zod";

export const sourceStatusSchema = z.enum([
  "pending",
  "approved",
  "paused",
  "rejected",
]);
export const knowledgeSchema = z.enum([
  "scientific_evidence",
  "editorial_interpretation",
  "application_hypothesis",
]);
export const kindSchema = z.enum([
  "news",
  "opinion",
  "article",
  "paper",
  "case_study",
  "visual_reference",
  "post",
  "magazine",
  "other",
]);
const label = z.string().trim().min(1).max(100);
const unit = z.number().min(0).max(100);
export const identifierSchema = z.object({
  scheme: z.enum(["doi", "openalex", "pmid", "isbn", "source_guid"]),
  value: z.string().min(1).max(500),
});
export const authorSchema = z.object({
  name: label,
  orcid: z.string().max(100).nullable().default(null),
  openalex: z.string().max(100).nullable().default(null),
});
export const sourceInputSchema = z
  .object({
    name: label,
    connector: z.enum(["rss", "openalex"]),
    url: z.string().url().max(2000),
    authority: unit.default(50),
    topics: z.array(label).min(1).max(30),
    autoTopics: z.array(label).max(30).default([]),
    languages: z
      .array(z.string().regex(/^[a-z]{2}$/))
      .max(10)
      .default(["pt", "en"]),
    maxAgeDays: z.number().int().min(1).max(36500).nullable().default(null),
    metadataAllowed: z.boolean().default(true),
    summaryAllowed: z.boolean().default(false),
    synopsisAllowed: z.boolean().optional(),
    synopsisRightsNote: z.string().max(2000).optional(),
    imageAllowed: z.boolean().default(false),
    rightsNote: z.string().trim().min(5).max(2000),
    autoApprove: z.boolean().default(false),
    intervalMinutes: z.number().int().min(60).max(43200).default(360),
  })
  .strict();
export const sourceDecisionSchema = z
  .object({
    status: sourceStatusSchema,
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type Source = SourceInput & {
  id: string;
  status: z.infer<typeof sourceStatusSchema>;
  createdAt: string;
  nextFetchAt: string | null;
};
export const candidateSchema = z
  .object({
    title: z.string().max(500).default(""),
    url: z.string().max(2000).default(""),
    authors: z.array(authorSchema).max(50).default([]),
    publication: z.string().max(300).nullable().default(null),
    publishedAt: z.string().max(100).nullable().default(null),
    kind: kindSchema.default("article"),
    language: z.string().max(20).nullable().default(null),
    description: z.string().max(1200).nullable().default(null),
    imageUrl: z.string().url().max(2000).nullable().default(null),
    identifiers: z.array(identifierSchema).max(10).default([]),
    topics: z.array(label).max(30).default([]),
    access: z
      .enum(["open", "restricted", "unknown", "unavailable"])
      .default("unknown"),
    license: z.string().max(300).nullable().default(null),
    accessNote: z.string().max(1000).nullable().default(null),
    isPrimary: z.boolean().nullable().default(null),
    retracted: z.boolean().default(false),
    evergreen: z.boolean().default(false),
  })
  .strict();
export type Candidate = z.infer<typeof candidateSchema>;

export type AdminSource = Source & { lastRun?: IngestionRun | null };
export type RadarSourceStatus = {
  id: string;
  name: string;
  cycle: "daily" | "bimonthly";
  lastCycleKey: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextDiscoveryAt: string | null;
  queued: number;
  approved: number;
  pending: number;
  rejected: number;
  duplicates: number;
  processed: number;
  received: number | null;
  consecutiveFailures: number;
  error: string | null;
  state:
    | "pending"
    | "paused"
    | "rejected"
    | "unauthorized"
    | "failed"
    | "processing"
    | "queued"
    | "unverified"
    | "no_new_entries"
    | "checked";
};
export type RadarStatus = {
  checkedAt: string;
  timezone: "UTC";
  ingestEnabled: boolean;
  sources: RadarSourceStatus[];
  lastEditorialCheck: string | null;
  lastScientificRound: string | null;
  approved: number;
  newApprovalsSince: string | null;
  newApprovals: number | null;
  newContentIds?: string[];
  recentTopics?: { name: string; count: number }[];
};
export type ReviewCandidate = {
  id: string;
  sourceId: string;
  runId: string;
  contentId: string | null;
  outcome: string;
  reasons: string[];
  metadata: Candidate;
  createdAt: string;
  quality: Quality;
};
export type EditorialDecision = {
  id: string;
  targetId: string;
  scope: string;
  decision: string;
  reason: string;
  createdAt: string;
};
export type AdminOverview = {
  ingestEnabled: boolean;
  allowedHosts: string[];
  sources: number;
  pending: number;
  approved: number;
  portuguese: number;
  international: number;
  unknownLanguage: number;
};
export const qualityWeightsSchema = z.object({
  authority: unit,
  material: unit,
  relevance: unit,
  originality: unit,
  freshness: unit,
});
export const policySchema = z
  .object({
    version: z.string().regex(/^[a-z0-9.-]{1,50}$/),
    qualityWeights: qualityWeightsSchema.refine(
      (w) => Object.values(w).reduce((a, b) => a + b, 0) > 0,
    ),
    approvalThreshold: unit,
    minimumQuality: unit,
    autoApproval: z
      .object({
        minimumAuthority: unit,
        minimumMaterial: unit,
        minimumRelevance: unit,
        minimumOriginality: unit,
        maximumAgeDays: z.number().int().min(1).max(36500),
        minimumScientificAuthority: unit,
      })
      .default({
        minimumAuthority: 70,
        minimumMaterial: 60,
        minimumRelevance: 100,
        minimumOriginality: 50,
        maximumAgeDays: 730,
        minimumScientificAuthority: 70,
      }),
    ranking: z.object({
      quality: unit,
      interests: unit,
      originality: unit,
      freshness: unit,
      affinity: unit,
      diversity: unit,
      seenPenalty: unit,
      readPenalty: unit,
      explorationEvery: z.number().int().min(2).max(20),
    }),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const defaultPolicy: Policy = {
  version: "lastro-1.0",
  qualityWeights: {
    authority: 20,
    material: 25,
    relevance: 30,
    originality: 15,
    freshness: 10,
  },
  approvalThreshold: 65,
  minimumQuality: 55,
  autoApproval: {
    minimumAuthority: 70,
    minimumMaterial: 60,
    minimumRelevance: 100,
    minimumOriginality: 50,
    maximumAgeDays: 730,
    minimumScientificAuthority: 70,
  },
  ranking: {
    quality: 35,
    interests: 25,
    originality: 10,
    freshness: 10,
    affinity: 10,
    diversity: 10,
    seenPenalty: 12,
    readPenalty: 20,
    explorationEvery: 5,
  },
};
export type Quality = {
  version: string;
  score: number;
  factors: Record<keyof Policy["qualityWeights"], number>;
  limitations: string[];
};
export type UserState = {
  favorite: boolean;
  selected: boolean;
  seen: boolean;
  opened: boolean;
  read: boolean;
  dismissed: boolean;
  used: boolean;
  note: string | null;
};
export type KnowledgeAnnotation = {
  id: string;
  classification: z.infer<typeof knowledgeSchema>;
  statement: string | null;
  attribution: string | null;
  referenceUrl: string | null;
  limitations: string | null;
};
export type Content = Candidate & {
  synopsis?: {
    text: string;
    status: string;
    generatorVersion: string;
    validatedAt: string;
    evidenceUrl: string;
  } | null;
  id: string;
  sourceId: string;
  sourceName: string;
  canonicalUrl: string;
  collectedAt: string;
  editorialStatus: "pending" | "approved" | "rejected";
  quality: Quality;
  state: UserState;
  annotations: KnowledgeAnnotation[];
};
export type Explanation = {
  algorithmVersion: string;
  score: number;
  factors: Record<string, number>;
  reasons: string[];
  exploration: boolean;
};
export type FeedItem = { content: Content; explanation: Explanation };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type FeedPage = Page<FeedItem> & {
  snapshotId: string;
  expiresAt: string;
  candidateLimit: number;
  algorithmVersion: string;
};
export const preferencesSchema = z
  .object({
    interests: z.array(label).max(30),
    languages: z
      .array(z.string().regex(/^[a-z]{2}$/))
      .max(10)
      .default([]),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const interactionSchema = z
  .object({
    type: z.enum(["seen", "opened", "read", "dismissed"]),
    active: z.boolean().default(true),
  })
  .strict();
export type InteractionInput = z.infer<typeof interactionSchema>;
export const selectionSchema = z
  .object({
    contentIds: z
      .array(z.string().uuid())
      .max(20)
      .refine((a) => new Set(a).size === a.length, "IDs repetidos"),
  })
  .strict();
export const researchInputSchema = z
  .object({
    format: z.enum(["post", "carousel", "article", "newsletter"]),
    slides: z.number().int().min(2).max(30).optional(),
    tone: z.string().trim().min(1).max(200).default("autoral e analítico"),
    audience: z.string().max(300).default("profissionais criativos"),
    objective: z.string().trim().min(3).max(2000),
    notes: z.string().max(5000).default(""),
  })
  .strict()
  .refine(
    (v) => v.format !== "carousel" || v.slides !== undefined,
    "Carrossel requer slides",
  );
export type ResearchInput = z.infer<typeof researchInputSchema>;
export type ResearchPackage = {
  id: string;
  createdAt: string;
  version: "research-1.0";
  config: ResearchInput;
  sources: Content[];
  limitations: string[];
};
export type PromptResponse = {
  id: string;
  packageId: string;
  version: "prompt-1.0";
  text: string;
};
export type ReviewInput = z.infer<typeof reviewSchema>;
// Zod defaults on Candidate must not turn an omitted correction into a reset.
export const candidateCorrectionSchema = z
  .record(z.string(), z.unknown())
  .transform((input, ctx) => {
    const result = candidateSchema.partial().safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues)
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
      return z.NEVER;
    }
    return Object.fromEntries(
      Object.keys(input).map((key) => [
        key,
        result.data[key as keyof Candidate],
      ]),
    ) as Partial<Candidate>;
  });
export const reviewSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().min(5).max(2000),
    correction: candidateCorrectionSchema.optional(),
    materialScore: unit.optional(),
    originalityScore: unit.optional(),
  })
  .strict();
export const annotationSchema = z
  .object({
    classification: knowledgeSchema,
    statement: z.string().min(1).max(2000).nullable().default(null),
    attribution: z.string().max(300).nullable().default(null),
    referenceUrl: z.string().url().max(2000).nullable().default(null),
    limitations: z.string().max(2000).nullable().default(null),
  })
  .strict();
export type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
};
export type IngestionRun = {
  received?: number | null;
  startedAt?: string;
  finishedAt?: string | null;
  id: string;
  sourceId: string;
  status: string;
  accepted: number;
  pending: number;
  rejected: number;
  duplicates: number;
  queuedRemaining: number;
  error: string | null;
};
