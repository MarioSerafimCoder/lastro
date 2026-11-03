// Aggregated editorial analytics only. No visitor, user or campaign identifiers.
export type AnalyticsRow = {
  date?: string;
  pagePath?: string;
  activeUsers: number;
  sessions: number;
  screenPageViews: number;
};
export type AnalyticsData = {
  version: "analytics-1.0";
  propertyId: string;
  range: { start: string; end: string };
  reports: Array<{
    dimension: "date" | "pagePath";
    rows: AnalyticsRow[];
    rowCount: number;
    limited: boolean;
    privacyFiltered: boolean;
  }>;
};
export type AnalyticsOverview = {
  version: "analytics-1.0";
  propertyId: string;
  status: "available" | "unavailable" | "pending";
  freshness: {
    fetchedAt: string | null;
    stale: boolean;
    nextAttemptAt: string | null;
  };
  error: string | null;
  data: AnalyticsData | null;
};
