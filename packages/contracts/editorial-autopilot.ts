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
  id: string;
  date: string;
  updatedAt: string;
  status: EditorialRunStatus;
  title: string | null;
  theme: string | null;
  sources: EditorialReference[];
  studio: EditorialReceipt | null;
  attempts: number;
  reason: string | null;
  retryAt: string | null;
  canRetry: boolean;
};
export type EditorialOverview = {
  available: boolean;
  enabled: boolean;
  nextExecution: string | null;
  latestDraft: EditorialRun | null;
  history: EditorialRun[];
};
