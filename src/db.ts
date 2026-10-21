import {
  defaultPolicy,
  policySchema,
  type Policy,
  type Source,
} from "../packages/contracts/index";
export const OWNER = "owner";
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export function stmt(db: D1Database, sql: string, ...args: unknown[]) {
  return db.prepare(sql).bind(...args);
}
export async function rows<T>(
  db: D1Database,
  sql: string,
  ...args: unknown[]
): Promise<T[]> {
  return (await stmt(db, sql, ...args).all<T>()).results;
}
export async function first<T>(
  db: D1Database,
  sql: string,
  ...args: unknown[]
): Promise<T | null> {
  return stmt(db, sql, ...args).first<T>();
}
export async function policy(db: D1Database): Promise<Policy> {
  const r = await first<{ config_json: string }>(
    db,
    "SELECT config_json FROM quality_policies WHERE active=1",
  );
  if (r) return policySchema.parse(JSON.parse(r.config_json));
  await stmt(
    db,
    "INSERT OR IGNORE INTO quality_policies VALUES (?,?,1,?)",
    defaultPolicy.version,
    JSON.stringify(defaultPolicy),
    now(),
  ).run();
  return defaultPolicy;
}
export type SourceRow = {
  id: string;
  name: string;
  connector: "rss" | "openalex";
  url: string;
  status: Source["status"];
  config_json: string;
  created_at: string;
  next_fetch_at: string | null;
  etag: string | null;
  last_modified: string | null;
};
export function sourceView(r: SourceRow): Source {
  return {
    ...JSON.parse(r.config_json),
    id: r.id,
    name: r.name,
    connector: r.connector,
    url: r.url,
    status: r.status,
    createdAt: r.created_at,
    nextFetchAt: r.next_fetch_at,
  };
}
