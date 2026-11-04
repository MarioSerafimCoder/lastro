import { z } from "zod";
export const areas = [
  "for-you",
  "salvos",
  "oficina",
  "publicacoes",
  "curadoria",
  "analytics",
  "oportunidades",
  "newsletters",
] as const;
export const intents = [
  "opportunities.new",
  "opportunities.overdue",
  "articles.top",
  "drafts.pending",
  "articles.without_newsletter",
  "newsletters.performance",
  "ecosystem.weekly",
  "integrations.failures",
  "research.unused",
  "editorial.prepare",
] as const;
export type Intent = (typeof intents)[number];
export const actionNames = [
  "opportunity.open",
  "analytics.open",
  "newsletters.open",
  "article.open",
  "studio.continue",
  "workshop.prepare",
  "integration.review",
  "references.open",
] as const;
export const actionSchema = z
  .object({ kind: z.enum(actionNames), target: z.string().max(160).optional() })
  .strict();
export type JarvisAction = z.infer<typeof actionSchema>;
export const querySchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    area: z.enum(areas).default("for-you"),
    choice: z.enum(intents).optional(),
    allowAI: z.boolean().default(false),
  })
  .strict();
export const preferencesSchema = z
  .object({
    enabled: z.boolean(),
    proactive: z.boolean(),
    communication: z.enum(["formal", "discreto"]),
    area: z.enum(areas),
  })
  .strict();
export type JarvisPreferences = z.infer<typeof preferencesSchema>;
export type Period = {
  label: string;
  from: string | null;
  to: string;
  days: 7 | 30 | null;
};
export type Answer = {
  text: string;
  source: string;
  period: Period;
  syncedAt: string | null;
  incomplete: boolean;
  stale: boolean;
  action?: JarvisAction;
  choices?: { intent: Intent; label: string }[];
  ai: { enabled: false; reason: string };
};
export type Notice = {
  id: string;
  priority: 100 | 95 | 90 | 75 | 60 | 45;
  text: string;
  action: JarvisAction;
  changedAt: string;
};
export type JarvisState = {
  preferences: JarvisPreferences;
  notices: Notice[];
  syncedAt: string;
  ai: Answer["ai"];
};
export const noticeSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.enum(["shown", "dismiss", "snooze"]),
  })
  .strict();
export const labels: Record<Intent, string> = {
  "opportunities.new": "Novos pedidos de orçamento",
  "opportunities.overdue": "Acompanhamentos atrasados",
  "articles.top": "Artigos mais acessados",
  "drafts.pending": "Rascunhos pendentes",
  "articles.without_newsletter": "Artigos sem newsletter",
  "newsletters.performance": "Desempenho das newsletters",
  "ecosystem.weekly": "Resumo do ecossistema",
  "integrations.failures": "Falhas de integração",
  "research.unused": "Referências sem uso",
  "editorial.prepare": "Preparar briefing na Oficina",
};
