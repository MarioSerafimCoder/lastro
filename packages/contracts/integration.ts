import { z } from "zod";
export const integrationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    argument: z.string().max(5000).default(""),
    outline: z.array(z.string().max(500)).max(30).default([]),
  })
  .strict();
export type IntegrationRequest = z.infer<typeof integrationRequestSchema>;
export const integrationStateSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "error",
  "intervention",
]);
export const integrationEventSchema = z.enum([
  "research.package.created",
  "studio.draft.created",
  "blog.article.published",
  "crm.newsletter.draft.created",
  "integration.failed",
]);
export const integrationResultSchema = z
  .object({
    version: z.literal("ecosystem-1.0"),
    id: z.string().min(1).max(100),
    adminUrl: z.url(),
  })
  .passthrough();
export const catalogueSchema = z.object({
  version: z.literal("ecosystem-1.0"),
  posts: z
    .array(
      z.object({
        slug: z
          .string()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(160),
        sha: z.string().regex(/^[a-f0-9]{40}$/),
      }),
    )
    .max(50),
  drafts: z
    .array(
      z.object({
        id: z.uuid(),
        slug: z.string(),
        originPackageId: z.uuid(),
        revision: z.number().int(),
        sourceSha: z.string().nullable(),
        privateChanges: z.boolean(),
        updatedAt: z.iso.datetime(),
        adminUrl: z.url(),
      }),
    )
    .max(500),
});
export type IntegrationState = z.infer<typeof integrationStateSchema>;
export type IntegrationTask = {
  id: string;
  kind: "studio" | "article";
  source_id: string;
  version: string;
  state: IntegrationState;
  payload: string;
  attempts: number;
  cycle_attempts: number;
  lease_token: string;
  created_at: string;
  updated_at: string;
};
