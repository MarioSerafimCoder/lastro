import { z } from "zod";
import type { Source } from "../packages/contracts";
import { canonicalUrl } from "./normalize";
import { stmt } from "./db";

const httpsUrl = z
  .string()
  .url()
  .max(2000)
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  });
export const evidenceSchema = z
  .object({
    text: z.string().trim().min(200).max(3000),
    url: httpsUrl,
    rightsNote: z.string().trim().min(20).max(2000),
    retrievedAt: z.string().datetime(),
    kind: z.enum([
      "authorized_feed_description",
      "authorized_abstract",
      "editorial_evidence",
    ]),
    licenseUrl: z
      .enum([
        "https://creativecommons.org/licenses/by-sa/4.0/",
        "https://creativecommons.org/licenses/by/4.0/",
        "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
      ])
      .optional(),
    sourceId: z.string().uuid().optional(),
    originUrl: httpsUrl.optional(),
    permissionVersion: z.number().int().positive().optional(),
    itemRights: z.string().max(1000).nullable().optional(),
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export type EvidenceCapture = {
  canonicalUrl: string;
  evidence: Evidence | null;
  materialKey: string;
  permissionVersion: number;
  blockCode: "rights" | "insufficient_evidence" | null;
  itemRights: string | null;
};
export const permissionVersion = (s: Source) =>
  s.synopsisPermissionVersion ?? 1;
export function processingAllowed(s: Source) {
  return (
    s.metadataAllowed &&
    s.synopsisAllowed === true &&
    (s.synopsisRightsNote?.trim().length ?? 0) >= 20
  );
}
export function itemRightsAllowed(
  rights: string | null | undefined,
  licence?: string,
) {
  if (!rights) return true;
  const r = rights.toLowerCase().replace(/http:\/\//g, "https://");
  if (
    /all rights reserved|no adaptations|no derivatives|no reuse|todos os direitos reservados|sem deriva[çc][oõ]es|sem adapta[çc][oõ]es|\/by-(?:nc-)?nd\//i.test(
      r,
    )
  )
    return false;
  return !!licence && r.includes(licence.toLowerCase());
}
// A stable material identity; retrieval timestamps never authorize another inference.
// Kept as canonical JSON so the additive SQLite migration can seed legacy records exactly.
export function evidenceKey(e: Evidence) {
  const stable = (v: string) => v.normalize("NFC").replace(/\s+/gu, " ").trim();
  return JSON.stringify([
    e.kind,
    stable(e.text),
    canonicalUrl(e.url),
    e.rightsNote,
    e.licenseUrl ?? null,
    e.sourceId ?? null,
    e.originUrl ?? null,
    e.permissionVersion ?? null,
    e.itemRights ?? null,
  ]);
}
export function evidenceAllowed(e: Evidence, s: Source, url?: string) {
  if (e.kind === "editorial_evidence") return e.rightsNote.trim().length >= 20;
  return (
    processingAllowed(s) &&
    e.sourceId === s.id &&
    e.originUrl === s.url &&
    e.permissionVersion === permissionVersion(s) &&
    e.rightsNote === s.synopsisRightsNote &&
    (e.licenseUrl ?? null) === (s.synopsisLicenseUrl ?? null) &&
    itemRightsAllowed(e.itemRights, e.licenseUrl) &&
    (!url || canonicalUrl(e.url) === canonicalUrl(url))
  );
}
export function captureEvidence(
  s: Source,
  url: string,
  text: string | null,
  itemRights: string | null,
  at: string,
): EvidenceCapture | null {
  if (!processingAllowed(s)) return null;
  let canonical: string;
  try {
    canonical = canonicalUrl(url);
  } catch {
    return null;
  }
  const rights = itemRightsAllowed(itemRights, s.synopsisLicenseUrl);
  const parsed =
    text && rights
      ? evidenceSchema.safeParse({
          text,
          url: canonical,
          rightsNote: s.synopsisRightsNote,
          retrievedAt: at,
          kind: "authorized_feed_description",
          licenseUrl: s.synopsisLicenseUrl,
          sourceId: s.id,
          originUrl: s.url,
          permissionVersion: permissionVersion(s),
          itemRights,
        })
      : null;
  const evidence = parsed?.success ? parsed.data : null;
  const blockCode = !rights
    ? "rights"
    : evidence
      ? null
      : "insufficient_evidence";
  return {
    canonicalUrl: canonical,
    evidence,
    permissionVersion: permissionVersion(s),
    itemRights,
    blockCode,
    materialKey: evidence
      ? evidenceKey(evidence)
      : JSON.stringify([
          blockCode,
          canonical,
          permissionVersion(s),
          itemRights,
        ]),
  };
}
export function captureStatement(
  db: D1Database,
  source: Source,
  captures: EvidenceCapture[],
  at: string,
) {
  return stmt(
    db,
    `INSERT INTO synopsis_evidence_cache(source_id,canonical_url,evidence_json,material_key,permission_version,block_code,item_rights,observed_at)
    SELECT s.id,json_extract(j.value,'$.canonicalUrl'),json_extract(j.value,'$.evidence'),json_extract(j.value,'$.materialKey'),
    json_extract(j.value,'$.permissionVersion'),json_extract(j.value,'$.blockCode'),json_extract(j.value,'$.itemRights'),?
    FROM json_each(?) j JOIN sources s ON s.id=? WHERE s.synopsis_permission_version=? AND s.status='approved'
    ON CONFLICT(source_id,canonical_url) DO UPDATE SET
    evidence_json=CASE WHEN synopsis_evidence_cache.material_key=excluded.material_key THEN synopsis_evidence_cache.evidence_json ELSE excluded.evidence_json END,
    material_key=excluded.material_key,permission_version=excluded.permission_version,block_code=excluded.block_code,item_rights=excluded.item_rights,observed_at=excluded.observed_at`,
    at,
    JSON.stringify(captures),
    source.id,
    permissionVersion(source),
  );
}

// Read and publication paths share the same current authorization predicate.
export function authorizationSql(e: string, source = "sp") {
  return `((json_extract(${e},'$.kind')='editorial_evidence' AND length(trim(json_extract(${e},'$.rightsNote')))>=20) OR (
    json_extract(${e},'$.kind') IN ('authorized_feed_description','authorized_abstract')
    AND json_extract(${source}.config_json,'$.synopsisAllowed')=1
    AND length(trim(json_extract(${source}.config_json,'$.synopsisRightsNote')))>=20
    AND json_extract(${e},'$.sourceId')=${source}.id
    AND json_extract(${e},'$.originUrl')=${source}.url
    AND json_extract(${e},'$.permissionVersion')=${source}.synopsis_permission_version
    AND json_extract(${e},'$.rightsNote')=json_extract(${source}.config_json,'$.synopsisRightsNote')
    AND COALESCE(json_extract(${e},'$.licenseUrl'),'')=COALESCE(json_extract(${source}.config_json,'$.synopsisLicenseUrl'),'')
  ))`;
}
export const synopsisGate = `EXISTS(SELECT 1 FROM content_synopses sy JOIN sources sp ON sp.id=c.source_id
  WHERE sy.content_id=c.id AND sy.status='validated' AND length(trim(sy.text))>0 AND sy.metadata_json=c.metadata_json
  AND sp.status='approved' AND json_extract(sp.config_json,'$.metadataAllowed')=1
  AND ${authorizationSql("sy.evidence_json")}
  AND (json_extract(sy.evidence_json,'$.kind')='editorial_evidence' OR NOT EXISTS(
    SELECT 1 FROM synopsis_evidence_cache ec WHERE ec.source_id=sp.id AND ec.canonical_url=c.canonical_url
    AND ec.permission_version=sp.synopsis_permission_version AND (ec.block_code IS NOT NULL OR ec.material_key IS NOT sy.evidence_key))))`;
