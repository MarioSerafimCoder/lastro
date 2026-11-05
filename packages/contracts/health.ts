export type HealthState =
  "healthy" | "warning" | "failed" | "unknown" | "disabled";
export type HealthItem = {
  id: string;
  label: string;
  kind: "service" | "integration";
  state: HealthState;
  detail: string;
  lastSuccess?: string;
  lastAttempt?: string;
  nextRun?: string;
  pending?: number;
  failures?: number;
  consecutiveFailures?: number;
  durationMs?: number;
  auth?: "configured" | "missing" | "reauthorize" | "verified";
  href?: string;
};
export type HealthMetric = {
  id: string;
  label: string;
  scope: string;
  unit: string;
  value: number | null;
  limit: number | null;
  detail: string;
};
export type HealthEvent = {
  id: string;
  label: string;
  state: HealthState;
  at: string;
  detail: string;
};
export type HealthSnapshot = {
  checkedAt: string;
  items: HealthItem[];
  metrics: HealthMetric[];
  events: HealthEvent[];
};
export type HealthOverview = {
  snapshot: HealthSnapshot | null;
  enabled: boolean;
  nextRefresh: string | null;
  stale: boolean;
  refreshFailed: boolean;
};
