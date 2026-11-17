import assert from "node:assert/strict";
import test from "node:test";
import {
  googleTrends,
  googleTrendsStatus,
  parseGoogleTrends,
} from "../src/google-trends";

const at = Date.parse("2026-11-16T12:00:00Z");
const feed = `<?xml version="1.0"?><rss><channel><title>Daily Search Trends</title>
  <item><title>design brasileiro</title><pubDate>Mon, 16 Nov 2026 11:00:00 GMT</pubDate></item>
  <item><title>futebol</title><pubDate>Mon, 16 Nov 2026 11:00:00 GMT</pubDate></item>
  <item><title>estudo antigo</title><pubDate>Fri, 13 Nov 2026 11:00:00 GMT</pubDate></item>
</channel></rss>`;

test("Google Trends contributes recent editorial signals without accepting unrelated or old searches", async () => {
  assert.deepEqual(
    parseGoogleTrends(feed, at).map((item) => item.title),
    ["design brasileiro"],
  );
  assert.deepEqual(
    (
      await googleTrends(
        at,
        async (url) =>
          new Response(
            String(url).endsWith("geo=BR")
              ? feed
              : feed.replace("design brasileiro", "generative AI"),
          ),
      )
    ).map((item) => [item.region, item.title]),
    [
      ["BR", "design brasileiro"],
      ["US", "generative AI"],
    ],
  );
  assert.throws(
    () => parseGoogleTrends("<!DOCTYPE rss><rss/>", at),
    /invalid_trends_feed/,
  );
});

test("Trends keeps one region during a partial outage and yields no evidence on total outage", async () => {
  const result = await googleTrendsStatus(at, async (url) =>
    String(url).endsWith("geo=BR")
      ? new Response(feed)
      : new Response(null, { status: 503 }),
  );
  assert.deepEqual(result.regions, [
    { region: "BR", available: true },
    { region: "US", available: false },
  ]);
  assert.equal(result.items.length, 1);
  assert.deepEqual(
    await googleTrends(at, async () => new Response(null, { status: 503 })),
    [],
  );
});
