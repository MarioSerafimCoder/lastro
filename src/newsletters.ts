import { purgeOpportunities } from "./opportunities";
import type { Env } from "./env";
import { first, stmt } from "./db";
import { remote } from "./integration";
export async function newsletterSummary(env: Env) {
  const id = "newsletter-crm-v1";
  await stmt(
    env.DB,
    "INSERT OR IGNORE INTO analytics_cache(id) VALUES (?)",
    id,
  ).run();
  const cached = await first<{
    body_json: string | null;
    next_at: number;
    fetched_at: number;
    error: string | null;
  }>(env.DB, "SELECT * FROM analytics_cache WHERE id=?", id);
  if (cached && cached.next_at > Date.now())
    return cached.body_json && !cached.error
      ? { ...JSON.parse(cached.body_json), fetchedAt: cached.fetched_at }
      : null;
  const lock = await stmt(
    env.DB,
    "UPDATE analytics_cache SET lease_until=? WHERE id=? AND lease_until<? AND next_at<=?",
    Date.now() + 30000,
    id,
    Date.now(),
    Date.now(),
  ).run();
  if (lock.meta.changes !== 1) return null;
  try {
    const data = (await remote(
      env,
      "crm",
      "/integration/v1/newsletter-summary",
    )) as { version?: string; campaigns?: unknown[] };
    if (
      data.version !== "newsletter-1.0" ||
      !Array.isArray(data.campaigns) ||
      data.campaigns.length > 100
    )
      throw Error("invalid_contract");
    await stmt(
      env.DB,
      "UPDATE analytics_cache SET body_json=?,fetched_at=?,next_at=?,lease_until=0,error=NULL WHERE id=?",
      JSON.stringify(data),
      Date.now(),
      Date.now() + 43200000,
      id,
    ).run();
    return { ...data, fetchedAt: Date.now() };
  } catch {
    await stmt(
      env.DB,
      "UPDATE analytics_cache SET next_at=?,lease_until=0,error='crm_unavailable' WHERE id=?",
      Date.now() + 3600000,
      id,
    ).run();
    return null;
  }
}
export async function commercialRecommendations(env: Env) {
  await purgeOpportunities(env);
  const counts = await first<{ newCount: number; overdue: number }>(
    env.DB,
    `SELECT SUM(CASE WHEN status='novo' THEN 1 ELSE 0 END) newCount,SUM(CASE WHEN status IN ('novo','em_conversa','proposta_enviada') AND next_contact<=? THEN 1 ELSE 0 END) overdue FROM opportunities`,
    new Date().toISOString(),
  );
  const cache = await first<{ body_json: string | null }>(
    env.DB,
    "SELECT body_json FROM analytics_cache WHERE id='newsletter-v1-7' AND error IS NULL AND fetched_at>?",
    Date.now() - 43200000,
  );
  const data = cache?.body_json ? JSON.parse(cache.body_json) : null;
  const visits = !!data?.reports
    ?.find((r: any) => r.dimension === "pagePath")
    ?.rows?.some((r: any) => r.screenPageViews > 0);
  const crm = await first<{ body_json: string | null }>(
    env.DB,
    "SELECT body_json FROM analytics_cache WHERE id='newsletter-crm-v1' AND error IS NULL AND fetched_at>?",
    Date.now() - 43200000,
  );
  return {
    newCount: counts?.newCount || 0,
    overdue: counts?.overdue || 0,
    newsletterVisits: visits,
    campaignAvailable: !!(
      crm?.body_json && JSON.parse(crm.body_json).campaigns?.length
    ),
  };
}
