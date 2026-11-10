import { plainText, folded } from "./normalize";

const boilerplate =
  /^(continue reading|read more|the post |the article |do stories and artists|subscribe|sign up|assine|leia mais|photo:|image:|foto:|cr[eé]dito|copyright|all rights reserved)/i;
function paragraphs(value: unknown): string[] {
  if (typeof value === "object" && value)
    value = (value as Record<string, unknown>)["#text"];
  if (typeof value !== "string") return [];
  return value
    .slice(0, 60000)
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1")
    .replace(/<(script|style|figure|figcaption)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<img\b[^>]*>/gi, "")
    .split(/<\/(?:p|h[1-6]|blockquote)\s*>|<br\s*\/?>/i)
    .map((part) => plainText(part, 3000))
    .filter(
      (part): part is string =>
        !!part &&
        part.length >= 8 &&
        !boilerplate.test(part) &&
        !/was originally published|continuing the conversation|highlights and responding|curso começa|assine agora|become a member/i.test(
          part,
        ),
    )
    .map((part) =>
      part
        .replace(
          /\s*(?:The post |The article |O post |O artigo )[\s\S]*?(?:appeared first on|apareceu primeiro)[\s\S]*$/i,
          "",
        )
        .trim(),
    );
}
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?][”"’']?)\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
function bounded(text: string): string | null {
  if (!text) return null;
  if (text.length <= 420) return text;
  const complete = text.slice(0, 420).match(/^[\s\S]*[.!?](?=\s|$)/u)?.[0];
  return complete?.trim() || text.slice(0, 417).replace(/\s+\S*$/, "") + "…";
}
export function feedSummary(value: unknown): string | null {
  const text = paragraphs(value)[0];
  return text ? bounded(sentences(text).slice(0, 2).join(" ")) : null;
}
const words = (text: string) => new Set(folded(text).match(/[a-z]{4,}/g) ?? []);

// Deterministic extractive summary: no model calls or invented claims.
// Select substantive sentences using title relevance and position, then restore
// source order. Body text is transient; only the short result is persisted.
export function generateFeedSummary(
  description: unknown,
  body: unknown,
  title: string,
): string | null {
  const previewText = feedSummary(description);
  const ready =
    previewText && folded(previewText) !== folded(title) ? previewText : null;
  if (ready && ready.length >= 60) return ready;
  // Medium-style editorial decks are already a source-authored précis.
  if (typeof body === "string") {
    const deck = body.match(/^\s*<h[234]\b[^>]*>([\s\S]*?)<\/h[234]>/i)?.[1];
    const preview = feedSummary(deck);
    if (preview && preview.length >= 90 && folded(preview) !== folded(title))
      return preview;
  }
  const titleWords = words(title);
  const candidates = paragraphs(body)
    .slice(0, 12)
    .flatMap(sentences)
    .slice(0, 40)
    .filter(
      (text) =>
        text.length >= 45 &&
        !boilerplate.test(text) &&
        folded(text) !== folded(title),
    );
  const unique = [...new Set(candidates)];
  const scored = unique
    .map((text, index) => ({
      text,
      index,
      score:
        Math.min(
          3,
          [...words(text)].filter((word) => titleWords.has(word)).length,
        ) *
          1.5 +
        8 / (index + 1),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: typeof scored = [];
  for (const candidate of scored) {
    if (
      !picked.length ||
      picked.reduce((n, item) => n + item.text.length + 1, 0) +
        candidate.text.length <=
        420
    )
      picked.push(candidate);
    if (picked.length === 2) break;
  }
  return (
    bounded(
      picked
        .sort((a, b) => a.index - b.index)
        .map((item) => item.text)
        .join(" "),
    ) || ready
  );
}
