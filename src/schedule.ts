import type { Source } from "../packages/contracts/index";

export const EDITORIAL_TIMEZONE = "America/Fortaleza" as const;
export const RETENTION_MS = 9 * 86400000;
const editorialCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: EDITORIAL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function editorialDay(at = Date.now()) {
  const parts = editorialCalendar.formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function editorialWeek(at = Date.now()) {
  // Fortaleza's contemporary civil calendar is UTC-03; week starts Monday.
  const day = new Date(editorialDay(at) + "T00:00:00-03:00");
  const weekday = new Date(editorialDay(at) + "T12:00:00Z").getUTCDay();
  const start = day.getTime() - ((weekday + 6) % 7) * 86400000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 7 * 86400000).toISOString(),
  };
}

/** Scientific rounds retain UTC. Editorial cycles use Fortaleza. */
export function cycleKey(source: Pick<Source, "connector">, at = Date.now()) {
  const date = new Date(at);
  if (source.connector !== "openalex") return editorialDay(at);
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
          Date.parse(editorialDay(at) + "T00:00:00-03:00") + 86400000,
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
