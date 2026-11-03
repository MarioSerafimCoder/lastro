import { useEffect, useRef, useState } from "react";
import { createLastroClient } from "../../../packages/contracts/client";
import type {
  AnalyticsOverview,
  AnalyticsRow,
} from "../../../packages/contracts/analytics";
import { editorialDate } from "./Ecosystem";
const api = createLastroClient();
const number = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(n);
export default function Analytics() {
  const [days, setDays] = useState<7 | 30>(7),
    [data, setData] = useState<AnalyticsOverview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sequence = useRef(0);
  async function load(refresh = false) {
    const id = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const value = await (refresh
        ? api.refreshAnalytics(days)
        : api.analyticsOverview(days));
      if (id === sequence.current) setData(value);
    } catch (e) {
      if (id === sequence.current)
        setError(e instanceof Error ? e.message : "Analytics indisponível.");
    } finally {
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
  const daily = report("date")?.rows ?? [];
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
          <div className="analytics-table">
            <table>
              <thead>
                <tr>
                  <th>{label}</th>
                  <th>Usuários ativos</th>
                  <th>Sessões</th>
                  <th>Visualizações</th>
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
      className="page-section ecosystem analytics"
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
      <p>
        Até ontem, conforme o fuso da propriedade GA4. Snapshot com cache de 12
        horas; atualização manual limitada a uma por hora em cada período.
      </p>
      <p role="status">
        {busy
          ? "Consultando Analytics…"
          : `Última atualização: ${editorialDate(data?.freshness.fetchedAt)}`}
        {data?.freshness.stale ? " · Dados antigos" : ""}
      </p>
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
      <div className="pub-grid">
        {[
          ["Usuários ativos", "activeUsers"],
          ["Sessões", "sessions"],
          ["Visualizações", "screenPageViews"],
          ["Taxa de engajamento", "engagementRate"],
          ["Tempo de engajamento", "userEngagementDuration"],
        ].map(([label, key]) => (
          <article className="pub-card" key={key}>
            <h3>{label}</h3>
            <p className="analytics-value">
              {total
                ? key === "engagementRate"
                  ? number(total.engagementRate * 100) + "%"
                  : key === "userEngagementDuration"
                    ? number(total.userEngagementDuration / 60) + " min"
                    : number(total[key as keyof AnalyticsRow] as number)
                : "—"}
            </p>
          </article>
        ))}
      </div>
      {!total && data?.status === "available" && (
        <p>
          Sem dados no período. Ausência de resultados não indica falha de
          autenticação.
        </p>
      )}
      <article className="pub-card">
        <h2>Evolução diária</h2>
        {!data?.data ? (
          <p>Dados indisponíveis.</p>
        ) : !daily.length ? (
          <p>Nenhum resultado diário.</p>
        ) : (
          <div className="analytics-table">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Usuários ativos</th>
                  <th>Sessões</th>
                  <th>Visualizações</th>
                  <th>Evolução de visualizações</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((row) => (
                  <tr key={row.date}>
                    <th scope="row">
                      {row.date?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1")}
                    </th>
                    <td>{number(row.activeUsers)}</td>
                    <td>{number(row.sessions)}</td>
                    <td>{number(row.screenPageViews)}</td>
                    <td>
                      <meter
                        aria-label={`Visualizações em ${row.date}`}
                        min={0}
                        max={Math.max(
                          1,
                          ...daily.map((d) => d.screenPageViews),
                        )}
                        value={row.screenPageViews}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>
          Usuários ativos do período são calculados pelo GA4; não são a soma dos
          dias.
        </p>
      </article>
      {table("Páginas mais acessadas", "pagePath", "Página")}
      {table("Origens de tráfego", "sessionSourceMedium", "Origem / mídia")}
      {table("Campanhas UTM", "sessionCampaignName", "Campanha de sessão")}
      <p>
        Campanhas incluem valores atribuídos pelo GA4 e UTMs quando disponíveis;
        “(not set)” indica atribuição ausente.
      </p>
    </section>
  );
}
