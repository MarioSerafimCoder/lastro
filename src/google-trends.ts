import { XMLParser, XMLValidator } from "fast-xml-parser";
import { readBounded, type Fetcher } from "./connectors";
import { folded } from "./normalize";

export type TrendSignal = { title: string; publishedAt: string; url: string };
const FEED_URL = "https://trends.google.com/trending/rss?geo=BR";
const RELEVANT =
  /\b(design|marca|branding|arte|artista|cultura|criativ\w*|inteligencia artificial|\bia\b|tecnologia|tipografia|fotografia|ilustracao|arquitetura|cinema|publicidade|moda|inovacao|pesquisa|estudo)\b/u;

export function parseGoogleTrends(xml: string, at = Date.now()): TrendSignal[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error("invalid_trends_feed");
  const rss = new XMLParser({
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  const channel = rss.rss?.channel;
  if (!channel || channel.title !== "Daily Search Trends")
    throw new Error("invalid_trends_feed");
  const items = Array.isArray(channel.item)
    ? channel.item
    : channel.item
      ? [channel.item]
      : [];
  return items
    .flatMap((item: any) => {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const publishedAt = typeof item.pubDate === "string" ? item.pubDate : "";
      const time = Date.parse(publishedAt);
      if (
        !title ||
        title.length > 120 ||
        !RELEVANT.test(folded(title)) ||
        !Number.isFinite(time) ||
        time > at ||
        at - time > 48 * 60 * 60 * 1000
      )
        return [];
      return [
        { title, publishedAt: new Date(time).toISOString(), url: FEED_URL },
      ];
    })
    .slice(0, 20);
}

export async function googleTrends(
  at = Date.now(),
  fetcher: Fetcher = fetch,
): Promise<TrendSignal[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(FEED_URL, {
      headers: { Accept: "application/rss+xml" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`trends_${response.status}`);
    return parseGoogleTrends(await readBounded(response, 300_000), at);
  } finally {
    clearTimeout(timeout);
  }
}
