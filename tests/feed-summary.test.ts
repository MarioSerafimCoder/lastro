import test from "node:test";
import assert from "node:assert/strict";
import { feedSummary, generateFeedSummary } from "../src/feed-summary";
import { parseRss } from "../src/connectors";
import { fixtureSource, rss } from "./fixtures";

test("source preview removes images and subscription boilerplate", () => {
  assert.equal(
    feedSummary(
      '<p><img alt="Photo" src="x"/>A new visual identity uses modular letters and a brighter palette.</p><p>Subscribe to read more.</p>',
    ),
    "A new visual identity uses modular letters and a brighter palette.",
  );
});
test("preview is bounded and never invents missing evidence", () => {
  assert.equal(feedSummary(null), null);
  assert.equal(feedSummary("<p>Read more</p>"), null);
  assert.ok(
    feedSummary("An editorial discussion " + "about design ".repeat(100))!
      .length <= 420,
  );
  assert.equal(
    feedSummary("First sentence. Second sentence. Third sentence."),
    "First sentence. Second sentence.",
  );
});
test("lead fallback requires explicit opt-in and honours item rights", () => {
  const xml = rss
    .replace(/<description>[\s\S]*?<\/description>/, "")
    .replace(
      "Não armazenar texto integral",
      "<![CDATA[<figure>Photo caption</figure><p>The essay discusses artificial intelligence and its impact on the design profession.</p><p>Remaining body must not be stored.</p>]]>",
    );
  assert.equal(parseRss(xml, fixtureSource)[0].description, null);
  const enabled = { ...fixtureSource, feedTextSummaryAllowed: true };
  assert.equal(
    parseRss(xml, enabled)[0].description,
    "The essay discusses artificial intelligence and its impact on the design profession.",
  );
  assert.equal(
    parseRss(xml, { ...enabled, summaryAllowed: false })[0].description,
    null,
  );
  assert.equal(
    parseRss(
      xml.replace("</item>", "<dc:rights>No reuse</dc:rights></item>"),
      enabled,
    )[0].description,
    null,
  );
});

test("generates a summary from article text when description is absent or repeats the title", () => {
  const title = "Caixa renova a identidade visual";
  const body =
    "<p>A Caixa apresentou uma nova identidade visual que preserva o X azul e laranja da marca.</p><p>O projeto de identidade visual amplia as aplicações da marca em ambientes digitais e nas agências.</p><p>Assine para receber nossas notícias.</p>";
  for (const description of [null, title]) {
    const result = generateFeedSummary(description, body, title)!;
    assert.match(result, /preserva o X azul e laranja/);
    assert.match(result, /ambientes digitais/);
    assert.doesNotMatch(result, /Assine/);
  }
  assert.equal(generateFeedSummary(null, null, title), null);
  assert.equal(generateFeedSummary(title, null, title), null);
});

test("extractive summaries preserve decimal numbers and source wording", () => {
  const text =
    "The studio invested $10.5 million in the design project. The new exhibition opens to visitors in November 2026.";
  assert.equal(feedSummary(text), text);
  assert.equal(
    generateFeedSummary(null, `<p>${text}</p>`, "Design project"),
    text,
  );
});
