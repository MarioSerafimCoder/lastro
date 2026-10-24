import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import {
  sourceInputSchema,
  sourceDecisionSchema,
  preferencesSchema,
  interactionSchema,
  selectionSchema,
  researchInputSchema,
  reviewSchema,
  candidateSchema,
  policySchema,
  annotationSchema,
  kindSchema,
  knowledgeSchema,
  type Preferences,
  type FeedItem,
  type FeedPage,
  type Source,
  type ResearchPackage,
} from "../packages/contracts/index";
import type { Env } from "./env";
import { ApiFault, must } from "./errors";
import {
  authenticate,
  passwordMode,
  verifyPassword,
  issueSession,
  clearSession,
} from "./auth";
import {
  first,
  rows,
  stmt,
  id,
  now,
  policy,
  OWNER,
  sourceView,
  type SourceRow,
} from "./db";
import { content, contents, eligible } from "./content";
import {
  processSynopsis,
  scheduledSynopses,
  enqueueSynopses,
  synopsisOverview,
  synopsisGate,
  evidenceSchema,
  synopsisReviewSchema,
  validateSynopsis,
  setSynopsisEvidence,
} from "./synopses";
import { validateFetchUrl } from "./connectors";
import {
  ingestSource,
  scheduledIngest,
  duplicate,
  saveContent,
} from "./ingestion";
import { balanceLanguages, rank } from "./ranking";
import { radarStatus } from "./radar";
import { createPackage, generatePrompt } from "./research";
import { normalizeCandidate, folded } from "./normalize";
import { evaluate, prefilter, matchedTopics } from "./quality";

export const app = new Hono<{
  Bindings: Env;
  Variables: { requestId: string };
}>();
app.use("*", async (c, next) => {
  c.set("requestId", id());
  await next();
  c.header("X-Request-Id", c.get("requestId"));
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "no-store");
});
app.get("/health", (c) =>
  c.json({ status: "ok", service: "lastro-api", version: "0.1.0" }),
);
app.get("/api/auth/session", async (c) => {
  try {
    await authenticate(c.req.raw, c.env);
    return c.json({ authenticated: true });
  } catch {
    return c.json({ authenticated: false });
  }
});
app.post("/api/auth/login", async (c) => {
  if (!passwordMode(c.env))
    throw new ApiFault(
      503,
      "auth_not_configured",
      "Login por senha não configurado.",
    );
  if (c.req.header("Origin") !== new URL(c.req.url).origin)
    throw new ApiFault(403, "origin_forbidden", "Origem não autorizada.");
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(ip),
  );
  const key = `login:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}:${Math.floor(Date.now() / 900000)}`;
  const quota = await first<{ count: number }>(
    c.env.DB,
    "INSERT INTO request_budgets VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    key,
    Math.floor(Date.now() / 900000 + 2) * 900,
  );
  if (quota!.count > 5) {
    c.header("Retry-After", "900");
    throw new ApiFault(
      429,
      "rate_limited",
      "Aguarde 15 minutos para tentar novamente.",
    );
  }
  const input = await json(
    c,
    z.object({ password: z.string().min(1).max(256) }),
  );
  if (!(await verifyPassword(input.password, c.env)))
    throw new ApiFault(401, "unauthorized", "Senha incorreta.");
  c.header("Set-Cookie", await issueSession(c.env));
  return c.json({ authenticated: true });
});
app.post("/api/auth/logout", (c) => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin)
    throw new ApiFault(403, "origin_forbidden", "Origem não autorizada.");
  c.header("Set-Cookie", clearSession());
  return c.json({ authenticated: false });
});
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) return next();
  const origin = c.req.header("Origin"),
    sameOrigin = new URL(c.req.url).origin;
  if (origin && origin !== c.env.ALLOWED_ORIGIN && origin !== sameOrigin)
    throw new ApiFault(403, "origin_forbidden", "Origem não autorizada.");
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
  }
  if (c.req.method === "OPTIONS") {
    c.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
    c.header("Access-Control-Allow-Headers", "Authorization,Content-Type");
    return c.body(null, 204);
  }
  await authenticate(c.req.raw, c.env);
  const bucket = Math.floor(Date.now() / 60000),
    key = `owner:${bucket}`;
  const quota = await first<{ count: number }>(
    c.env.DB,
    "INSERT INTO request_budgets VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    key,
    (bucket + 2) * 60,
  );
  if (quota!.count > 120) {
    c.header("Retry-After", "60");
    throw new ApiFault(
      429,
      "rate_limited",
      "Limite de 120 requisições por minuto atingido.",
    );
  }
  await next();
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 65536,
    onError: () => {
      throw new ApiFault(413, "payload_too_large", "Corpo limitado a 64 KiB.");
    },
  }),
);
async function json<T>(c: any, schema: z.ZodType<T>): Promise<T> {
  if (
    !c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")
  )
    throw new ApiFault(415, "unsupported_media_type", "Use application/json.");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiFault(400, "invalid_json", "JSON inválido.");
  }
  return schema.parse(body);
}
const uuid = (value: string) => z.string().uuid().parse(value);
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
async function prefs(db: D1Database): Promise<Preferences> {
  return JSON.parse(
    must(
      await first<{ preferences_json: string }>(
        db,
        "SELECT preferences_json FROM users WHERE id=?",
        OWNER,
      ),
    ).preferences_json,
  );
}

app.get("/api/preferences", async (c) => c.json(await prefs(c.env.DB)));
app.get("/api/radar/status", async (c) => {
  const { since } = z
    .object({ since: z.string().datetime().optional() })
    .parse(c.req.query());
  return c.json(await radarStatus(c.env, since ?? null));
});
app.put("/api/preferences", async (c) => {
  const input = await json(c, preferencesSchema);
  await stmt(
    c.env.DB,
    "UPDATE users SET preferences_json=? WHERE id=?",
    JSON.stringify(input),
    OWNER,
  ).run();
  return c.json(input);
});
app.get("/api/feed", async (c) => {
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().max(100).optional(),
    })
    .parse(c.req.query());
  const p = await policy(c.env.DB);
  const synopsisFilter =
    c.env.SYNOPSIS_REQUIRED === "true" ? synopsisGate : "1=1";
  let snapshotId: string,
    offset = 0,
    expiresAt: string,
    ranking: { id: string; explanation: FeedItem["explanation"] }[],
    algorithmVersion: string;
  if (query.cursor) {
    const parts = query.cursor.split(":");
    snapshotId = uuid(parts[0]);
    offset = z.coerce.number().int().min(0).max(500).parse(parts[1]);
    if (parts.length !== 2)
      throw new ApiFault(400, "invalid_cursor", "Cursor inválido.");
    const snapshot = await first<{ body_json: string; expires_at: string }>(
      c.env.DB,
      "SELECT * FROM feed_snapshots WHERE id=? AND user_id=?",
      snapshotId,
      OWNER,
    );
    if (!snapshot || snapshot.expires_at < now())
      throw new ApiFault(
        410,
        "cursor_expired",
        "Recarregue o feed; a sequência expirou.",
      );
    ({ ranking, algorithmVersion } = JSON.parse(snapshot.body_json));
    expiresAt = snapshot.expires_at;
  } else {
    const preferences = await prefs(c.env.DB);
    const ids =
      preferences.languages.length === 1
        ? await rows<{ id: string }>(
            c.env.DB,
            `SELECT c.id FROM contents c JOIN sources s ON s.id=c.source_id WHERE ${synopsisFilter} AND c.editorial_status='approved' AND s.status='approved' AND c.quality_score>=? ORDER BY c.collected_at DESC,c.id LIMIT 500`,
            p.minimumQuality,
          )
        : [
            ...(await rows<{ id: string }>(
              c.env.DB,
              `SELECT c.id FROM contents c JOIN sources s ON s.id=c.source_id WHERE ${synopsisFilter} AND c.editorial_status='approved' AND s.status='approved' AND c.language='pt' AND c.quality_score>=? ORDER BY c.collected_at DESC,c.id LIMIT 250`,
              p.minimumQuality,
            )),
            ...(await rows<{ id: string }>(
              c.env.DB,
              `SELECT c.id FROM contents c JOIN sources s ON s.id=c.source_id WHERE ${synopsisFilter} AND c.editorial_status='approved' AND s.status='approved' AND c.language IS NOT NULL AND c.language<>'pt' AND c.quality_score>=? ORDER BY c.collected_at DESC,c.id LIMIT 250`,
              p.minimumQuality,
            )),
          ];
    const affinity = await rows<{ name: string }>(
      c.env.DB,
      `SELECT DISTINCT t.name FROM taxonomies t JOIN content_taxonomies ct ON ct.taxonomy_id=t.id WHERE t.kind='topic' AND (ct.content_id IN (SELECT content_id FROM favorites WHERE user_id=?) OR ct.content_id IN (SELECT content_id FROM output_sources))`,
      OWNER,
    );
    ranking = balanceLanguages(
      rank(
        await contents(
          c.env.DB,
          ids.map((i) => i.id),
        ),
        preferences,
        p,
        Date.now(),
        affinity.map((a) => a.name),
      ),
      preferences.languages.length === 1,
    ).map((i) => ({ id: i.content.id, explanation: i.explanation }));
    snapshotId = id();
    expiresAt = new Date(Date.now() + 1800000).toISOString();
    algorithmVersion = p.version;
    await stmt(
      c.env.DB,
      "INSERT INTO feed_snapshots VALUES (?,?,?,?)",
      snapshotId,
      OWNER,
      JSON.stringify({ ranking, algorithmVersion }),
      expiresAt,
    ).run();
  }
  const remaining = ranking.slice(offset),
    loaded = await contents(
      c.env.DB,
      remaining.map((i) => i.id),
    );
  const currentPrefs = await prefs(c.env.DB);
  const approvedSources = new Set(
    (
      await rows<{ id: string }>(
        c.env.DB,
        "SELECT id FROM sources WHERE status='approved'",
      )
    ).map((s) => s.id),
  );
  const byId = new Map(
    loaded
      .filter(
        (i) =>
          i.editorialStatus === "approved" &&
          (c.env.SYNOPSIS_REQUIRED !== "true" || !!i.synopsis?.text) &&
          approvedSources.has(i.sourceId) &&
          i.quality.score >= p.minimumQuality &&
          !i.state.dismissed &&
          (!currentPrefs.languages.length ||
            (!!i.language && currentPrefs.languages.includes(i.language))),
      )
      .map((i) => [i.id, i]),
  );
  const items: FeedItem[] = [];
  let consumed = 0;
  if (currentPrefs.languages.length !== 1 && query.limit % 2 === 0) {
    for (let index = 0; index + 1 < remaining.length; index += 2) {
      const first = remaining[index],
        second = remaining[index + 1];
      consumed += 2;
      const pt = byId.get(first.id),
        other = byId.get(second.id);
      if (pt?.language === "pt" && other?.language && other.language !== "pt") {
        items.push({ content: pt, explanation: first.explanation });
        items.push({ content: other, explanation: second.explanation });
      }
      if (items.length === query.limit) break;
    }
  } else {
    for (const r of remaining) {
      consumed++;
      const value = byId.get(r.id);
      if (value) items.push({ content: value, explanation: r.explanation });
      if (items.length === query.limit) break;
    }
  }
  const result: FeedPage = {
    items,
    nextCursor:
      offset + consumed < ranking.length
        ? `${snapshotId}:${offset + consumed}`
        : null,
    snapshotId,
    expiresAt,
    candidateLimit: 500,
    algorithmVersion,
  };
  return c.json(result);
});
const searchSchema = pageQuery.extend({
  q: z.string().max(200).optional(),
  topic: z.string().max(100).optional(),
  sourceId: z.string().uuid().optional(),
  kind: kindSchema.optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
  after: z.iso.date().optional(),
  before: z.iso.date().optional(),
  classification: knowledgeSchema.optional(),
});
async function search(
  db: D1Database,
  raw: Record<string, string>,
  favorites = false,
  synopsisRequired = false,
) {
  const q = searchSchema.parse(raw),
    where: string[] = [],
    args: unknown[] = [];
  if (favorites) {
    where.push("c.id IN (SELECT content_id FROM favorites WHERE user_id=?)");
    args.push(OWNER);
  } else where.push("c.editorial_status='approved'", "s.status='approved'");
  if (!favorites && synopsisRequired) where.push(synopsisGate);
  if (q.q) {
    where.push(
      "(instr(lower(c.title),lower(?))>0 OR instr(lower(COALESCE(json_extract(c.metadata_json,'$.description'),'')),lower(?))>0 OR EXISTS(SELECT 1 FROM content_synopses sy WHERE sy.content_id=c.id AND sy.status='validated' AND sy.metadata_json=c.metadata_json AND instr(lower(sy.text),lower(?))>0))",
    );
    args.push(q.q, q.q, q.q);
  }
  for (const [value, column] of [
    [q.sourceId, "c.source_id"],
    [q.kind, "c.kind"],
    [q.language, "c.language"],
  ])
    if (value) {
      where.push(`${column}=?`);
      args.push(value);
    }
  if (q.after) {
    where.push("c.published_at>=?");
    args.push(q.after + "T00:00:00.000Z");
  }
  if (q.before) {
    where.push("c.published_at<=?");
    args.push(q.before + "T23:59:59.999Z");
  }
  if (q.topic) {
    where.push(
      "c.id IN (SELECT ct.content_id FROM content_taxonomies ct JOIN taxonomies t ON t.id=ct.taxonomy_id WHERE t.name=?)",
    );
    args.push(folded(q.topic));
  }
  if (q.classification) {
    where.push(
      "c.id IN (SELECT content_id FROM knowledge_annotations WHERE classification=?)",
    );
    args.push(q.classification);
  }
  const data = await rows<{ id: string }>(
    db,
    `SELECT c.id FROM contents c JOIN sources s ON s.id=c.source_id WHERE ${where.join(" AND ")} ORDER BY c.collected_at DESC,c.id LIMIT ? OFFSET ?`,
    ...args,
    q.limit + 1,
    q.offset,
  );
  return {
    items: await contents(
      db,
      data.slice(0, q.limit).map((d) => d.id),
    ),
    nextCursor: data.length > q.limit ? String(q.offset + q.limit) : null,
  };
}
app.get("/api/search", async (c) =>
  c.json(
    await search(
      c.env.DB,
      c.req.query(),
      false,
      c.env.SYNOPSIS_REQUIRED === "true",
    ),
  ),
);
app.get("/api/favorites", async (c) =>
  c.json(await search(c.env.DB, c.req.query(), true)),
);
app.get("/api/contents/:id", async (c) =>
  c.json(await content(c.env.DB, uuid(c.req.param("id")))),
);
app.get("/api/contents/:id/relevance", async (c) => {
  const item = await content(c.env.DB, uuid(c.req.param("id")));
  await eligible(c.env.DB, item.id);
  const p = await policy(c.env.DB);
  const result = rank([item], await prefs(c.env.DB), p)[0];
  return c.json({
    eligible: !!result,
    explanation: result?.explanation ?? null,
    scope: "individual_preview",
    note: "A diversidade e a afinidade histórica da sequência completa estão na resposta do feed.",
  });
});
app.put("/api/contents/:id/favorite", async (c) => {
  const contentId = uuid(c.req.param("id"));
  await eligible(c.env.DB, contentId);
  await stmt(
    c.env.DB,
    "INSERT OR IGNORE INTO favorites VALUES (?,?,?)",
    OWNER,
    contentId,
    now(),
  ).run();
  return c.json(await content(c.env.DB, contentId));
});
app.delete("/api/contents/:id/favorite", async (c) => {
  const contentId = uuid(c.req.param("id"));
  await stmt(
    c.env.DB,
    "DELETE FROM favorites WHERE user_id=? AND content_id=?",
    OWNER,
    contentId,
  ).run();
  return c.body(null, 204);
});
app.post("/api/contents/:id/interactions", async (c) => {
  const contentId = uuid(c.req.param("id"));
  await content(c.env.DB, contentId);
  const input = await json(c, interactionSchema);
  await stmt(
    c.env.DB,
    "INSERT INTO interactions VALUES (?,?,?,?,?) ON CONFLICT(user_id,content_id,type) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at",
    OWNER,
    contentId,
    input.type,
    input.active ? 1 : 0,
    now(),
  ).run();
  return c.json(await content(c.env.DB, contentId));
});
app.put("/api/contents/:id/note", async (c) => {
  const contentId = uuid(c.req.param("id"));
  await content(c.env.DB, contentId);
  const input = await json(
    c,
    z.object({ text: z.string().max(5000) }).strict(),
  );
  await stmt(
    c.env.DB,
    "INSERT INTO notes VALUES (?,?,?,?) ON CONFLICT(user_id,content_id) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at",
    OWNER,
    contentId,
    input.text,
    now(),
  ).run();
  return c.json({ text: input.text });
});
app.get("/api/workshop/selection", async (c) => {
  const selected = await rows<{ content_id: string }>(
    c.env.DB,
    "SELECT content_id FROM workshop_selection WHERE user_id=? ORDER BY position,content_id",
    OWNER,
  );
  return c.json({
    items: await contents(
      c.env.DB,
      selected.map((s) => s.content_id),
    ),
  });
});
app.put("/api/workshop/selection", async (c) => {
  const { contentIds } = await json(c, selectionSchema);
  for (const contentId of contentIds) await eligible(c.env.DB, contentId);
  await c.env.DB.batch([
    stmt(c.env.DB, "DELETE FROM workshop_selection WHERE user_id=?", OWNER),
    ...contentIds.map((v, i) =>
      stmt(
        c.env.DB,
        "INSERT INTO workshop_selection VALUES (?,?,?,?)",
        OWNER,
        v,
        i,
        now(),
      ),
    ),
  ]);
  return c.json({ items: await contents(c.env.DB, contentIds) });
});
app.post("/api/research-packages", async (c) =>
  c.json(
    await createPackage(c.env.DB, await json(c, researchInputSchema)),
    201,
  ),
);
app.get("/api/research-packages/:id", async (c) => {
  const r = must(
    await first<{ body_json: string }>(
      c.env.DB,
      "SELECT body_json FROM research_packages WHERE id=? AND user_id=?",
      uuid(c.req.param("id")),
      OWNER,
    ),
  );
  return c.json(JSON.parse(r.body_json) as ResearchPackage);
});
app.post("/api/research-packages/:id/prompt", async (c) =>
  c.json(await generatePrompt(c.env.DB, uuid(c.req.param("id")))),
);

app.get("/api/collections", async (c) => {
  const q = pageQuery.parse(c.req.query());
  const data = await rows<any>(
    c.env.DB,
    "SELECT id,name,created_at createdAt FROM collections WHERE user_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
    OWNER,
    q.limit + 1,
    q.offset,
  );
  return c.json({
    items: data.slice(0, q.limit),
    nextCursor: data.length > q.limit ? String(q.offset + q.limit) : null,
  });
});
app.post("/api/collections", async (c) => {
  const input = await json(
      c,
      z.object({ name: z.string().trim().min(1).max(100) }).strict(),
    ),
    collectionId = id();
  await stmt(
    c.env.DB,
    "INSERT INTO collections VALUES (?,?,?,?)",
    collectionId,
    OWNER,
    input.name,
    now(),
  ).run();
  return c.json({ id: collectionId, name: input.name }, 201);
});
app.get("/api/collections/:id/items", async (c) => {
  const collectionId = uuid(c.req.param("id"));
  must(
    await first(
      c.env.DB,
      "SELECT id FROM collections WHERE id=? AND user_id=?",
      collectionId,
      OWNER,
    ),
  );
  const q = pageQuery.parse(c.req.query());
  const data = await rows<{ content_id: string }>(
    c.env.DB,
    "SELECT content_id FROM collection_items WHERE collection_id=? ORDER BY content_id LIMIT ? OFFSET ?",
    collectionId,
    q.limit + 1,
    q.offset,
  );
  return c.json({
    items: await contents(
      c.env.DB,
      data.slice(0, q.limit).map((d) => d.content_id),
    ),
    nextCursor: data.length > q.limit ? String(q.offset + q.limit) : null,
  });
});
app.put("/api/collections/:id/items/:contentId", async (c) => {
  const collectionId = uuid(c.req.param("id")),
    contentId = uuid(c.req.param("contentId"));
  must(
    await first(
      c.env.DB,
      "SELECT id FROM collections WHERE id=? AND user_id=?",
      collectionId,
      OWNER,
    ),
  );
  await eligible(c.env.DB, contentId);
  await stmt(
    c.env.DB,
    "INSERT OR IGNORE INTO collection_items VALUES (?,?)",
    collectionId,
    contentId,
  ).run();
  return c.body(null, 204);
});
app.delete("/api/collections/:id/items/:contentId", async (c) => {
  await stmt(
    c.env.DB,
    "DELETE FROM collection_items WHERE collection_id=? AND content_id=?",
    uuid(c.req.param("id")),
    uuid(c.req.param("contentId")),
  ).run();
  return c.body(null, 204);
});

app.get("/api/admin/synopses", async (c) => {
  const q = pageQuery.parse(c.req.query());
  return c.json({
    ...(await synopsisOverview(c.env.DB)),
    required: c.env.SYNOPSIS_REQUIRED === "true",
    enabled: c.env.SYNOPSIS_ENABLED === "true",
    items: await rows(
      c.env.DB,
      "SELECT sy.*,c.title,c.language,c.kind,c.editorial_status,s.name source_name,(SELECT SUM(provider_neurons) FROM synopsis_inferences WHERE content_id=c.id) provider_neurons FROM content_synopses sy JOIN contents c ON c.id=sy.content_id JOIN sources s ON s.id=c.source_id WHERE c.editorial_status='approved' ORDER BY CASE sy.status WHEN 'review' THEN 0 WHEN 'pending' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END,sy.updated_at,sy.content_id LIMIT ? OFFSET ?",
      q.limit,
      q.offset,
    ),
  });
});
app.post("/api/admin/synopses/process", async (c) =>
  c.json(await processSynopsis(c.env)),
);
app.put("/api/admin/synopses/:id/evidence", async (c) => {
  const contentId = uuid(c.req.param("id"));
  await content(c.env.DB, contentId);
  const input = await json(c, evidenceSchema);
  return c.json(await setSynopsisEvidence(c.env.DB, contentId, input));
});
app.post("/api/admin/synopses/:id/validate", async (c) =>
  c.json(
    await validateSynopsis(
      c.env.DB,
      uuid(c.req.param("id")),
      await json(c, synopsisReviewSchema),
    ),
  ),
);
app.post("/api/admin/synopses/:id/reject", async (c) => {
  const input = await json(
    c,
    z.object({ reason: z.string().trim().min(20).max(2000) }).strict(),
  );
  const contentId = uuid(c.req.param("id"));
  const row = must(
    await first<any>(
      c.env.DB,
      "SELECT * FROM content_synopses WHERE content_id=? AND status<>'processing'",
      contentId,
    ),
  );
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      "UPDATE content_synopses SET status='blocked',block_code='editorial',lease_token=NULL,lease_until=NULL,validated_at=NULL,validation_json=NULL,validation_mode=NULL,validation_note=?,updated_at=? WHERE content_id=?",
      input.reason,
      now(),
      contentId,
    ),
    stmt(
      c.env.DB,
      "INSERT INTO synopsis_decisions VALUES (?,?,?,?,?,?,?)",
      id(),
      contentId,
      "rejected",
      input.reason,
      row.text,
      null,
      now(),
    ),
  ]);
  return c.json({ status: "blocked" });
});
app.get("/api/admin/overview", async (c) =>
  c.json({
    ingestEnabled: c.env.INGEST_ENABLED === "true",
    allowedHosts: (c.env.ALLOWED_FETCH_HOSTS ?? "").split(",").filter(Boolean),
    ...(await first<{
      sources: number;
      pending: number;
      approved: number;
      portuguese: number;
      international: number;
      unknownLanguage: number;
    }>(
      c.env.DB,
      "SELECT (SELECT COUNT(*) FROM sources) sources, (SELECT COUNT(*) FROM ingestion_candidates WHERE outcome='pending') pending, (SELECT COUNT(*) FROM contents WHERE editorial_status='approved') approved, (SELECT COUNT(*) FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.editorial_status='approved' AND s.status='approved' AND c.language='pt') portuguese, (SELECT COUNT(*) FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.editorial_status='approved' AND s.status='approved' AND c.language IS NOT NULL AND c.language<>'pt') international, (SELECT COUNT(*) FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.editorial_status='approved' AND s.status='approved' AND c.language IS NULL) unknownLanguage",
    )),
  }),
);
app.get("/api/admin/decisions", async (c) => {
  const q = pageQuery.parse(c.req.query());
  const data = await rows(
    c.env.DB,
    "SELECT id,source_id targetId,'source' scope,status decision,reason,created_at createdAt FROM source_decisions UNION ALL SELECT id,COALESCE(content_id,candidate_id) targetId,'content' scope,decision,reason,created_at createdAt FROM editorial_decisions ORDER BY createdAt DESC,id LIMIT ? OFFSET ?",
    q.limit + 1,
    q.offset,
  );
  return c.json({
    items: data.slice(0, q.limit),
    nextCursor: data.length > q.limit ? String(q.offset + q.limit) : null,
  });
});
app.get("/api/admin/sources", async (c) => {
  const q = pageQuery.parse(c.req.query());
  const data = await rows<SourceRow & { last_run_json: string | null }>(
    c.env.DB,
    "SELECT s.*, (SELECT json_object('id',r.id,'sourceId',r.source_id,'startedAt',r.started_at,'finishedAt',r.finished_at,'status',r.status,'received',r.received,'accepted',r.accepted,'pending',r.pending,'rejected',r.rejected,'duplicates',r.duplicates,'queuedRemaining',r.queued_remaining,'error',r.error) FROM ingestion_runs r WHERE r.source_id=s.id ORDER BY r.started_at DESC,r.id DESC LIMIT 1) last_run_json FROM sources s ORDER BY created_at,id LIMIT ? OFFSET ?",
    q.limit + 1,
    q.offset,
  );
  return c.json({
    items: data.slice(0, q.limit).map((r) => ({
      ...sourceView(r),
      lastRun: r.last_run_json ? JSON.parse(r.last_run_json) : null,
    })),
    nextCursor: data.length > q.limit ? String(q.offset + q.limit) : null,
  });
});
app.post("/api/admin/sources", async (c) => {
  const input = await json(c, sourceInputSchema);
  try {
    validateFetchUrl(input.url, c.env, input.connector);
  } catch {
    throw new ApiFault(
      422,
      "invalid_source_url",
      "URL deve usar HTTPS e um host autorizado, sem credenciais.",
    );
  }
  if (await first(c.env.DB, "SELECT id FROM sources WHERE url=?", input.url))
    throw new ApiFault(409, "source_exists", "Fonte já cadastrada.");
  const sourceId = id();
  await stmt(
    c.env.DB,
    "INSERT INTO sources (id,name,connector,url,config_json,created_at) VALUES (?,?,?,?,?,?)",
    sourceId,
    input.name,
    input.connector,
    input.url,
    JSON.stringify(input),
    now(),
  ).run();
  return c.json(
    sourceView(
      must(
        await first<SourceRow>(
          c.env.DB,
          "SELECT * FROM sources WHERE id=?",
          sourceId,
        ),
      ),
    ),
    201,
  );
});
app.put("/api/admin/sources/:id", async (c) => {
  const sourceId = uuid(c.req.param("id"));
  must(await first(c.env.DB, "SELECT id FROM sources WHERE id=?", sourceId));
  const input = await json(c, sourceInputSchema);
  if (
    await first(
      c.env.DB,
      "SELECT id FROM sources WHERE id=? AND lease_until>?",
      sourceId,
      now(),
    )
  )
    throw new ApiFault(
      409,
      "source_busy",
      "Aguarde a coleta atual antes de alterar a configuração.",
    );
  try {
    validateFetchUrl(input.url, c.env, input.connector);
  } catch {
    throw new ApiFault(
      422,
      "invalid_source_url",
      "URL fora da política de coleta.",
    );
  }
  const other = await first(
    c.env.DB,
    "SELECT id FROM sources WHERE url=? AND id<>?",
    input.url,
    sourceId,
  );
  if (other) throw new ApiFault(409, "source_exists", "URL já cadastrada.");
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      "UPDATE sources SET name=?,connector=?,url=?,config_json=?,status='pending',etag=NULL,last_modified=NULL WHERE id=?",
      input.name,
      input.connector,
      input.url,
      JSON.stringify(input),
      sourceId,
    ),
    stmt(c.env.DB, "DELETE FROM ingestion_queue WHERE source_id=?", sourceId),
    stmt(
      c.env.DB,
      "INSERT INTO source_decisions VALUES (?,?,'pending',?,?)",
      id(),
      sourceId,
      "Configuração alterada: exige nova aprovação.",
      now(),
    ),
  ]);
  return c.json(
    sourceView(
      must(
        await first<SourceRow>(
          c.env.DB,
          "SELECT * FROM sources WHERE id=?",
          sourceId,
        ),
      ),
    ),
  );
});
app.patch("/api/admin/sources/:id/status", async (c) => {
  const sourceId = uuid(c.req.param("id")),
    input = await json(c, sourceDecisionSchema);
  const source = sourceView(
    must(
      await first<SourceRow>(
        c.env.DB,
        "SELECT * FROM sources WHERE id=?",
        sourceId,
      ),
    ),
  );
  if (input.status === "approved" && !source.metadataAllowed)
    throw new ApiFault(
      422,
      "metadata_not_authorized",
      "Autorize metadados antes de aprovar a fonte.",
    );
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      "UPDATE sources SET status=? WHERE id=?",
      input.status,
      sourceId,
    ),
    stmt(
      c.env.DB,
      "INSERT INTO source_decisions VALUES (?,?,?,?,?)",
      id(),
      sourceId,
      input.status,
      input.reason,
      now(),
    ),
  ]);
  return c.json({ ...source, status: input.status });
});
app.post("/api/admin/sources/:id/ingest", async (c) =>
  c.json(await ingestSource(c.env, uuid(c.req.param("id")))),
);
app.get("/api/admin/ingestion-runs", async (c) => {
  const q = pageQuery.parse(c.req.query());
  const data = await rows<any>(
    c.env.DB,
    "SELECT id,source_id sourceId,started_at startedAt,finished_at finishedAt,status,received,accepted,pending,rejected,duplicates,queued_remaining queuedRemaining,error FROM ingestion_runs ORDER BY started_at DESC,id LIMIT ? OFFSET ?",
    q.limit + 1,
    q.offset,
  );
  return c.json({
    items: data.slice(0, q.limit),
    nextCursor: data.length > q.limit ? String(q.offset + q.limit) : null,
  });
});
app.get("/api/admin/candidates", async (c) => {
  const activePolicy = await policy(c.env.DB);
  const q = pageQuery
    .extend({
      runId: z.string().uuid().optional(),
      outcome: z
        .enum(["approved", "pending", "rejected", "duplicate"])
        .optional(),
    })
    .parse(c.req.query());
  const data = await rows<any>(
    c.env.DB,
    "SELECT ic.*, s.config_json source_config, s.status source_status FROM ingestion_candidates ic JOIN sources s ON s.id=ic.source_id WHERE (? IS NULL OR run_id=?) AND (? IS NULL OR outcome=?) ORDER BY ic.created_at DESC,ic.id LIMIT ? OFFSET ?",
    q.runId ?? null,
    q.runId ?? null,
    q.outcome ?? null,
    q.outcome ?? null,
    q.limit + 1,
    q.offset,
  );
  return c.json({
    items: data.slice(0, q.limit).map((r) => ({
      id: r.id,
      runId: r.run_id,
      sourceId: r.source_id,
      contentId: r.content_id,
      outcome: r.outcome,
      reasons: JSON.parse(r.reasons_json),
      metadata: JSON.parse(r.payload_json),
      quality: evaluate(
        JSON.parse(r.payload_json),
        { ...JSON.parse(r.source_config), status: r.source_status },
        activePolicy,
      ),
      createdAt: r.created_at,
    })),
    nextCursor: data.length > q.limit ? String(q.offset + q.limit) : null,
  });
});
app.post("/api/admin/candidates/:id/review", async (c) => {
  const candidateId = uuid(c.req.param("id")),
    input = await json(c, reviewSchema),
    row = must(
      await first<any>(
        c.env.DB,
        "SELECT * FROM ingestion_candidates WHERE id=?",
        candidateId,
      ),
    );
  if (row.outcome === "duplicate")
    throw new ApiFault(
      409,
      "duplicate_review",
      "Revise o registro original da duplicata.",
    );
  const source = sourceView(
    must(
      await first<SourceRow>(
        c.env.DB,
        "SELECT * FROM sources WHERE id=?",
        row.source_id,
      ),
    ),
  );
  let contentId: string | null = row.content_id;
  let corrected = normalizeCandidate(
    candidateSchema.parse({
      ...JSON.parse(row.payload_json),
      ...input.correction,
    }),
  );
  if (!source.summaryAllowed) corrected.description = null;
  if (!source.imageAllowed) corrected.imageUrl = null;
  corrected.topics = [
    ...new Set([...corrected.topics, ...matchedTopics(corrected, source)]),
  ].slice(0, 30);
  if (input.decision === "approved") {
    const failures = prefilter(corrected, source);
    if (failures.length)
      throw new ApiFault(
        422,
        "prefilter_failed",
        "Corrija as restrições antes de aprovar.",
        failures,
      );
    const found = await duplicate(c.env.DB, corrected, source);
    if (found && found !== contentId)
      throw new ApiFault(
        409,
        "duplicate_content",
        "Correção conflita com outro conteúdo.",
      );
    const p = await policy(c.env.DB),
      quality = evaluate(corrected, source, p, Date.now(), input);
    contentId = await saveContent(
      c.env.DB,
      corrected,
      source,
      quality,
      "approved",
      contentId ?? undefined,
      "owner",
    );
  } else if (contentId)
    await stmt(
      c.env.DB,
      "UPDATE contents SET editorial_status='rejected' WHERE id=?",
      contentId,
    ).run();
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      "UPDATE ingestion_candidates SET content_id=?,payload_json=?,outcome=?,reasons_json=? WHERE id=?",
      contentId,
      JSON.stringify(corrected),
      input.decision,
      JSON.stringify([input.reason]),
      candidateId,
    ),
    stmt(
      c.env.DB,
      "INSERT INTO editorial_decisions VALUES (?,?,?,?,?,?)",
      id(),
      candidateId,
      contentId,
      input.decision,
      input.reason,
      now(),
    ),
  ]);
  return c.json({ candidateId, contentId, decision: input.decision });
});
app.post("/api/admin/contents/:id/annotations", async (c) => {
  const contentId = uuid(c.req.param("id"));
  await content(c.env.DB, contentId);
  const a = await json(c, annotationSchema),
    annotationId = id();
  if (
    a.classification === "scientific_evidence" &&
    (!a.referenceUrl || !a.limitations)
  )
    throw new ApiFault(
      422,
      "evidence_context_required",
      "Evidência exige referência e limitações explícitas.",
    );
  await stmt(
    c.env.DB,
    "INSERT INTO knowledge_annotations VALUES (?,?,?,?,?,?,?)",
    annotationId,
    contentId,
    a.classification,
    a.statement,
    a.attribution,
    a.referenceUrl,
    a.limitations,
  ).run();
  return c.json({ id: annotationId, ...a }, 201);
});
app.get("/api/admin/policy", async (c) => c.json(await policy(c.env.DB)));
app.put("/api/admin/policy", async (c) => {
  const p = await json(c, policySchema);
  if (
    await first(
      c.env.DB,
      "SELECT version FROM quality_policies WHERE version=?",
      p.version,
    )
  )
    throw new ApiFault(
      409,
      "policy_version_exists",
      "Use uma nova versão para preservar o histórico.",
    );
  await c.env.DB.batch([
    stmt(c.env.DB, "UPDATE quality_policies SET active=0 WHERE active=1"),
    stmt(
      c.env.DB,
      "INSERT INTO quality_policies VALUES (?,?,1,?)",
      p.version,
      JSON.stringify(p),
      now(),
    ),
  ]);
  return c.json(p);
});
app.notFound(() => {
  throw new ApiFault(404, "not_found", "Rota não encontrada.");
});
app.onError((error, c) => {
  const fault =
    error instanceof ApiFault
      ? error
      : error instanceof ZodError
        ? new ApiFault(
            400,
            "invalid_input",
            "Dados inválidos.",
            error.issues.map((i) => ({ path: i.path, message: i.message })),
          )
        : new ApiFault(
            500,
            "internal_error",
            "Falha interna. Consulte o identificador da requisição.",
          );
  if (fault.status === 500)
    console.error(
      JSON.stringify({ requestId: c.get("requestId"), code: "internal_error" }),
    );
  return c.json(
    {
      error: {
        code: fault.code,
        message: fault.message,
        requestId: c.get("requestId"),
        ...(fault.details ? { details: fault.details } : {}),
      },
    },
    fault.status as any,
  );
});
export default {
  fetch: app.fetch,
  scheduled: async (
    _event: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ) => {
    // Separate invocation keeps the existing ingestion below D1 Free's query cap.
    if (_event.cron === "2-57/5 * * * *") return scheduledSynopses(env);
    return scheduledIngest(env);
  },
};
