import type {
  Content,
  FeedItem,
  Policy,
  Preferences,
  RadarFeedPage,
  RadarFeedQuery,
} from "../packages/contracts";
import { radarFeedQuerySchema, radarTriage } from "../packages/contracts/radar";
import { contents } from "./content";
import { rows, first, stmt, OWNER, id } from "./db";
import { ApiFault } from "./errors";
import { balanceLanguages, dailyEligible, rank, rankRadar } from "./ranking";
import { editorialWeek, RETENTION_MS, EDITORIAL_TIMEZONE } from "./schedule";

export const dailyWindowSql = `(c.kind='paper' OR (c.published_at>=? AND c.published_at<? AND c.published_at<=?
 AND (EXISTS(SELECT 1 FROM favorites f WHERE f.content_id=c.id) OR (c.expired_at IS NULL AND COALESCE(c.first_seen_at,c.collected_at)>?))))`;
export function dailyWindowArgs(clock = Date.now()) {
  const w = editorialWeek(clock);
  return [
    w.start,
    w.end,
    new Date(clock).toISOString(),
    new Date(clock - RETENTION_MS).toISOString(),
  ];
}

export async function radarFeed(
  db: D1Database,
  raw: Record<string, string>,
  preferences: Preferences,
  policy: Policy,
  clock = Date.now(),
  affinity: string[] = [],
): Promise<RadarFeedPage> {
  const q = radarFeedQuerySchema.parse(raw),
    week = editorialWeek(clock),
    at = new Date(clock).toISOString();
  const { cursor, limit, ...filters } = q;
  const match = (c: Content) =>
    c.editorialStatus === "approved" &&
    c.quality.score >= policy.minimumQuality &&
    (c.kind === "paper" || dailyEligible(c, clock, week)) &&
    (q.scope !== "editorial" || c.kind !== "paper") &&
    (q.scope !== "scientific" || c.kind === "paper") &&
    (!q.sourceId || c.sourceId === q.sourceId) &&
    (!q.country || c.radar?.country === q.country) &&
    (!q.category || c.radar?.category === q.category) &&
    (!q.language || c.language === q.language) &&
    (!preferences.languages.length ||
      (!!c.language && preferences.languages.includes(c.language))) &&
    (!q.after ||
      (!!c.publishedAt &&
        Date.parse(c.publishedAt) >=
          Date.parse(q.after + "T00:00:00-03:00"))) &&
    (!q.before ||
      (!!c.publishedAt &&
        Date.parse(c.publishedAt) <
          Date.parse(q.before + "T00:00:00-03:00") + 86400000)) &&
    (q.triage
      ? radarTriage(c) === q.triage
      : !c.state.dismissed || c.state.favorite);
  let snapshotId: string,
    expiresAt: string,
    ranking: { id: string; explanation: FeedItem["explanation"] }[],
    offset = 0;
  if (cursor) {
    const parts = cursor.split(":");
    if (
      parts.length !== 2 ||
      !/^[0-9a-f-]{36}$/i.test(parts[0]) ||
      !/^\d{1,3}$/.test(parts[1]) ||
      Number(parts[1]) > 500
    )
      throw new ApiFault(400, "invalid_cursor", "Cursor inválido.");
    snapshotId = parts[0];
    offset = Number(parts[1]);
    const snapshot = await first<{ body_json: string; expires_at: string }>(
      db,
      "SELECT body_json,expires_at FROM feed_snapshots WHERE id=? AND user_id=?",
      snapshotId,
      OWNER,
    );
    if (!snapshot || snapshot.expires_at <= at)
      throw new ApiFault(
        410,
        "cursor_expired",
        "Recarregue o feed; a sequência expirou.",
      );
    const saved = JSON.parse(snapshot.body_json);
    if (
      JSON.stringify(saved.filters) !== JSON.stringify(filters) ||
      saved.weekStart !== week.start
    )
      throw new ApiFault(
        410,
        "cursor_expired",
        "Filtros ou semana alterados. Recarregue o feed.",
      );
    ranking = saved.ranking;
    expiresAt = snapshot.expires_at;
  } else {
    const where = [
        "c.editorial_status='approved'",
        "s.status='approved'",
        "json_extract(s.config_json,'$.metadataAllowed')=1",
        "c.quality_score>=?",
        dailyWindowSql,
      ],
      args: unknown[] = [policy.minimumQuality, ...dailyWindowArgs(clock)];
    if (q.scope === "editorial") where.push("c.kind<>'paper'");
    if (q.scope === "scientific") where.push("c.kind='paper'");
    for (const [value, column] of [
      [q.sourceId, "c.source_id"],
      [q.language, "c.language"],
      [q.country, "json_extract(s.config_json,'$.country')"],
    ])
      if (value) {
        where.push(`${column}=?`);
        args.push(value);
      }
    if (q.after) {
      where.push("c.published_at>=?");
      args.push(new Date(q.after + "T00:00:00-03:00").toISOString());
    }
    if (q.before) {
      where.push("c.published_at<?");
      args.push(
        new Date(
          Date.parse(q.before + "T00:00:00-03:00") + 86400000,
        ).toISOString(),
      );
    }
    const ids = await rows<{ id: string }>(
      db,
      `SELECT c.id FROM contents c JOIN sources s ON s.id=c.source_id WHERE ${where.join(" AND ")} ORDER BY c.published_at DESC,c.id LIMIT 500`,
      ...args,
    );
    const candidates = (
      await contents(
        db,
        ids.map((r) => r.id),
      )
    ).filter(match);
    // Triage's discarded view deliberately includes dismissed records, preserving their returned state.
    const forRanking = candidates.map((c) =>
      q.triage === "descartado" || c.state.favorite
        ? { ...c, state: { ...c.state, dismissed: false } }
        : c,
    );
    let ranked = [
      ...rankRadar(forRanking, preferences, policy, clock, affinity, q.sort),
      ...rank(
        forRanking.filter((c) => c.kind === "paper"),
        preferences,
        policy,
        clock,
        affinity,
      ),
    ];
    if (q.sort === "novidade")
      ranked.sort(
        (a, b) =>
          (Date.parse(b.content.publishedAt ?? "") || 0) -
            (Date.parse(a.content.publishedAt ?? "") || 0) ||
          a.content.id.localeCompare(b.content.id),
      );
    else
      ranked = balanceLanguages(
        ranked,
        !!q.language || preferences.languages.length === 1,
      );
    ranking = ranked.map((i) => ({
      id: i.content.id,
      explanation: i.explanation,
    }));
    snapshotId = id();
    expiresAt = new Date(clock + 1800000).toISOString();
    await stmt(
      db,
      "INSERT INTO feed_snapshots VALUES (?,?,?,?)",
      snapshotId,
      OWNER,
      JSON.stringify({ ranking, filters, weekStart: week.start }),
      expiresAt,
    ).run();
  }
  const remaining = ranking.slice(offset);
  const sources = new Set(
    (
      await rows<{ id: string }>(
        db,
        "SELECT id FROM sources WHERE status='approved' AND json_extract(config_json,'$.metadataAllowed')=1",
      )
    ).map((s) => s.id),
  );
  const items: FeedItem[] = [];
  let consumed = 0;
  while (consumed < remaining.length && items.length < limit) {
    const batch = remaining.slice(consumed, consumed + limit - items.length);
    const loaded = await contents(
      db,
      batch.map((item) => item.id),
    );
    const byId = new Map(
      loaded
        .filter((c) => sources.has(c.sourceId) && match(c))
        .map((c) => [c.id, c]),
    );
    for (const entry of batch) {
      consumed++;
      const content = byId.get(entry.id);
      if (content) items.push({ content, explanation: entry.explanation });
    }
  }
  return {
    items,
    nextCursor:
      offset + consumed < ranking.length
        ? `${snapshotId}:${offset + consumed}`
        : null,
    snapshotId,
    expiresAt,
    candidateLimit: 500,
    algorithmVersion: "radar-2",
    timezone: EDITORIAL_TIMEZONE,
    week,
    filters,
  };
}
