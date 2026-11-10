import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { migrationStatements } from "./migration-statements";
import { fixtureSource, fixtureCandidate, contentFixture } from "./fixtures";
import {
  defaultPolicy,
  sourceInputSchema,
  type Source,
} from "../packages/contracts";
import { saveContent, ingestSource, scheduledIngest } from "../src/ingestion";
import { evaluate } from "../src/quality";
import { radarFeed } from "../src/radar-feed";
import { expireRadar } from "../src/radar-retention";
import {
  balanceLanguages,
  classifyRadar,
  rank,
  rankRadar,
} from "../src/ranking";
import { editorialWeek, cycleKey, RETENTION_MS } from "../src/schedule";
import { radarStatus } from "../src/radar";
import { app } from "../src/index";
import type { Env } from "../src/env";
const clock = Date.parse("2026-11-04T15:00:00Z"),
  at = new Date(clock).toISOString();
const prefs = { interests: [], languages: [] };
async function isolated(fn: (env: Env, s: Source) => Promise<void>) {
  const mf = new Miniflare(
    await convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("test")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
    }),
  );
  try {
    const DB = await mf.getD1Database("DB");
    for (const f of (await readdir("migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      for (const sql of migrationStatements(
        await readFile("migrations/" + f, "utf8"),
      ))
        await DB.prepare(sql).run();
    await DB.prepare("INSERT OR IGNORE INTO quality_policies VALUES (?,?,1,?)")
      .bind(defaultPolicy.version, JSON.stringify(defaultPolicy), at)
      .run();
    const {
      id: sourceId,
      status,
      createdAt,
      nextFetchAt,
      synopsisPermissionVersion,
      ...input
    } = fixtureSource;
    const s = {
      ...fixtureSource,
      ...sourceInputSchema.parse({
        ...input,
        country: "US",
        radarCategory: "graphic_design",
        summaryAllowed: true,
        imageAllowed: false,
      }),
    };
    await DB.prepare(
      "INSERT INTO sources(id,name,connector,url,status,config_json,created_at) VALUES (?,?,?,?,?,?,?)",
    )
      .bind(s.id, s.name, s.connector, s.url, "approved", JSON.stringify(s), at)
      .run();
    await fn(
      {
        DB,
        ENVIRONMENT: "development",
        DEV_TOKEN: "radar2-private-test-token-".repeat(3),
        INGEST_ENABLED: "true",
        SYNOPSIS_REQUIRED: "true",
        ALLOWED_FETCH_HOSTS: "fixtures.example.test",
      } as Env,
      s,
    );
  } finally {
    await mf.dispose();
  }
}
async function create(
  env: Env,
  s: Source,
  overrides: Record<string, unknown> = {},
  firstSeen = at,
) {
  const key = crypto.randomUUID();
  const c = {
    ...fixtureCandidate,
    url: "https://fixtures.example.test/" + key,
    identifiers: [{ scheme: "source_guid" as const, value: key }],
    publishedAt: at,
    description: fixtureCandidate.description,
    imageUrl: null,
    ...overrides,
  };
  return saveContent(
    env.DB,
    c as typeof fixtureCandidate,
    s,
    evaluate(c as typeof fixtureCandidate, s, defaultPolicy, clock),
    "approved",
    undefined,
    "heuristic",
    clock,
    firstSeen,
  );
}
const xml = (date: string, ids = ["a", "b"]) =>
  `<rss><channel><language>en</language>${ids.map((id) => `<item><title>Graphic design identity ${id}</title><link>https://fixtures.example.test/${id}</link><guid>${id}</guid><author>Test Writer</author><pubDate>${date}</pubDate><category>design</category></item>`).join("")}</channel></rss>`;

test("Radar week is Monday in Fortaleza, including UTC midnight and year rollover", () => {
  assert.deepEqual(editorialWeek(Date.parse("2026-11-02T02:59:59Z")), {
    start: "2026-10-26T03:00:00.000Z",
    end: "2026-11-02T03:00:00.000Z",
  });
  assert.deepEqual(editorialWeek(Date.parse("2026-11-02T03:00:00Z")), {
    start: "2026-11-02T03:00:00.000Z",
    end: "2026-11-09T03:00:00.000Z",
  });
  assert.equal(
    editorialWeek(Date.parse("2027-01-01T12:00:00Z")).start,
    "2026-12-28T03:00:00.000Z",
  );
  assert.equal(
    cycleKey({ connector: "rss" }, Date.parse("2026-11-04T02:59:00Z")),
    "2026-11-03",
  );
});
test("Radar classification keeps art installations and sculpture out of architecture", () => {
  assert.equal(
    classifyRadar(
      {
        title: "A living archive through installation and sculpture",
        topics: [],
      },
      { radarCategory: "art_visual_culture" },
    ),
    "art_visual_culture",
  );
  assert.equal(
    classifyRadar(
      {
        title: "A new identity system inspired by sculpture",
        topics: ["graphic design"],
      },
      { radarCategory: "art_visual_culture" },
    ),
    "graphic_design",
  );
  assert.equal(
    classifyRadar(
      { title: "A sculpture installation inside a museum", topics: [] },
      { radarCategory: "art_visual_culture" },
    ),
    "art_visual_culture",
  );
  assert.equal(
    classifyRadar(
      { title: "Architecture for a changing city", topics: [] },
      { radarCategory: "art_visual_culture" },
    ),
    "architecture_objects",
  );
});
test("Daily ranking never fills with old evergreen articles or synopsis approval dates", () => {
  const fresh = contentFixture({ publishedAt: at, collectedAt: at });
  const old = contentFixture({
    publishedAt: "2020-01-01",
    collectedAt: at,
    evergreen: true,
    synopsis: {
      text: "synthetic",
      status: "validated",
      generatorVersion: "test",
      validatedAt: at,
      evidenceUrl: "https://fixtures.example.test",
    },
  });
  assert.deepEqual(
    rankRadar([fresh, old], prefs, defaultPolicy, clock).map(
      (i) => i.content.id,
    ),
    [fresh.id],
  );
  assert.equal(rank([old], prefs, defaultPolicy, clock).length, 1); // Existing scientific/general ranking is preserved.
});
test("Language balancing preserves every surplus, third language and unknown language", () => {
  const items = Array.from({ length: 9 }, (_, i) =>
    contentFixture({
      id: String(i),
      language: i === 0 ? "pt" : i === 1 ? "fr" : i === 8 ? null : "en",
    }),
  );
  const result = balanceLanguages(rank(items, prefs, defaultPolicy, clock));
  assert.equal(result.length, 9);
  assert.equal(new Set(result.map((i) => i.content.id)).size, 9);
});
test("Source summaries are visible without AI and preserve publication dates", async () =>
  isolated(async (env, s) => {
    const id = await create(env, s);
    const page = await radarFeed(
      env.DB,
      { scope: "editorial" },
      prefs,
      defaultPolicy,
      clock,
    );
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].content.id, id);
    assert.equal(page.items[0].content.synopsis, null);
    assert.equal(page.items[0].content.radar?.level, "metadata");
    assert.equal(page.items[0].content.radar?.firstSeenAt, at);
    assert.equal(page.items[0].content.radar?.approvedAt, at);
    assert.equal(
      page.items[0].content.description,
      fixtureCandidate.description,
    );
    assert.equal(page.items[0].content.imageUrl, null);
    assert.equal(
      await env.DB.prepare("SELECT COUNT(*) n FROM synopsis_inferences").first(
        "n",
      ),
      0,
    );
    await env.DB.prepare(
      "UPDATE content_synopses SET status='validated',validated_at='2099-01-01' WHERE content_id=?",
    )
      .bind(id)
      .run();
    await env.DB.prepare(
      "UPDATE contents SET published_at='2020-01-01',metadata_json=json_set(metadata_json,'$.publishedAt','2020-01-01') WHERE id=?",
    )
      .bind(id)
      .run();
    assert.equal(
      (
        await radarFeed(
          env.DB,
          { scope: "editorial" },
          prefs,
          defaultPolicy,
          clock,
        )
      ).items.length,
      0,
    );
  }));
test("Typed filters, triage and cursor revalidation retain unequal language pools", async () =>
  isolated(async (env, s) => {
    const ids = [];
    for (let i = 0; i < 5; i++)
      ids.push(
        await create(env, s, {
          language: i === 0 ? "pt" : "en",
          title: "Graphic design identity " + i,
        }),
      );
    await env.DB.prepare("INSERT INTO favorites VALUES (?,?,?)")
      .bind("owner", ids[0], at)
      .run();
    await env.DB.prepare("INSERT INTO interactions VALUES (?,?,'seen',1,?)")
      .bind("owner", ids[1], at)
      .run();
    await env.DB.prepare(
      "INSERT INTO interactions VALUES (?,?,'dismissed',1,?)",
    )
      .bind("owner", ids[2], at)
      .run();
    const first = await radarFeed(
      env.DB,
      { scope: "editorial", limit: "2" },
      prefs,
      defaultPolicy,
      clock,
    );
    assert.equal(first.items.length, 2);
    assert.ok(first.nextCursor);
    const second = await radarFeed(
      env.DB,
      { scope: "editorial", limit: "2", cursor: first.nextCursor! },
      prefs,
      defaultPolicy,
      clock,
    );
    assert.equal(second.items.length, 2);
    assert.equal(
      new Set([...first.items, ...second.items].map((i) => i.content.id)).size,
      4,
    );
    const filters = {
      scope: "editorial",
      country: "US",
      category: "graphic_design",
      language: "en",
      sort: "novidade",
      after: "2026-11-02",
      before: "2026-11-04",
    };
    assert.equal(
      (await radarFeed(env.DB, filters, prefs, defaultPolicy, clock)).items
        .length,
      3,
    );
    for (const [triage, id] of [
      ["favorito", ids[0]],
      ["para_avaliar", ids[1]],
      ["descartado", ids[2]],
    ])
      assert.deepEqual(
        (
          await radarFeed(
            env.DB,
            { scope: "editorial", triage },
            prefs,
            defaultPolicy,
            clock,
          )
        ).items.map((i) => i.content.id),
        [id],
      );
    await env.DB.prepare("UPDATE sources SET status='paused' WHERE id=?")
      .bind(s.id)
      .run();
    assert.equal(
      (
        await radarFeed(
          env.DB,
          { scope: "editorial", limit: "2", cursor: first.nextCursor! },
          prefs,
          defaultPolicy,
          clock,
        )
      ).items.length,
      0,
    );
    await assert.rejects(
      () =>
        radarFeed(
          env.DB,
          { ...filters, cursor: first.nextCursor! },
          prefs,
          defaultPolicy,
          clock,
        ),
      /Filtros/,
    );
  }));
test("Nine-day expiration preserves favorites, Workshop, packages, citations and audit foreign keys", async () =>
  isolated(async (env, s) => {
    const old = new Date(clock - RETENTION_MS).toISOString();
    const plain = await create(
        env,
        s,
        { publishedAt: new Date(clock - 3600000).toISOString() },
        old,
      ),
      favorite = await create(
        env,
        s,
        { publishedAt: new Date(clock - 3600000).toISOString() },
        old,
      ),
      selected = await create(
        env,
        s,
        { publishedAt: new Date(clock - 3600000).toISOString() },
        old,
      ),
      packed = await create(
        env,
        s,
        { publishedAt: new Date(clock - 3600000).toISOString() },
        old,
      );
    await env.DB.prepare("INSERT INTO favorites VALUES (?,?,?)")
      .bind("owner", favorite, at)
      .run();
    await env.DB.prepare("INSERT INTO workshop_selection VALUES (?,?,0,?)")
      .bind("owner", selected, at)
      .run();
    await env.DB.prepare("INSERT INTO research_packages VALUES (?,?,?,?)")
      .bind("package", "owner", "{}", at)
      .run();
    await env.DB.prepare("INSERT INTO research_package_items VALUES (?,?)")
      .bind("package", packed)
      .run();
    await env.DB.prepare(
      "INSERT INTO editorial_decisions(id,content_id,decision,reason,created_at) VALUES ('audit',?,'approved','Synthetic audit',?)",
    )
      .bind(plain, at)
      .run();
    await env.DB.prepare("INSERT INTO radar_scheduler(id) VALUES (1)").run();
    assert.equal(
      (
        await radarFeed(
          env.DB,
          { scope: "editorial" },
          prefs,
          defaultPolicy,
          clock - 1,
        )
      ).items.length,
      4,
    );
    const safeResult = await expireRadar(env.DB, clock);
    assert.equal(safeResult.purged, 0);
    const preserved = await env.DB.prepare(
      "SELECT title,purged_at FROM contents WHERE id=?",
    )
      .bind(plain)
      .first<any>();
    assert.equal(preserved.purged_at, null);
    assert.notEqual(preserved.title, "Referência expirada");
    const result = await expireRadar(env.DB, clock, true);
    assert.equal(safeResult.expired, 3);
    assert.equal(result.purged, 1);
    const state = await env.DB.prepare(
      "SELECT id,expired_at,purged_at,title FROM contents ORDER BY id",
    ).all<any>();
    assert.equal(state.results.find((r) => r.id === favorite).expired_at, null);
    assert.equal(
      state.results.find((r) => r.id === plain).title,
      "Referência expirada",
    );
    for (const id of [selected, packed]) {
      const row = state.results.find((r) => r.id === id);
      assert.equal(row.purged_at, null);
      assert.notEqual(row.title, "Referência expirada");
    }
    assert.equal(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM editorial_decisions WHERE id='audit'",
      ).first("n"),
      1,
    );
    assert.deepEqual(
      (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
    assert.deepEqual(
      (
        await radarFeed(
          env.DB,
          { scope: "editorial" },
          prefs,
          defaultPolicy,
          clock,
        )
      ).items.map((i) => i.content.id),
      [favorite],
    );
  }));
test("Expired RSS URLs stay deduplicated after cleanup and a later discovery", async () =>
  isolated(async (env, s) => {
    const oldClock = clock - RETENTION_MS,
      old = new Date(oldClock).toISOString();
    const body = xml(old, ["dedup"]);
    await ingestSource(env, s.id, async () => new Response(body), oldClock);
    await env.DB.prepare("INSERT INTO radar_scheduler(id) VALUES (1)").run();
    await expireRadar(env.DB, clock, true);
    const before = await env.DB.prepare(
      "SELECT id,first_seen_at FROM contents",
    ).first<any>();
    const run = await ingestSource(
      env,
      s.id,
      async () => new Response(body),
      clock,
    );
    assert.equal(run.received, 1);
    assert.equal(run.queuedRemaining, 0);
    assert.equal(
      await env.DB.prepare(
        "SELECT new_references FROM ingestion_runs WHERE id=?",
      )
        .bind(run.id)
        .first("new_references"),
      0,
    );
    assert.deepEqual(
      await env.DB.prepare("SELECT id,first_seen_at FROM contents").first(),
      before,
    );
  }));

test("Retention keeps eight days, expires nine complete days and preserves citations and processing synopses", async () =>
  isolated(async (env, s) => {
    const recent = await create(
      env,
      s,
      {},
      new Date(clock - 8 * 86400000).toISOString(),
    );
    const boundary = await create(
      env,
      s,
      {},
      new Date(clock - RETENTION_MS).toISOString(),
    );
    const saved = await create(
      env,
      s,
      {},
      new Date(clock - 12 * 86400000).toISOString(),
    );
    const cited = await create(
      env,
      s,
      {},
      new Date(clock - RETENTION_MS).toISOString(),
    );
    const processing = await create(
      env,
      s,
      {},
      new Date(clock - RETENTION_MS).toISOString(),
    );
    await env.DB.prepare("INSERT INTO favorites VALUES ('owner',?,?)")
      .bind(saved, at)
      .run();
    await env.DB.prepare(
      "INSERT INTO editorial_outputs(id,user_id,kind,status,title,created_at) VALUES ('retention-output','owner','article','published','Synthetic citation',?)",
    )
      .bind(at)
      .run();
    await env.DB.prepare(
      "INSERT INTO output_sources VALUES ('retention-output',?)",
    )
      .bind(cited)
      .run();
    await env.DB.prepare(
      "UPDATE content_synopses SET status='processing' WHERE content_id=?",
    )
      .bind(processing)
      .run();
    await env.DB.prepare("INSERT INTO radar_scheduler(id) VALUES (1)").run();
    const result = await expireRadar(env.DB, clock, true);
    assert.deepEqual(result, { expired: 3, purged: 1 });
    const state = async (id: string) =>
      env.DB.prepare(
        "SELECT expired_at,purged_at,title FROM contents WHERE id=?",
      )
        .bind(id)
        .first<any>();
    assert.equal((await state(recent)).expired_at, null);
    assert.equal((await state(boundary)).purged_at, at);
    assert.equal((await state(saved)).expired_at, null);
    for (const id of [cited, processing]) {
      assert.equal((await state(id)).expired_at, at);
      assert.equal((await state(id)).purged_at, null);
    }
    assert.deepEqual(
      new Set(
        (
          await radarFeed(
            env.DB,
            { scope: "editorial" },
            prefs,
            defaultPolicy,
            clock,
          )
        ).items.map((i) => i.content.id),
      ),
      new Set([recent, saved]),
    );
    const response = await app.fetch(
      new Request(`http://localhost/api/contents/${saved}/favorite`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${env.DEV_TOKEN}` },
      }),
      env,
    );
    assert.equal(response.status, 204);
    assert.equal((await state(saved)).purged_at, null);
    assert.notEqual((await state(saved)).title, "Referência expirada");
    await expireRadar(env.DB, clock + 1, true);
    assert.notEqual((await state(saved)).purged_at, null);
    assert.deepEqual(
      (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
  }));

test("Retention transaction rolls back on partial failure and retries in bounded batches", async () =>
  isolated(async (env, s) => {
    const old = new Date(clock - RETENTION_MS).toISOString();
    for (let i = 0; i < 56; i++) await create(env, s, {}, old);
    await env.DB.prepare("INSERT INTO radar_scheduler(id) VALUES (1)").run();
    await env.DB.prepare(
      "CREATE TRIGGER retention_fault BEFORE UPDATE ON content_synopses BEGIN SELECT RAISE(ABORT,'synthetic retention fault'); END",
    ).run();
    await assert.rejects(
      expireRadar(env.DB, clock, true),
      /synthetic retention fault/,
    );
    assert.equal(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM contents WHERE expired_at IS NOT NULL OR purged_at IS NOT NULL",
      ).first("n"),
      0,
    );
    assert.equal(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM contents WHERE title='Referência expirada'",
      ).first("n"),
      0,
    );
    assert.equal(
      await env.DB.prepare(
        "SELECT last_retention_at FROM radar_scheduler WHERE id=1",
      ).first("last_retention_at"),
      null,
    );
    await env.DB.prepare("DROP TRIGGER retention_fault").run();
    const passes = [];
    for (let i = 0; i < 3; i++)
      passes.push(await expireRadar(env.DB, clock + i, true));
    assert.deepEqual(passes, [
      { expired: 50, purged: 25 },
      { expired: 6, purged: 25 },
      { expired: 0, purged: 6 },
    ]);
    assert.deepEqual(
      (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
      [],
    );
    assert.equal(
      await env.DB.prepare("PRAGMA quick_check").first("quick_check"),
      "ok",
    );
  }));
test("RSS failures, recovery and actual discoveries have separate health metrics", async () =>
  isolated(async (env, s) => {
    const failed = await ingestSource(
      env,
      s.id,
      async () => new Response(null, { status: 403 }),
      clock,
    );
    assert.equal(failed.status, "failed");
    const recovered = await ingestSource(
      env,
      s.id,
      async () => new Response(xml(at, ["health"])),
      clock + 900001,
    );
    assert.equal(recovered.received, 1);
    const status = await radarStatus(env, null, clock + 900001),
      source = status.sources.find((v) => v.id === s.id)!;
    assert.equal(source.consecutiveFailures, 0);
    assert.equal(source.discoveredThisWeek, 1);
    assert.equal(source.lastNewReferenceAt, source.lastSuccessAt);
    assert.equal(status.health?.visibleEditorial, 1);
    const stale = await radarStatus(env, null, clock + 49 * 3600000);
    assert.ok(
      stale.sources
        .find((v) => v.id === s.id)
        ?.alerts?.includes("stale_over_48h"),
    );
  }));
test("RSS bursts persist the full queue before processing it in later invocations", async () =>
  isolated(async (env, s) => {
    const ids = Array.from({ length: 8 }, (_, index) => `burst-${index}`);
    const discovery = await ingestSource(
      env,
      s.id,
      async () => new Response(xml(at, ids)),
      clock,
    );
    assert.equal(discovery.status, "partial");
    assert.equal(discovery.received, 8);
    assert.equal(discovery.accepted, 0);
    assert.equal(discovery.queuedRemaining, 8);
    const next = await ingestSource(
      env,
      s.id,
      async () => {
        throw Error("queue processing must not fetch again");
      },
      clock + 5000,
    );
    assert.equal(next.received, 0);
    assert.equal(next.accepted, 2);
    assert.equal(next.queuedRemaining, 6);
  }));
test("Actual scheduled discovery with retention enabled stays inside 50 D1 statements", async () =>
  isolated(async (env, s) => {
    await env.DB.prepare(
      "INSERT INTO radar_scheduler(id,last_retention_at) VALUES (1,?)",
    )
      .bind(at)
      .run();
    let queries = 0;
    const wrap = (v: any): any =>
      new Proxy(v, {
        get(t, k) {
          if (k === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
          if (["run", "first", "all", "raw"].includes(String(k)))
            return (...a: unknown[]) => {
              queries++;
              return t[k](...a);
            };
          return typeof t[k] === "function" ? t[k].bind(t) : t[k];
        },
      });
    const db = new Proxy(env.DB, {
      get(t, k) {
        if (k === "prepare") return (sql: string) => wrap(t.prepare(sql));
        if (k === "batch")
          return (ss: D1PreparedStatement[]) => {
            queries += ss.length;
            return t.batch(ss);
          };
        const v = (t as any)[k];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    await scheduledIngest(
      { ...env, DB: db, RADAR_RETENTION_ENABLED: "true" },
      async () => new Response(xml(at)),
      clock,
    );
    assert.ok(queries <= 50, `scheduled discovery: ${queries} D1 statements`);
    assert.equal(
      await env.DB.prepare("SELECT COUNT(*) n FROM contents").first("n"),
      2,
    );
    queries = 0;
    await scheduledIngest(
      { ...env, DB: db, RADAR_RETENTION_ENABLED: "true" },
      undefined,
      clock + 1800001,
    );
    assert.ok(queries <= 50, `retention: ${queries}`);
    assert.equal(
      await env.DB.prepare(
        "SELECT last_status FROM radar_scheduler WHERE id=1",
      ).first("last_status"),
      "retention",
    );
  }));
test("Radar API remains private and rejects unsupported filters", async () =>
  isolated(async (env) => {
    assert.equal(
      (await app.request("http://localhost/api/feed", {}, env)).status,
      401,
    );
    const r = await app.request(
      "http://localhost/api/feed?country=invalid",
      { headers: { Authorization: "Bearer " + env.DEV_TOKEN } },
      env,
    );
    assert.equal(r.status, 400);
  }));

test("RSS ingestion generates and stores a summary before a new card is visible", async () =>
  isolated(async (env, s) => {
    await env.DB.prepare(
      "UPDATE sources SET config_json=json_set(config_json,'$.feedTextSummaryAllowed',1) WHERE id=?",
    )
      .bind(s.id)
      .run();
    const body =
      "The graphic design identity connects print and digital applications through modular typography.";
    const feed = xml(at, ["summary-ingestion"]).replace(
      "</item>",
      `<content:encoded><![CDATA[<p>${body}</p>]]></content:encoded></item>`,
    );
    const run = await ingestSource(
      env,
      s.id,
      async () => new Response(feed),
      clock,
    );
    assert.equal(run.accepted, 1);
    const page = await radarFeed(
      env.DB,
      { scope: "editorial" },
      prefs,
      defaultPolicy,
      clock,
    );
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].content.description, body);
    const stored = await env.DB.prepare(
      "SELECT json_extract(metadata_json,'$.description') summary FROM contents",
    ).first<{ summary: string }>();
    assert.equal(stored?.summary, body);
    assert.equal(
      await env.DB.prepare("SELECT COUNT(*) n FROM synopsis_inferences").first(
        "n",
      ),
      0,
    );
  }));

test("Summary generation releases an existing card without renewing dates or losing favorites", async () =>
  isolated(async (env, s) => {
    const { generateFeedSummary } = await import("../src/feed-summary");
    const { refreshFeedSummaries } =
      await import("../src/feed-summary-refresh");
    const key = await create(env, s, { description: null });
    await env.DB.prepare("INSERT INTO favorites VALUES ('owner',?,?)")
      .bind(key, at)
      .run();
    const read = () =>
      env.DB.prepare("SELECT * FROM contents WHERE id=?")
        .bind(key)
        .first<any>();
    const before = await read();
    const page = () =>
      radarFeed(env.DB, { scope: "editorial" }, prefs, defaultPolicy, clock);
    assert.equal((await page()).items.length, 0);
    const text = generateFeedSummary(
      null,
      "<p>The new graphic design system uses modular typography to connect print and digital applications.</p>",
      before.title,
    )!;
    const item = {
      ...fixtureCandidate,
      url: before.canonical_url,
      description: text,
    };
    await refreshFeedSummaries(env.DB, s, [item]).run();
    const result = await page();
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].content.description, text);
    assert.equal(result.items[0].content.state.favorite, true);
    const after = await read();
    for (const field of [
      "id",
      "first_seen_at",
      "collected_at",
      "published_at",
      "approved_at",
      "expired_at",
      "quality_score",
    ])
      assert.equal(after[field], before[field]);
    assert.equal(
      (await refreshFeedSummaries(env.DB, s, [item]).run()).meta.changes,
      0,
    );
    await env.DB.prepare(
      "UPDATE sources SET config_json=json_set(config_json,'$.summaryAllowed',0) WHERE id=?",
    )
      .bind(s.id)
      .run();
    assert.equal((await page()).items.length, 0);
    assert.equal(
      (
        await refreshFeedSummaries(env.DB, s, [
          { ...item, description: "Blocked changed description" },
        ]).run()
      ).meta.changes,
      0,
    );
  }));
