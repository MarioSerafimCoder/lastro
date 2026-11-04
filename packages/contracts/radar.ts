import { z } from "zod";
import type { Content, FeedPage } from "./index";

export const radarCategorySchema = z.enum([
  "art_visual_culture",
  "graphic_design",
  "photo_illustration_motion",
  "architecture_objects",
  "creative_technology",
]);
export type RadarCategory = z.infer<typeof radarCategorySchema>;
export const radarCategoryWeights: Record<RadarCategory, number> = {
  art_visual_culture: 0.3,
  graphic_design: 0.3,
  photo_illustration_motion: 0.2,
  architecture_objects: 0.1,
  creative_technology: 0.1,
};
export const radarTriageSchema = z.enum([
  "novidade",
  "para_avaliar",
  "favorito",
  "descartado",
]);
export type RadarTriage = z.infer<typeof radarTriageSchema>;
export const radarFeedQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(100).optional(),
    scope: z.enum(["all", "editorial", "scientific"]).default("all"),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    category: radarCategorySchema.optional(),
    sourceId: z.uuid().optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    after: z.iso.date().optional(),
    before: z.iso.date().optional(),
    sort: z.enum(["novidade", "relevancia"]).default("relevancia"),
    triage: radarTriageSchema.optional(),
  })
  .refine((q) => !q.after || !q.before || q.after <= q.before, {
    message: "Período inválido.",
  });
export type RadarFeedQuery = z.infer<typeof radarFeedQuerySchema>;
export type RadarReference = {
  firstSeenAt: string;
  approvedAt: string | null;
  expiresAt: string | null;
  expiredAt: string | null;
  country: string | null;
  category: RadarCategory | null;
  level: "metadata" | "enriched";
  triage: RadarTriage;
};
export type RadarFeedPage = FeedPage & {
  timezone: "America/Fortaleza";
  week: { start: string; end: string };
  filters: Omit<RadarFeedQuery, "cursor" | "limit">;
};
export function radarTriage(content: Content): RadarTriage {
  return content.state.favorite
    ? "favorito"
    : content.state.dismissed
      ? "descartado"
      : content.state.seen || content.state.selected
        ? "para_avaliar"
        : "novidade";
}
