import type { Candidate, Source } from "../packages/contracts";
import { canonicalUrl } from "./normalize";
import { stmt } from "./db";

// Refresh descriptions from the feed already fetched, including seen items.
// Do not requeue, rerank, renew expiry or touch personal state.
export function refreshFeedSummaries(
  db: D1Database,
  source: Source,
  items: Candidate[],
) {
  const previews = items.flatMap((item) => {
    try {
      return item.description
        ? [{ url: canonicalUrl(item.url), text: item.description }]
        : [];
    } catch {
      return [];
    }
  });
  return stmt(
    db,
    `UPDATE contents SET metadata_json=json_set(metadata_json,'$.description',
    (SELECT json_extract(value,'$.text') FROM json_each(?) WHERE json_extract(value,'$.url')=contents.canonical_url LIMIT 1))
    WHERE source_id=? AND expired_at IS NULL
    AND EXISTS(SELECT 1 FROM sources s WHERE s.id=contents.source_id AND s.status='approved' AND json_extract(s.config_json,'$.summaryAllowed')=1)
    AND EXISTS(SELECT 1 FROM json_each(?) WHERE json_extract(value,'$.url')=contents.canonical_url
      AND json_extract(value,'$.text') IS NOT json_extract(contents.metadata_json,'$.description'))`,
    JSON.stringify(previews),
    source.id,
    JSON.stringify(previews),
  );
}
