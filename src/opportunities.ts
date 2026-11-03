import { z } from "zod";
import type { Env } from "./env";
import { ApiFault } from "./errors";
import { stmt, rows, now } from "./db";
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v));
export const opportunityInput = z
  .object({
    id: z.string().uuid(),
    name: text(100).min(2),
    email: z.email().max(180),
    whatsapp: z
      .string()
      .regex(/^\+?[0-9 ()-]{0,25}$/)
      .optional()
      .default(""),
    project_type: text(80).min(2),
    area: text(100).optional().default(""),
    budget: text(100).optional().default(""),
    description: text(1200).min(20),
    received_at: z.iso.datetime(),
    source: z.literal("portfolio"),
  })
  .strict();
export const opportunityUpdate = z
  .object({
    status: z.enum([
      "novo",
      "em_conversa",
      "proposta_enviada",
      "ganho",
      "perdido",
      "arquivado",
    ]),
    notes: text(4000),
    next_contact: z.iso.datetime().nullable(),
  })
  .strict();
export async function purgeOpportunities(env: Env) {
  const configured = Number(env.OPPORTUNITIES_RETENTION_DAYS || 365);
  const days =
    Number.isInteger(configured) && configured >= 1 && configured <= 3650
      ? configured
      : 365;
  await env.DB.batch([
    stmt(
      env.DB,
      "DELETE FROM opportunities WHERE received_at < ?",
      new Date(Date.now() - days * 86400000).toISOString(),
    ),
    stmt(
      env.DB,
      "DELETE FROM opportunity_receipts WHERE expires_at < ?",
      now(),
    ),
  ]);
}
export async function receiveOpportunity(request: Request, env: Env) {
  const secret = env.PORTFOLIO_INTEGRATION_SECRET;
  if (!secret || secret.length < 32)
    throw new ApiFault(
      503,
      "opportunities_disabled",
      "Integração indisponível.",
    );
  const timestamp = request.headers.get("X-Portfolio-Time") || "";
  const signature = request.headers.get("X-Portfolio-Signature") || "";
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 300000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new ApiFault(401, "invalid_signature", "Assinatura inválida.");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 8192)
    throw new ApiFault(413, "payload_too_large", "Solicitação muito grande.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.match(/../g)!, (x) =>
    parseInt(x, 16),
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      bytes,
      new TextEncoder().encode(
        timestamp + "\nPOST\n/integration/v1/opportunities\n" + raw,
      ),
    ))
  )
    throw new ApiFault(401, "invalid_signature", "Assinatura inválida.");
  const input = opportunityInput.parse(JSON.parse(raw));
  if (Math.abs(Date.now() - Date.parse(input.received_at)) > 86400000)
    throw new ApiFault(400, "invalid_date", "Data inválida.");
  await purgeOpportunities(env);
  await env.DB.batch([
    stmt(
      env.DB,
      `INSERT OR IGNORE INTO opportunities (id,name,email,whatsapp,project_type,area,budget,description,received_at,source,updated_at)
 SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM opportunity_receipts WHERE id=?)`,
      input.id,
      input.name,
      input.email,
      input.whatsapp,
      input.project_type,
      input.area,
      input.budget,
      input.description,
      input.received_at,
      input.source,
      now(),
      input.id,
    ),
    stmt(
      env.DB,
      "INSERT OR IGNORE INTO opportunity_receipts VALUES (?,?)",
      input.id,
      new Date(Date.now() + 7 * 86400000).toISOString(),
    ),
  ]);
  return { accepted: true };
}
export async function listOpportunities(env: Env) {
  await purgeOpportunities(env);
  return rows(
    env.DB,
    "SELECT * FROM opportunities ORDER BY received_at DESC LIMIT 1000",
  );
}
