import { z } from "zod";
import { areas, intents, type Answer, type Intent } from "./jarvis";

export const dialogueIntents = [
  ...intents,
  "analytics.total",
  "priorities",
] as const;
export type DialogueIntent = (typeof dialogueIntents)[number];
export type Metric = "traffic" | "sessions" | "views" | "users" | "engagement";
export type Window = {
  start: string;
  end: string;
  label: string;
  kind: "today" | "yesterday" | "week" | "last_week" | "rolling" | "previous";
  days: number;
};
export type Slots = {
  topic: string | null;
  intent: DialogueIntent | null;
  metric: Metric;
  period: Window | null;
};
export type Pending = {
  kind: "period" | "clarification" | "confirmation";
  question: string;
  alternatives: DialogueIntent[];
};
export type DialogueContext = Slots & {
  version: 1;
  id: string;
  revision: number;
  previous: Slots | null;
  pending: Pending | null;
  lastGrounded: Answer | null;
  response: Answer | null;
  plan: "query" | "reply";
  socialTurn: number;
};
export type DialogueView = {
  id: string;
  revision: number;
  state: string;
  pending: Pending | null;
  topic: string | null;
  metric: Metric;
  period: Window | null;
  restored: boolean;
};
export type DialogueReply = Answer & { conversation: DialogueView };
export const dialogueInputSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    area: z.enum(areas).default("for-you"),
    conversationId: z.uuid(),
    revision: z.number().int().min(0).max(1000000),
  })
  .strict();
export const dialogueResetSchema = z
  .object({ conversationId: z.uuid(), revision: z.number().int().min(0) })
  .strict();
export const legacyIntent = (intent: DialogueIntent): intent is Intent =>
  (intents as readonly string[]).includes(intent);
