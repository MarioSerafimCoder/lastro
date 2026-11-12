// editorial-1.0. Keep this dependency-free contract identical in Lastro and Studio.
export const EDITORIAL_VERSION = "editorial-1.0" as const;
export const EDITORIAL_ARTICLES = "/integration/v1/editorial-drafts";
export const EDITORIAL_MEMORY = "/integration/v1/editorial-memory";
export const editorialCategories = [
  "identidade-visual",
  "branding",
  "direcao-de-arte",
  "processo",
  "tecnologia",
  "referencias",
] as const;
export const evidenceKinds = [
  "authorized_feed_description",
  "authorized_abstract",
] as const;
export type EditorialReference = {
  contentId: string;
  sourceId: string;
  title: string;
  publication: string;
  url: string;
  publishedAt: string;
  kind: (typeof evidenceKinds)[number];
};
export type EditorialMemory = {
  title: string;
  summary: string;
  argument: string;
};
export type EditorialArticle = EditorialMemory & {
  version: typeof EDITORIAL_VERSION;
  origin: "lastro-autopilot";
  runId: string;
  editorialDate: string;
  slug: string;
  category: (typeof editorialCategories)[number];
  markdown: string;
  references: EditorialReference[];
  generation: {
    model: string;
    verificationModel: string;
    promptVersion: string;
    reservedNeurons: number;
  };
};
export type EditorialReceipt = {
  version: typeof EDITORIAL_VERSION;
  id: string;
  revision: number;
  adminUrl: string;
};
export const editorialId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const record = (value: unknown, keys: string[]) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const names = Object.keys(value);
  return (
    names.length === keys.length && names.every((name) => keys.includes(name))
  );
};
const plain = (value: unknown, limit: number) =>
  typeof value === "string" &&
  value.length <= limit &&
  value.trim() === value &&
  value.length > 0 &&
  !/[\u0000-\u001f\u007f<>{}]/u.test(value);
export function editorialUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    /[\s<>"\\]/u.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.hostname.includes(".") &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function editorialReference(value: EditorialReference) {
  return (
    record(value, [
      "contentId",
      "sourceId",
      "title",
      "publication",
      "url",
      "publishedAt",
      "kind",
    ]) &&
    typeof value.contentId === "string" &&
    editorialId.test(value.contentId) &&
    typeof value.sourceId === "string" &&
    editorialId.test(value.sourceId) &&
    plain(value.title, 240) &&
    plain(value.publication, 160) &&
    editorialUrl(value.url) &&
    typeof value.publishedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value.publishedAt) &&
    Number.isFinite(Date.parse(value.publishedAt)) &&
    evidenceKinds.includes(value.kind)
  );
}
export const evidenceLabel = (kind: EditorialReference["kind"]) =>
  kind === "authorized_abstract"
    ? "Resumo autorizado"
    : "Trecho autorizado do feed";
const escapeLabel = (label: string) =>
  label.replace(/[\\\x60*_[\]()#!|]/g, "\\$&");
export function editorialReferences(references: EditorialReference[]) {
  return (
    "\n\n## Referências consultadas\n\n" +
    references
      .map(
        (r, i) =>
          `${i + 1}. [${escapeLabel(r.title)}](<${r.url}>) — ${escapeLabel(r.publication)}. ${evidenceLabel(r.kind)}.`,
      )
      .join("\n") +
    "\n"
  );
}
export function editorialBodyValid(body: string) {
  if (
    body.length > 10000 ||
    /[\u0000-\u0008\u000b-\u001f\u007f<>{}`\\]|https?:|www\.|!\[|\]\s*\(|^\s*\[[^\]]+\]:|^\s*(?:---+|===+)\s*$/im.test(
      body,
    )
  )
    return false;
  const words =
    body
      .replace(/\[S[1-3]\]/g, "")
      .match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const cites = [...body.matchAll(/\[S\d[^\]\n]*\]/gi)].map(
    (match) => match[0],
  );
  return (
    words >= 600 &&
    words <= 900 &&
    !body.startsWith("# ") &&
    cites.every((cite) => /^\[S[1-3]\]$/.test(cite)) &&
    new Set(cites).size === 3
  );
}
export function parseEditorialArticle(value: unknown): EditorialArticle {
  const article = value as EditorialArticle;
  if (
    !record(article, [
      "version",
      "origin",
      "runId",
      "editorialDate",
      "title",
      "slug",
      "summary",
      "argument",
      "category",
      "markdown",
      "references",
      "generation",
    ]) ||
    article.version !== EDITORIAL_VERSION ||
    article.origin !== "lastro-autopilot" ||
    typeof article.runId !== "string" ||
    !editorialId.test(article.runId) ||
    typeof article.editorialDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(article.editorialDate) ||
    !Number.isFinite(Date.parse(article.editorialDate)) ||
    new Date(article.editorialDate).toISOString().slice(0, 10) !==
      article.editorialDate ||
    !plain(article.title, 160) ||
    !plain(article.summary, 300) ||
    !plain(article.argument, 600) ||
    typeof article.slug !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) ||
    article.slug.length > 150 ||
    !editorialCategories.includes(article.category) ||
    !Array.isArray(article.references) ||
    article.references.length !== 3 ||
    !article.references.every(editorialReference) ||
    new Set(article.references.map((r) => r.contentId)).size !== 3 ||
    new Set(article.references.map((r) => r.sourceId)).size !== 3 ||
    new Set(article.references.map((r) => r.url)).size !== 3 ||
    !record(article.generation, [
      "model",
      "verificationModel",
      "promptVersion",
      "reservedNeurons",
    ]) ||
    !plain(article.generation.model, 150) ||
    !plain(article.generation.verificationModel, 150) ||
    !plain(article.generation.promptVersion, 60) ||
    !Number.isSafeInteger(article.generation.reservedNeurons) ||
    article.generation.reservedNeurons < 1 ||
    article.generation.reservedNeurons > 1000 ||
    typeof article.markdown !== "string" ||
    article.markdown.length > 18000
  )
    throw Error("invalid_editorial_article");
  const references = editorialReferences(article.references);
  if (
    !article.markdown.endsWith(references) ||
    !editorialBodyValid(article.markdown.slice(0, -references.length))
  )
    throw Error("invalid_editorial_markdown");
  return article;
}
