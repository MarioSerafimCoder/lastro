import { normalizeQuestion } from "./jarvis-social";
import type { Window } from "./jarvis-dialogue";
export const LOCAL_ZONE = "America/Fortaleza";
export function localDay(clock: number, zone = LOCAL_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(clock);
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
export const shiftDay = (day: string, offset: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + offset * 86400000)
    .toISOString()
    .slice(0, 10);
export function windowOf(
  start: string,
  end: string,
  kind: Window["kind"],
  label: string,
): Window {
  return {
    start,
    end,
    kind,
    label,
    days: Math.round((Date.parse(end) - Date.parse(start)) / 86400000),
  };
}
export function readPeriod(
  raw: string,
  clock: number,
  previous: Window | null = null,
): Window | "unsupported" | null {
  const text = normalizeQuestion(raw),
    today = localDay(clock);
  const monday = shiftDay(
    today,
    -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  if (/\b(antes|periodo anterior|anterior equivalente)\b/.test(text))
    return previous && previous.days > 0
      ? windowOf(
          shiftDay(previous.start, -previous.days),
          previous.start,
          "previous",
          "Período anterior equivalente",
        )
      : "unsupported";
  if (/\b(semana passada|semana anterior)\b/.test(text))
    return windowOf(
      shiftDay(monday, -7),
      monday,
      "last_week",
      "Semana passada · segunda a domingo",
    );
  if (/\b(ontem)\b/.test(text) && !/anteontem/.test(text))
    return windowOf(shiftDay(today, -1), today, "yesterday", "Ontem");
  if (/\bhoje\b/.test(text))
    return windowOf(today, shiftDay(today, 1), "today", "Hoje");
  if (/\b(30|trinta)\b/.test(text) && /dias|^(e )?(30|trinta)$/.test(text))
    return windowOf(
      shiftDay(today, -30),
      today,
      "rolling",
      "Últimos 30 dias completos",
    );
  if (
    (/\b(7|sete)\b/.test(text) && /dias|^(e )?(7|sete)$/.test(text)) ||
    /\bultima semana\b/.test(text)
  )
    return windowOf(
      shiftDay(today, -7),
      today,
      "rolling",
      "Últimos 7 dias completos",
    );
  if (
    /\b(esta semana|essa semana|nesta semana|nessa semana|semana atual)\b/.test(
      text,
    ) ||
    /^(e )?semana$/.test(text)
  )
    return windowOf(monday, today, "week", "Esta semana · segunda até ontem");
  if (
    /\b(amanha|anteontem|mes|meses|ano|anos|trimestre|\d+ dias|vinte|noventa)\b/.test(
      text,
    )
  )
    return "unsupported";
  return null;
}
export function periodOnly(raw: string) {
  return /^(?:e |nos |na |nessa |nesta )?(?:antes|periodo anterior(?: equivalente)?|hoje|ontem|semana(?: passada| atual| anterior)?|(?:esta|essa|ultima) semana|(?:ultimos? )?(?:sete|trinta|7|30)(?: dias)?)[?.! ]*$/.test(
    normalizeQuestion(raw),
  );
}
