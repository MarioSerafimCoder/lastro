import type { EditorialReceipt, EditorialReference } from "./editorial-article";

export type EditorialRunStatus =
  | "scheduled"
  | "researching"
  | "generating"
  | "validating"
  | "sending"
  | "draft_created"
  | "needs_review"
  | "failed"
  | "skipped";
export type EditorialRun = {
  relevance?: "Em alta" | "Reflexão" | "Retroativo";
  id: string;
  date: string;
  updatedAt: string;
  status: EditorialRunStatus;
  title: string | null;
  bodyCharacters: number | null;
  theme: string | null;
  sources: EditorialReference[];
  studio: EditorialReceipt | null;
  attempts: number;
  reason: string | null;
  retryAt: string | null;
  canRetry: boolean;
};
export type EditorialOverview = {
  reserve: {
    id: string;
    theme: string;
    relevance: string;
    sources: EditorialReference[];
  }[];
  available: boolean;
  enabled: boolean;
  nextExecution: string | null;
  latestDraft: EditorialRun | null;
  history: EditorialRun[];
};

export const eligibilityReasons = {
  no_text: "Sem texto identificado",
  permission_unverified: "Permissão ainda não verificada",
  rights: "Restrição de direitos",
  capture_pending: "Captura autorizada pendente",
  insufficient: "Evidência textual insuficiente",
  quality: "Abaixo da qualidade mínima",
  invalid: "Referência indisponível, descartada ou inválida",
} as const;
export type EligibilityReason = keyof typeof eligibilityReasons;
export type EligibilityExample = {
  title: string;
  publication: string;
  url: string | null;
};
export type EditorialEligibility = {
  trendsAvailable: boolean;
  trendsError: string | null;
  trends: { title: string; publishedAt: string; url: string }[];
  recent: { references: number; rssDescriptions: number; eligible: number };
  eligible: number;
  publications: number;
  exclusions: {
    reason: EligibilityReason;
    count: number;
    examples: EligibilityExample[];
  }[];
  selection: { theme: string; sources: EditorialReference[] } | null;
};
