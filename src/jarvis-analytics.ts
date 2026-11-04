import type { Env } from "./env";
import { rows } from "./db";
import type {
  AnalyticsData,
  AnalyticsRow,
} from "../packages/contracts/analytics";
import type {
  DialogueContext,
  Window,
} from "../packages/contracts/jarvis-dialogue";
import type { Answer } from "../packages/contracts/jarvis";
import { dialogueAnswer } from "../packages/contracts/jarvis-machine";
import {
  shiftDay,
  localDay,
  LOCAL_ZONE,
} from "../packages/contracts/jarvis-periods";

type Cache = {
  id: string;
  body_json: string | null;
  fetched_at: number;
  error: string | null;
};
type Result = { answer: Answer; unavailable: boolean };
const num = (v: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v);
const date = (v: string) =>
  v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6, 8);
export async function answerDialogueAnalytics(
  env: Env,
  c: DialogueContext,
  clock = Date.now(),
): Promise<Result> {
  const p = c.period!;
  const base: Answer = {
    ...dialogueAnswer("", p),
    kind: undefined,
    source: "GA4 · snapshots existentes",
    incomplete: true,
    action: {
      kind:
        c.intent === "newsletters.performance"
          ? "newsletters.open"
          : "analytics.open",
    },
  };
  const unavailable = (reason: string): Result => ({
    answer: {
      ...base,
      text:
        reason +
        " Posso tentar os últimos sete ou trinta dias disponíveis; qual prefere?",
    },
    unavailable: true,
  });
  const prefix =
    c.intent === "newsletters.performance" ? "newsletter-v2" : "analytics-v2";
  const cached = await rows<Cache>(
    env.DB,
    "SELECT id,body_json,fetched_at,error FROM analytics_cache WHERE id IN (?,?)",
    prefix + "-7",
    prefix + "-30",
  );
  const candidates = cached.flatMap((row) => {
    try {
      const data = JSON.parse(row.body_json || "null") as AnalyticsData;
      return data?.version === "analytics-1.0" && Array.isArray(data.reports)
        ? [{ row, data }]
        : [];
    } catch {
      return [];
    }
  });
  if (!candidates.length)
    return unavailable(
      "Ainda não há snapshot GA4 utilizável. Não consultei serviços externos.",
    );
  const complete = (r: AnalyticsData["reports"][number]) =>
    !r.limited && !r.privacyFiltered;
  const valid = (r: AnalyticsRow) =>
    [
      r.activeUsers,
      r.sessions,
      r.screenPageViews,
      r.engagementRate,
      r.userEngagementDuration,
    ].every((n) => Number.isFinite(n) && n >= 0) && r.engagementRate <= 1;
  // Prefer the exact window: unique users cannot be recovered from a wider daily report.
  candidates.sort(
    (a, b) =>
      Number(
        b.data.effectiveRange?.start === p.start &&
          shiftDay(b.data.effectiveRange.end, 1) === p.end,
      ) -
      Number(
        a.data.effectiveRange?.start === p.start &&
          shiftDay(a.data.effectiveRange.end, 1) === p.end,
      ),
  );
  let missingUnique = false;
  for (const { row, data } of candidates) {
    const range = data.effectiveRange;
    if (!range || !data.timeZone) continue;
    // The conversational calendar is Fortaleza. Do not silently align a differently zoned report.
    const offset = (zone: string, at: number) =>
      new Intl.DateTimeFormat("en", {
        timeZone: zone,
        timeZoneName: "longOffset",
      })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value;
    if (
      p.kind !== "rolling" && p.kind !== "previous" &&
      !Array.from({ length: p.days + 1 }, (_, i) =>
        Date.parse(shiftDay(p.start, i) + "T03:00:00Z"),
      ).every((at) => offset(data.timeZone!, at) === offset(LOCAL_ZONE, at))
    )
      continue;
    if (p.days <= 0 || range.start > p.start || shiftDay(range.end, 1) < p.end)
      continue;
    const exact = range.start === p.start && shiftDay(range.end, 1) === p.end;
    const report = data.reports.find(
      (r) =>
        r.dimension ===
        (c.intent === "articles.top"
          ? "pagePath"
          : c.intent === "newsletters.performance"
            ? "sessionCampaignName"
            : "total"),
    );
    base.syncedAt = new Date(row.fetched_at).toISOString();
    base.stale = !!row.error || clock - row.fetched_at > 43200000;
    base.period = {
      label: `${p.label}: ${p.start} a ${shiftDay(p.end, -1)} · ${data.timeZone}`,
      from: p.start,
      to: p.end,
      days: p.days === 7 ? 7 : p.days === 30 ? 30 : null,
    };
    if (c.intent !== "analytics.total") {
      if (!exact || !report || !complete(report) || !report.rows.every(valid))
        continue;
      const ordered = report.rows
        .filter(
          (r) =>
            c.intent !== "articles.top" ||
            /^\/(?:en\/|pt\/)?blog\/[a-z0-9-]+\/?$/.test(r.pagePath ?? ""),
        )
        .sort((a, b) => b.screenPageViews - a.screenPageViews);
      if (!ordered.length)
        return unavailable(
          "Não há linhas atribuídas nesse relatório; isso não comprova zero acessos.",
        );
      return {
        answer: {
          ...base,
          intent:
            c.intent === "articles.top"
              ? "articles.top"
              : "newsletters.performance",
          text:
            (c.intent === "articles.top"
              ? `Artigo mais acessado: ${ordered[0].pagePath}, com ${num(ordered[0].screenPageViews)} visualizações.`
              : `O relatório contém ${ordered.length} campanhas com tráfego atribuído; a primeira tem ${num(ordered[0].sessions)} sessões e ${num(ordered[0].screenPageViews)} visualizações.`) +
            (base.stale ? " O snapshot está desatualizado." : ""),
          incomplete: false,
        },
        unavailable: false,
      };
    }
    let values: AnalyticsRow | null = null,
      uniqueUsers = false;
    if (
      exact &&
      report &&
      complete(report) &&
      report.rows.length === 1 &&
      valid(report.rows[0])
    ) {
      values = report.rows[0];
      uniqueUsers = true;
    } else {
      const daily = data.reports.find((r) => r.dimension === "date");
      if (!daily || !complete(daily)) continue;
      const selected = daily.rows.filter(
        (r) => r.date && date(r.date) >= p.start && date(r.date) < p.end,
      );
      const dates = new Set(selected.map((r) => r.date));
      if (
        selected.length !== p.days ||
        dates.size !== p.days ||
        !selected.every(valid)
      )
        continue;
      // Sessions and views are additive. Unique users are deliberately never summed.
      const sessions = selected.reduce((s, r) => s + r.sessions, 0);
      values = {
        sessions,
        screenPageViews: selected.reduce((s, r) => s + r.screenPageViews, 0),
        activeUsers: 0,
        engagementRate: sessions
          ? selected.reduce((s, r) => s + r.engagementRate * r.sessions, 0) /
            sessions
          : 0,
        userEngagementDuration: selected.reduce(
          (s, r) => s + r.userEngagementDuration,
          0,
        ),
      };
    }
    if (c.metric === "users" && !uniqueUsers) {
      missingUnique = true;
      continue;
    }
    if (c.metric === "engagement" && values.sessions === 0)
      return unavailable(
        "Não há sessões suficientes para calcular a taxa de engajamento nesse recorte.",
      );
    const text =
      c.metric === "sessions"
        ? `${num(values.sessions)} sessões.`
        : c.metric === "views"
          ? `${num(values.screenPageViews)} visualizações de página.`
          : c.metric === "users"
            ? `${num(values.activeUsers)} usuários ativos (total deduplicado do relatório).`
            : c.metric === "engagement"
              ? `Taxa de engajamento: ${num(values.engagementRate * 100)}%; tempo total de engajamento: ${num(values.userEngagementDuration)} segundos.`
              : `${num(values.sessions)} sessões e ${num(values.screenPageViews)} visualizações de página. Sessões são visitas; visualizações contam as páginas vistas.`;
    return {
      answer: {
        ...base,
        text:
          text +
          (base.stale
            ? " O snapshot está desatualizado; estes números pertencem ao período informado."
            : ""),
        incomplete: false,
      },
      unavailable: false,
    };
  }
  if (missingUnique)
    return unavailable(
      "Esse recorte não tem total deduplicado de usuários ativos. Somar usuários por dia contaria pessoas novamente.",
    );
  const legacy = candidates.some(
    (v) => !v.data.effectiveRange || !v.data.timeZone,
  );
  return unavailable(
    legacy
      ? "Os snapshots antigos não registram a janela efetiva e o fuso necessários para garantir esse recorte. Aguarde a sincronização já existente; não farei uma consulta externa por mensagem."
      : `O snapshot disponível não cobre ${p.label.toLowerCase()} com a granularidade e o fuso necessários. Não vou extrapolar os dados.`,
  );
}
