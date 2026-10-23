import type { Source } from "../packages/contracts/index";

/** Calendar boundaries are UTC, independent of the host or browser timezone. */
export function cycleKey(source: Pick<Source, "connector">, at = Date.now()) {
  const date = new Date(at);
  if (source.connector !== "openalex") return date.toISOString().slice(0, 10);
  return `${date.getUTCFullYear()}-${String(Math.floor(date.getUTCMonth() / 2) * 2 + 1).padStart(2, "0")}`;
}
export function nextCycle(
  source: Pick<Source, "connector" | "intervalMinutes">,
  at = Date.now(),
) {
  const d = new Date(at);
  return new Date(
    source.connector === "openalex"
      ? Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 2) * 2 + 2, 1)
      : Math.max(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
          at + Math.max(1440, source.intervalMinutes) * 60000,
        ),
  ).toISOString();
}
export function retryAt(failures: number, at = Date.now(), upstreamAt = 0) {
  return new Date(
    Math.max(
      at + Math.min(86400000, 900000 * 2 ** Math.min(7, failures)),
      upstreamAt,
    ),
  ).toISOString();
}
