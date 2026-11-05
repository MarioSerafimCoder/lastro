export type SearchDays = 7 | 28 | 90;
export type SearchMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};
export type SearchRow = SearchMetrics & { key: string };
export type SearchRange = { start: string; end: string };
export type SearchSnapshot = {
  range: SearchRange;
  previousRange: SearchRange;
  total: SearchMetrics | null;
  previous: SearchMetrics | null;
  daily: SearchRow[];
  pages: SearchRow[];
  queries: SearchRow[];
  queryOpportunities: SearchRow[];
  opportunities: Array<
    SearchRow & { ga4: { sessions: number; engagementRate: number } | null }
  >;
  ga4: "available" | "unavailable";
};
export type SearchOverview = {
  status:
    | "disabled"
    | "unconfigured"
    | "disconnected"
    | "pending"
    | "available"
    | "unavailable"
    | "reauthorize";
  property: string | null;
  fetchedAt: string | null;
  nextAttemptAt: string | null;
  stale: boolean;
  error: string | null;
  data: SearchSnapshot | null;
};
