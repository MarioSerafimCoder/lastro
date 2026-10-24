import type { Content } from "../packages/contracts/index";
import { first, rows, OWNER } from "./db";
import { must } from "./errors";
export async function content(
  db: D1Database,
  contentId: string,
): Promise<Content> {
  return must((await contents(db, [contentId]))[0]);
}
export async function contents(
  db: D1Database,
  ids: string[],
): Promise<Content[]> {
  if (!ids.length) return [];
  const data = await rows<any>(
    db,
    `SELECT c.*,s.name source_name,
 (SELECT json_object('text',sy.text,'status',sy.status,'generatorVersion',sy.generator_version,'validatedAt',sy.validated_at,'evidenceUrl',json_extract(sy.evidence_json,'$.url'),'licenseUrl',json_extract(sy.evidence_json,'$.licenseUrl')) FROM content_synopses sy WHERE sy.content_id=c.id AND sy.status='validated' AND sy.metadata_json=c.metadata_json) synopsis,
 EXISTS(SELECT 1 FROM favorites f WHERE f.content_id=c.id AND f.user_id=?) favorite,
 EXISTS(SELECT 1 FROM workshop_selection w WHERE w.content_id=c.id AND w.user_id=?) selected,
 EXISTS(SELECT 1 FROM output_sources o WHERE o.content_id=c.id) used,
 (SELECT text FROM notes n WHERE n.content_id=c.id AND n.user_id=?) note,
 (SELECT json_group_array(type) FROM interactions i WHERE i.content_id=c.id AND i.user_id=? AND i.active=1) interactions,
 (SELECT json_group_array(json_object('id',a.id,'classification',a.classification,'statement',a.statement,'attribution',a.attribution,'referenceUrl',a.reference_url,'limitations',a.limitations)) FROM knowledge_annotations a WHERE a.content_id=c.id) annotations
 FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.id IN (SELECT value FROM json_each(?))`,
    OWNER,
    OWNER,
    OWNER,
    OWNER,
    JSON.stringify(ids),
  );
  const mapped = data.map((r) => {
    const active = (t: string) =>
      (JSON.parse(r.interactions) as string[]).includes(t);
    return {
      ...JSON.parse(r.metadata_json),
      id: r.id,
      synopsis: r.synopsis ? JSON.parse(r.synopsis) : null,
      sourceId: r.source_id,
      sourceName: r.source_name,
      canonicalUrl: r.canonical_url,
      collectedAt: r.collected_at,
      editorialStatus: r.editorial_status,
      quality: JSON.parse(r.quality_json),
      state: {
        favorite: !!r.favorite,
        selected: !!r.selected,
        seen: active("seen"),
        opened: active("opened"),
        read: active("read"),
        dismissed: active("dismissed"),
        used: !!r.used,
        note: r.note ?? null,
      },
      annotations: JSON.parse(r.annotations),
    } as Content;
  });
  const lookup = new Map(mapped.map((c) => [c.id, c]));
  return ids.flatMap((i) => (lookup.has(i) ? [lookup.get(i)!] : []));
}
export async function eligible(
  db: D1Database,
  contentId: string,
): Promise<void> {
  must(
    await first(
      db,
      "SELECT c.id FROM contents c JOIN sources s ON s.id=c.source_id WHERE c.id=? AND c.editorial_status='approved' AND s.status='approved'",
      contentId,
    ),
    "Conteúdo indisponível no índice",
  );
}
