import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  candidateSchema,
  type Candidate,
  type Source,
} from "../packages/contracts/index";
import type { Env } from "./env";
import { inferTitleLanguage, plainText } from "./normalize";
export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export class UpstreamError extends Error {
  constructor(
    status: number,
    public retryAt = 0,
  ) {
    super(`upstream_${status}`);
  }
}
const list = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const val = (v: any, n = 1200) => plainText(v, n);
const imageFromFeed = (entry: any): string | null => {
  const media = [
    ...list(entry["media:content"]),
    ...list(entry["media:thumbnail"]),
    ...list(entry.enclosure),
  ].find(
    (item: any) =>
      item &&
      typeof item === "object" &&
      (!item["@type"] || String(item["@type"]).startsWith("image/")),
  );
  const raw = val(media?.["@url"], 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
export function parseRss(
  xml: string,
  s: Source,
  forSynopsis = false,
): Candidate[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error("invalid_feed_xml");
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  const feed = doc.rss?.channel ?? doc.feed ?? doc["rdf:RDF"];
  if (!feed) throw new Error("unsupported_feed");
  return list(feed.item ?? feed.entry ?? doc["rdf:RDF"]?.item)
    .slice(0, 25)
    .map((e: any) => {
      const links = list(e.link);
      const alternate = links.find(
        (l: any) =>
          typeof l === "object" && (!l["@rel"] || l["@rel"] === "alternate"),
      );
      const url =
        val(
          alternate?.["@href"] ??
            links.find((l: any) => typeof l === "string") ??
            "",
          2000,
        ) ?? "";
      const names = list(e.author ?? e["dc:creator"])
        .map((a: any) => val(a?.name ?? a?.a?.["#text"] ?? a?.a ?? a, 100))
        .filter((n): n is string => n !== null);
      const doi = val(e["prism:doi"] ?? e["dc:identifier"], 500);
      const guid = val(e.guid ?? e.id, 500);
      const categories = list(e.category)
        .map((t: any) => val(t?.["@term"] ?? t, 100))
        .filter((t): t is string => !!t)
        .slice(0, 30);
      const kind = categories.some((t) =>
        /\b(opinion|commentary|editorial|essay)\b/i.test(t),
      )
        ? "opinion"
        : categories.some((t) => /\b(news|notícias|noticias)\b/i.test(t))
          ? "news"
          : "article";
      const title = val(e.title, 500) ?? "";
      // Full feed text is evidence only with an audited adaptation licence.
      // Normal ingestion still honours summaryAllowed and never stores the body.
      const licensedEvidence =
        forSynopsis &&
        s.synopsisAllowed &&
        !!s.synopsisRightsNote &&
        !!s.synopsisLicenseUrl;
      const entryRights = val(e.rights ?? e["dc:rights"] ?? e.copyright, 1000);
      const conflictingRights =
        entryRights && !entryRights.includes(s.synopsisLicenseUrl ?? "\0");
      const excerpt =
        licensedEvidence && !conflictingRights
          ? val(e["content:encoded"] ?? e.content ?? e.description ?? e.summary)
          : null;
      return candidateSchema.parse({
        title,
        url,
        authors: names.slice(0, 50).map((name: string) => ({ name })),
        publication: val(feed.title, 300) ?? s.name,
        publishedAt: val(e.pubDate ?? e.published ?? e["dc:date"], 100),
        language:
          val(e["dc:language"] ?? e["@xml:lang"], 20) ??
          inferTitleLanguage(title) ??
          val(feed.language ?? feed["dc:language"] ?? feed["@xml:lang"], 20),
        kind,
        description: forSynopsis
          ? licensedEvidence
            ? (excerpt?.match(/^[\s\S]*[.!?](?=\s|$)/u)?.[0] ?? null)
            : s.summaryAllowed
              ? val(e.description ?? e.summary)
              : null
          : s.summaryAllowed
            ? val(e.description ?? e.summary)
            : null,
        imageUrl: s.imageAllowed ? imageFromFeed(e) : null,
        identifiers: [
          ...(doi ? [{ scheme: "doi", value: doi }] : []),
          ...(guid ? [{ scheme: "source_guid", value: guid }] : []),
        ],
        topics: categories,
        access: "unknown",
        accessNote:
          "Somente metadados do feed; página original não foi consultada. Na ausência de idioma declarado, a inferência conservadora usa apenas o título.",
      });
    });
}
export function parseOpenAlex(data: any, s: Source): Candidate[] {
  if (!Array.isArray(data?.results))
    throw new Error("invalid_openalex_response");
  return data.results.slice(0, 25).map((w: any) =>
    candidateSchema.parse({
      title: val(w.display_name ?? w.title, 500) ?? "",
      url:
        val(w.primary_location?.landing_page_url ?? w.doi ?? w.id, 2000) ?? "",
      authors: list(w.authorships)
        .slice(0, 50)
        .flatMap((a: any) =>
          a.author?.display_name
            ? [
                {
                  name: val(a.author.display_name, 100),
                  orcid: val(a.author.orcid, 100),
                  openalex: val(a.author.id, 100),
                },
              ]
            : [],
        ),
      publication: val(w.primary_location?.source?.display_name, 300),
      publishedAt: val(w.publication_date, 100),
      kind: "paper",
      language: val(w.language, 20),
      identifiers: [
        ...(w.doi ? [{ scheme: "doi", value: w.doi }] : []),
        ...(w.id ? [{ scheme: "openalex", value: w.id }] : []),
      ],
      topics: list(w.topics)
        .map((t: any) => val(t.display_name, 100))
        .filter(Boolean)
        .slice(0, 30),
      // Do not reconstruct abstracts or download full text. The provider's access flag is contextual.
      access:
        w.open_access?.is_oa === true
          ? "open"
          : w.open_access?.is_oa === false
            ? "restricted"
            : "unknown",
      license: val(w.primary_location?.license, 300),
      accessNote:
        "Acesso informado pelo OpenAlex; texto integral não consultado.",
      retracted: w.is_retracted === true,
    }),
  );
}
export function validateFetchUrl(
  raw: string,
  env: Env,
  connector?: Source["connector"],
): URL {
  const u = new URL(raw),
    hosts = (env.ALLOWED_FETCH_HOSTS ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase());
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !hosts.includes(u.hostname) ||
    /^[\d.]+$|:/.test(u.hostname) ||
    u.hostname === "localhost" ||
    /\.(local|internal|localhost)$/.test(u.hostname)
  )
    throw new Error("fetch_host_not_allowed");
  if (
    [...u.searchParams.keys()].some((k) =>
      /token|key|secret|password|auth/i.test(k),
    )
  )
    throw new Error("credential_in_source_url");
  if (
    connector === "openalex" &&
    (u.hostname !== "api.openalex.org" || u.pathname !== "/works")
  )
    throw new Error("invalid_openalex_endpoint");
  return u;
}
export async function readBounded(
  response: Response,
  max = 2_000_000,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new Error("response_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) throw new Error("response_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const b of chunks) {
    all.set(b, offset);
    offset += b.length;
  }
  return new TextDecoder().decode(all);
}
export async function collect(
  s: Source,
  env: Env,
  conditional: { etag: string | null; last_modified: string | null },
  fetcher: Fetcher = fetch,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  forSynopsis = false,
): Promise<{
  items: Candidate[];
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
}> {
  const url = validateFetchUrl(s.url, env, s.connector);
  if (s.connector === "openalex") {
    url.searchParams.set("per-page", "25");
    url.searchParams.set("page", "1");
    url.searchParams.delete("cursor");
    url.searchParams.set("sort", "publication_date:desc");
  }
  const headers: Record<string, string> = {
    "User-Agent": forSynopsis
      ? "Lastro/0.2 (private editorial research; authorized feed excerpts)"
      : "Lastro/0.1 (metadata-only private research)",
    Accept:
      s.connector === "rss"
        ? "application/rss+xml, application/atom+xml, application/xml, text/xml"
        : "application/json",
  };
  if (conditional.etag) headers["If-None-Match"] = conditional.etag;
  if (conditional.last_modified)
    headers["If-Modified-Since"] = conditional.last_modified;
  if (s.connector === "openalex" && env.OPENALEX_API_KEY)
    headers.Authorization = `Bearer ${env.OPENALEX_API_KEY}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      response = await fetcher(url, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status === 304)
        return {
          items: [],
          notModified: true,
          etag: conditional.etag,
          lastModified: conditional.last_modified,
        };
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get("Retry-After");
        await response.body?.cancel();
        const seconds = retry
          ? /^\d+$/.test(retry)
            ? Number(retry)
            : Math.ceil((Date.parse(retry) - Date.now()) / 1000)
          : 0;
        if (attempt === 2 || seconds > 5)
          throw new UpstreamError(
            response.status,
            seconds > 0 ? Date.now() + seconds * 1000 : 0,
          );
        await sleep(Math.max(500 * 2 ** attempt, (seconds || 0) * 1000));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`upstream_${response.status}`);
      }
      const text = await readBounded(response);
      return {
        items:
          s.connector === "rss"
            ? parseRss(text, s, forSynopsis)
            : parseOpenAlex(JSON.parse(text), s),
        notModified: false,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    } catch (e) {
      if (
        e instanceof Error &&
        (/^(upstream_|invalid_|unsupported_|response_)/.test(e.message) ||
          e instanceof SyntaxError)
      )
        throw e;
      if (attempt === 2) throw new Error("network_or_parse_error");
      await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("retry_exhausted");
}
