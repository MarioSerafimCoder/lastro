// ecosystem-1.0: versioned identical source in Lastro, Studio and CRM. No dependencies.
export const VERSION = "ecosystem-1.0" as const;
export type DraftInput = {
  version: typeof VERSION;
  packageId: string;
  title: string;
  objective: string;
  argument: string;
  notes: string;
  outline: string[];
  references: { title: string; url: string; note: string }[];
};
export type Article = {
  version: typeof VERSION;
  slug: string;
  sha: string;
  title: string;
  summary: string;
  category: string;
  url: string;
  cover: string | null;
  publishAt: string;
};
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const shaPattern = /^[a-f0-9]{40}$/;
export function object(value: unknown, keys: string[]): Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw Error("invalid_contract");
  return value as Record<string, any>;
}
function str(v: unknown, max: number, min = 0): v is string {
  return typeof v === "string" && v.length >= min && v.length <= max;
}
function https(v: unknown) {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function draftInput(value: unknown): DraftInput {
  const v = object(value, [
    "version",
    "packageId",
    "title",
    "objective",
    "argument",
    "notes",
    "outline",
    "references",
  ]);
  if (
    v.version !== VERSION ||
    !str(v.packageId, 36, 36) ||
    !/^[a-f0-9-]{36}$/.test(v.packageId) ||
    !str(v.title, 200, 1) ||
    !str(v.objective, 5000) ||
    !str(v.argument, 5000) ||
    !str(v.notes, 5000) ||
    !Array.isArray(v.outline) ||
    v.outline.length > 30 ||
    !v.outline.every((s: unknown) => str(s, 500)) ||
    !Array.isArray(v.references) ||
    v.references.length > 20
  )
    throw Error("invalid_contract");
  for (const r of v.references) {
    object(r, ["title", "url", "note"]);
    if (
      !str(r.title, 1000) ||
      !str(r.url, 2048) ||
      !https(r.url) ||
      !str(r.note, 5000)
    )
      throw Error("invalid_contract");
  }
  return v as DraftInput;
}
export function articleInput(value: unknown): Article {
  const v = object(value, [
    "version",
    "slug",
    "sha",
    "title",
    "summary",
    "category",
    "url",
    "cover",
    "publishAt",
  ]);
  if (
    v.version !== VERSION ||
    !str(v.slug, 160, 1) ||
    !slugPattern.test(v.slug) ||
    !shaPattern.test(v.sha) ||
    !str(v.title, 200, 1) ||
    !str(v.summary, 5000, 1) ||
    !str(v.category, 100, 1) ||
    v.url !== `https://marioserafim.com.br/blog/${v.slug}` ||
    !str(v.publishAt, 40, 1) ||
    !Number.isFinite(Date.parse(v.publishAt)) ||
    Date.parse(v.publishAt) > Date.now() ||
    (v.cover !== null &&
      (!str(v.cover, 2048) ||
        !v.cover.startsWith("https://marioserafim.com.br/media/blog/")))
  )
    throw Error("invalid_contract");
  return v as Article;
}
export async function signature(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
const message = (r: Request, time: string, body: string) =>
  `${time}\n${r.method}\n${new URL(r.url).pathname}${new URL(r.url).search}\n${body}`;
export async function sign(request: Request, secret: string) {
  if (secret.length < 32) throw Error("integration_not_configured");
  const time = String(Date.now()),
    body = await request.clone().text(),
    headers = new Headers(request.headers);
  headers.set("X-Ecosystem-Time", time);
  headers.set(
    "X-Ecosystem-Signature",
    await signature(secret, message(request, time, body)),
  );
  return new Request(request, { headers });
}
export async function verify(
  request: Request,
  secret?: string,
): Promise<string> {
  if (!secret || secret.length < 32) throw new Response(null, { status: 503 });
  if (request.headers.has("Origin") || request.headers.has("Cookie"))
    throw new Response(null, { status: 403 });
  const time = request.headers.get("X-Ecosystem-Time") || "",
    sig = request.headers.get("X-Ecosystem-Signature") || "";
  if (
    !/^\d{13}$/.test(time) ||
    Math.abs(Date.now() - Number(time)) > 300000 ||
    !/^[a-f0-9]{64}$/.test(sig)
  )
    throw new Response(null, { status: 401 });
  const reader = request.body?.getReader();
  let body = "",
    size = 0;
  const decoder = new TextDecoder();
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new Response(null, { status: 413 });
      }
      body += decoder.decode(value, { stream: true });
    }
  body += decoder.decode();
  const expected = await signature(secret, message(request, time, body));
  let diff = 0;
  for (let i = 0; i < 64; i++)
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff) throw new Response(null, { status: 401 });
  return body;
}
