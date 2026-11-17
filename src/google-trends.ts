import { XMLParser, XMLValidator } from "fast-xml-parser";
import { readBounded, type Fetcher } from "./connectors";
import { folded } from "./normalize";

const regions = ["BR", "US"] as const;
type Region = (typeof regions)[number];
export type TrendSignal = {
  title: string;
  publishedAt: string;
  url: string;
  region: Region;
};
const feedUrl = (region: Region) =>
  `https://trends.google.com/trending/rss?geo=${region}`;
const RELEVANT =
  /\b(design|marca|branding|arte|artista|cultura|criativ\w*|inteligencia artificial|ia|tecnologia|tipografia|fotografia|ilustracao|arquitetura|cinema|publicidade|moda|inovacao|pesquisa|estudo|art|artist|culture|creativ\w*|artificial intelligence|generative ai|ai|copyright|technology|typography|photography|illustration|architecture|innovation|creative economy|economia criativa)\b/u;

export function parseGoogleTrends(
  xml: string,
  at = Date.now(),
  region: Region = "BR",
): TrendSignal[] {
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
        {
          title,
          publishedAt: new Date(time).toISOString(),
          url: feedUrl(region),
          region,
        },
      ];
    })
    .slice(0, 20);
}

async function regionalTrends(
  region: Region,
  at: number,
  fetcher: Fetcher,
): Promise<TrendSignal[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(feedUrl(region), {
      headers: { Accept: "application/rss+xml" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`trends_${response.status}`);
    return parseGoogleTrends(await readBounded(response, 300_000), at, region);
  } finally {
    clearTimeout(timeout);
  }
}

export async function googleTrendsStatus(
  at = Date.now(),
  fetcher: Fetcher = fetch,
) {
  const results = await Promise.allSettled(
    regions.map((region) => regionalTrends(region, at, fetcher)),
  );
  return {
    items: results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
    regions: regions.map((region, index) => ({
      region,
      available: results[index].status === "fulfilled",
    })),
  };
}

export async function googleTrends(
  at = Date.now(),
  fetcher: Fetcher = fetch,
): Promise<TrendSignal[]> {
  return (await googleTrendsStatus(at, fetcher)).items;
}
