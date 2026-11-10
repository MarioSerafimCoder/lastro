import { useEffect, useRef, useState } from "react";
import { createLastroClient } from "../../../packages/contracts/client";
import type {
  AnalyticsOverview,
  AnalyticsRow,
} from "../../../packages/contracts/analytics";
import { editorialDate } from "./Ecosystem";
import SearchConsole from "./SearchConsole";
import "./dashboard.css";
const api = createLastroClient();
const formatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const number = (n: number) => formatter.format(n);
const chartFields = [
  ["Usuários ativos", "activeUsers"],
  ["Sessões", "sessions"],
  ["Visualizações", "screenPageViews"],
] as const;
const metricFields = [
  ...chartFields,
  ["Taxa de engajamento", "engagementRate"],
  ["Tempo de engajamento", "userEngagementDuration"],
] as const;
const dateLabel = (date?: string) =>
  date?.replace(/^(\d{4})-?(\d{2})-?(\d{2})$/, "$3/$2/$1");
const chartDay = (date: string) =>
  Date.parse(
    date.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") + "T00:00:00Z",
  ) / 86400000;

function DailyChart({
  label,
  metric,
  rows,
}: {
  label: string;
  metric: "activeUsers" | "sessions" | "screenPageViews";
  rows: AnalyticsRow[];
}) {
  const points = rows.flatMap((row) => {
    const day = chartDay(row.date ?? "");
    return Number.isFinite(day)
      ? [{ day, value: row[metric], date: row.date }]
      : [];
  });
  if (!points.length) return null;
  const first = points[0],
    last = points[points.length - 1];
  const maximum = Math.max(...points.map((point) => point.value));
  const step = 300 / Math.max(2, last.day - first.day + 1);
  const barWidth = Math.min(26, step * 0.72);
  return (
    <figure className="dashboard-chart">
      <figcaption>{label}</figcaption>
      <span className="dashboard-chart-scale" aria-hidden="true">
        {number(maximum)}
      </span>
      <svg
        viewBox="0 0 300 76"
        role="img"
        aria-label={`${label} por dia, de ${dateLabel(first.date)} a ${dateLabel(last.date)}. Consulte a tabela para os valores exatos.`}
        preserveAspectRatio="none"
      >
        <path d="M0 0.5H300 M0 75.5H300" className="dashboard-chart-axis" />
        {points.map((point) => {
          const height = point.value > 0 ? (point.value / maximum) * 74 : 1;
          return (
            <rect
              key={point.day}
              x={(point.day - first.day + 0.5) * step - barWidth / 2}
              y={75 - height}
              width={barWidth}
              height={height}
            >
              <title>
                {dateLabel(point.date)} · {number(point.value)}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="dashboard-chart-scale" aria-hidden="true">
        <span>{dateLabel(first.date)?.slice(0, 5)}</span>
        <span>{dateLabel(last.date)?.slice(0, 5)}</span>
      </div>
    </figure>
  );
}
export default function Analytics() {
  const [days, setDays] = useState<7 | 30>(7),
    [data, setData] = useState<AnalyticsOverview | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const sequence = useRef(0);
  const pendingRead = useRef<{
    days: 7 | 30;
    request: Promise<AnalyticsOverview>;
  } | null>(null);
  async function load(refresh = false) {
    const id = ++sequence.current;
    setBusy(true);
    setError("");
    if (!refresh && pendingRead.current?.days !== days)
      pendingRead.current = { days, request: api.analyticsOverview(days) };
    const request = refresh
      ? api.refreshAnalytics(days)
      : pendingRead.current!.request;
    try {
      const value = await request;
      if (id === sequence.current) setData(value);
    } catch (e) {
      if (id === sequence.current)
        setError(e instanceof Error ? e.message : "Analytics indisponível.");
    } finally {
      if (pendingRead.current?.request === request) pendingRead.current = null;
      if (id === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    void load();
    return () => {
      sequence.current++;
    };
  }, [days]);
  const report = (dimension: string) =>
    data?.data?.reports.find((r) => r.dimension === dimension);
  const total = report("total")?.rows[0];
  const daily = [...(report("date")?.rows ?? [])].sort(
    (a, b) => chartDay(a.date ?? "") - chartDay(b.date ?? ""),
  );
  const range = data?.data?.effectiveRange ?? data?.data?.range;
  const nextManual = data?.freshness.fetchedAt
    ? new Date(data.freshness.fetchedAt).getTime() + 3600000
    : 0;
  const canRefresh =
    !busy &&
    Date.now() >= nextManual &&
    (!data?.error ||
      Date.now() >= new Date(data.freshness.nextAttemptAt ?? 0).getTime());
  function table(
    title: string,
    dimension: "pagePath" | "sessionSourceMedium" | "sessionCampaignName",
    label: string,
  ) {
    const r = report(dimension);
    return (
      <article className="pub-card">
        <h2>{title}</h2>
        {!r ? (
          <p>Dados indisponíveis.</p>
        ) : !r.rows.length ? (
          <p>Nenhum resultado disponível neste período.</p>
        ) : (
          <div
            className="analytics-table"
            role="region"
            aria-label={title}
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">{label}</th>
                  <th scope="col">Usuários ativos</th>
                  <th scope="col">Sessões</th>
                  <th scope="col">Visualizações</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">{row[dimension]}</th>
                    <td>{number(row.activeUsers)}</td>
                    <td>{number(row.sessions)}</td>
                    <td>{number(row.screenPageViews)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {r?.limited && <p>Exibindo os primeiros 100 resultados.</p>}
        {r?.privacyFiltered && (
          <p>Valores com possíveis dados pessoais foram omitidos.</p>
        )}
      </article>
    );
  }
  return (
    <section
      className="page-section ecosystem analytics lastro-dashboard"
      aria-label="Google Analytics"
      aria-busy={busy}
    >
      <div className="section-heading">
        <div>
          <span className="kicker">PORTFÓLIO · GA4</span>
          <h2>Leitura do seu alcance</h2>
        </div>
        <div className="analytics-controls">
          <label>
            Período{" "}
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value) as 7 | 30)}
            >
              <option value={7}>7 dias completos</option>
              <option value={30}>30 dias completos</option>
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={!canRefresh}
            onClick={() => void load(true)}
          >
            Atualizar dados
          </button>
        </div>
      </div>
      <div className="dashboard-status" role="status">
        {range && (
          <span>
            {dateLabel(range.start)} a {dateLabel(range.end)} ·{" "}
            {data?.data?.timeZone ?? "Fuso do GA4"}
          </span>
        )}
        <span>
          {busy
            ? "Carregando dados…"
            : data?.freshness.fetchedAt
              ? `Atualizado em ${editorialDate(data.freshness.fetchedAt)}`
              : data?.status === "pending"
                ? "Aguardando o primeiro snapshot."
                : "Dados indisponíveis."}
          {data?.data && data.freshness.stale ? " · Dados desatualizados" : ""}
        </span>
      </div>
      {(error || data?.error) && (
        <div className="notice error" role="alert">
          <p>
            {error ||
              ({
                analytics_reauthorization_required:
                  "A autorização Google expirou ou foi revogada.",
                analytics_quota: "Cota temporariamente indisponível.",
                analytics_forbidden: "A propriedade não permitiu esta leitura.",
              }[data?.error ?? ""] ??
                "Analytics temporariamente indisponível.")}{" "}
            {data?.data ? "O último snapshot foi preservado." : ""}
          </p>
        </div>
      )}
      <div className="dashboard-kpis" aria-label="Indicadores principais">
        {metricFields.map(([label, key]) => (
          <article className="pub-card dashboard-kpi" key={key}>
            <h3>{label}</h3>
            <p className="analytics-value">
              {total
                ? key === "engagementRate"
                  ? number(total.engagementRate * 100) + "%"
                  : key === "userEngagementDuration"
                    ? number(total.userEngagementDuration / 60) + " min"
                    : number(total[key])
                : "—"}
            </p>
          </article>
        ))}
      </div>
      {!total && data?.status === "available" && <p>Sem dados no período.</p>}
      <article className="pub-card">
        <h2>Evolução diária</h2>
        {busy && !data?.data ? (
          <p>Carregando série diária…</p>
        ) : !data?.data ? (
          <p>Dados indisponíveis.</p>
        ) : !daily.length ? (
          <p>Nenhum resultado diário neste período.</p>
        ) : (
          <>
            <div className="dashboard-charts">
              {chartFields.map(([label, metric]) => (
                <DailyChart
                  key={metric}
                  label={label}
                  metric={metric}
                  rows={daily}
                />
              ))}
            </div>
            <p className="dashboard-note">
              Cada gráfico tem escala própria. Dias sem registro ficam em
              branco.
            </p>
            <details className="dashboard-disclosure">
              <summary>Ver valores por dia</summary>
              <div
                className="analytics-table"
                role="region"
                aria-label="Valores por dia"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Usuários ativos</th>
                      <th scope="col">Sessões</th>
                      <th scope="col">Visualizações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map((row) => (
                      <tr key={row.date}>
                        <th scope="row">{dateLabel(row.date)}</th>
                        <td>{number(row.activeUsers)}</td>
                        <td>{number(row.sessions)}</td>
                        <td>{number(row.screenPageViews)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </article>
      {table("Páginas mais acessadas", "pagePath", "Página")}
      {table("Origens de tráfego", "sessionSourceMedium", "Origem / mídia")}
      {table("Campanhas UTM", "sessionCampaignName", "Campanha de sessão")}
      <p>
        Campanhas incluem valores atribuídos pelo GA4 e UTMs quando disponíveis;
        “(not set)” indica atribuição ausente.
      </p>
      <SearchConsole />
    </section>
  );
}
