import type { Candidate } from "../packages/contracts/index";
export const folded = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
export function safeUrl(value: string): URL {
  const u = new URL(value);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hostname.length < 3
  )
    throw new Error("invalid_url");
  return u;
}
export function canonicalUrl(value: string): string {
  const u = safeUrl(value);
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key))
      u.searchParams.delete(key);
  u.searchParams.sort();
  if (u.pathname !== "/") u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}
export function normalizeDoi(value: string): string | null {
  let v = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  try {
    v = decodeURIComponent(v);
  } catch {
    return null;
  }
  return /^10\.\d{4,9}\/\S+$/i.test(v) ? v.toLowerCase() : null;
}
export function plainText(v: unknown, limit = 1200): string | null {
  if (typeof v === "object" && v !== null)
    v = (v as Record<string, unknown>)["#text"];
  if (typeof v !== "string" && typeof v !== "number") return null;
  const decode = (text: string) =>
    text.replace(
      /&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt|nbsp);/gi,
      (match, entity: string) => {
        if (entity[0] === "#") {
          const code =
            entity[1]?.toLowerCase() === "x"
              ? parseInt(entity.slice(2), 16)
              : parseInt(entity.slice(1), 10);
          return code > 0 && code <= 0x10ffff
            ? String.fromCodePoint(code)
            : match;
        }
        return (
          (
            {
              amp: "&",
              quot: '"',
              apos: "'",
              lt: "<",
              gt: ">",
              nbsp: " ",
            } as Record<string, string>
          )[entity.toLowerCase()] ?? match
        );
      },
    );
  return (
    decode(
      String(v)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]*>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit) || null
  );
}
export function normalizeCandidate(c: Candidate): Candidate {
  const identifiers = c.identifiers.flatMap((i) => {
    const value = i.scheme === "doi" ? normalizeDoi(i.value) : i.value.trim();
    return value ? [{ ...i, value }] : [];
  });
  try {
    const u = safeUrl(c.url);
    if (["doi.org", "dx.doi.org"].includes(u.hostname)) {
      const d = normalizeDoi(c.url);
      if (d) identifiers.push({ scheme: "doi", value: d });
    }
  } catch {
    /* prefilter records malformed URL */
  }
  return {
    ...c,
    title: plainText(c.title, 500) ?? "",
    description: plainText(c.description),
    authors: c.authors.map((a) => ({
      ...a,
      name: plainText(a.name, 100) ?? a.name,
    })),
    identifiers: [
      ...new Map(
        identifiers.map((i) => [`${i.scheme}:${i.value}`, i]),
      ).values(),
    ],
    language: c.language?.toLowerCase().split(/[-_]/)[0] || null,
    publishedAt:
      c.publishedAt && Number.isFinite(Date.parse(c.publishedAt))
        ? new Date(c.publishedAt).toISOString()
        : null,
    topics: [...new Set(c.topics.map(folded))],
  };
}
