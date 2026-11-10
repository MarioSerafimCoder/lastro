import { z } from "zod";
import type { Env } from "./env";
import { ApiFault } from "./errors";
import { stmt, rows, now } from "./db";
import { readBounded } from "./connectors";

const encoder = new TextEncoder();
const probeInput = z.object({ probe: z.string().uuid() }).strict();
const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
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
    description: text(1200),
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
  const key = await hmacKey(secret, "verify");
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
  const payload: unknown = JSON.parse(raw);
  const probe = probeInput.safeParse(payload);
  if (probe.success) {
    // Verify the authenticated receiver and its storage without storing a lead.
    await env.DB.prepare("SELECT 1 FROM opportunities LIMIT 1").first();
    return probe.data;
  }
  const input = opportunityInput.parse(payload);
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

export async function probeOpportunityDelivery(
  endpoint: string,
  secret: string,
) {
  const url = new URL(endpoint);
  if (
    url.origin !== "https://script.google.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)
  )
    throw Error("invalid_contact_endpoint");
  const probe = crypto.randomUUID();
  const timestamp = String(Date.now());
  const signature = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await hmacKey(secret, "sign"),
        encoder.encode(`lastro-portfolio-probe\n${timestamp}\n${probe}`),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const signal = AbortSignal.timeout(10000);
  let response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ probe, timestamp, signature }),
  });
  if ([302, 303].includes(response.status)) {
    const location = response.headers.get("location");
    await response.body?.cancel();
    const result = location ? new URL(location, url) : null;
    // Apps Script serves ContentService responses from this separate origin.
    if (
      result?.origin !== "https://script.googleusercontent.com" ||
      result.username ||
      result.password
    )
      throw Error("invalid_contact_redirect");
    response = await fetch(result, { redirect: "manual", signal });
  }
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    await response.body?.cancel();
    throw Error("contact_probe_unavailable");
  }
  const result = probeInput.parse(
    JSON.parse(await readBounded(response, 1024)),
  );
  if (result.probe !== probe) throw Error("contact_probe_mismatch");
}
export async function listOpportunities(env: Env) {
  await purgeOpportunities(env);
  return rows(
    env.DB,
    "SELECT * FROM opportunities ORDER BY received_at DESC LIMIT 1000",
  );
}
