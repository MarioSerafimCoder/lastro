import { useEffect, useRef, useState } from "react";
import { createLastroClient } from "../../../packages/contracts/client";
import type {
  SearchDays,
  SearchMetrics,
  SearchOverview,
  SearchRow,
} from "../../../packages/contracts/search-console";
import { editorialDate } from "./Ecosystem";

const api = createLastroClient();
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percent = (value: number) => `${number.format(value * 100)}%`;
const fields = [
  ["Cliques", "clicks"],
  ["Impressões", "impressions"],
  ["CTR", "ctr"],
  ["Posição média", "position"],
] as const;
const display = (field: keyof SearchMetrics, value: number) =>
  field === "ctr" ? percent(value) : number.format(value);
const statuses: Record<SearchOverview["status"], string> = {
  disabled: "Integração desativada neste ambiente.",
  unconfigured: "Configuração OAuth pendente.",
  disconnected: "Autorize a leitura do Search Console para começar.",
  pending:
    "Conexão registrada. Atualize para gerar o primeiro snapshot deste período.",
  available: "Dados do Search Console disponíveis.",
  unavailable:
    "Falha na última atualização. Dados anteriores, quando disponíveis, seguem identificados.",
  reauthorize: "Renove a autorização ou confira a permissão da propriedade.",
};

function SearchTable({
  title,
  label,
  rows,
  bars = false,
}: {
  title: string;
  label: string;
  rows: SearchRow[];
  bars?: boolean;
}) {
  const maximum = bars ? Math.max(1, ...rows.map((row) => row.clicks)) : 1;
  return (
    <article className="pub-card">
      <h3>{title}</h3>
      {rows.length ? (
        <div className="analytics-table">
          <table>
            <thead>
              <tr>
                <th>{label}</th>
                {fields.map(([name, field]) => (
                  <th key={field}>{name}</th>
                ))}
                {bars && <th>Evolução</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.key}</th>
                  {fields.map(([, field]) => (
                    <td key={field}>{display(field, row[field])}</td>
                  ))}
                  {bars && (
                    <td>
                      <meter
                        min={0}
                        max={maximum}
                        value={row.clicks}
                        aria-label={`Cliques em ${row.key}`}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Nenhum resultado disponível.</p>
      )}
    </article>
  );
}

const refreshableStatus = (status: SearchOverview["status"]) =>
  status === "available" || status === "pending" || status === "unavailable";

export default function SearchConsole() {
  const [days, setDays] = useState<SearchDays>(28);
  const [data, setData] = useState<SearchOverview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  async function load(refresh = false) {
    const id = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.searchConsole(days, refresh);
      if (id !== sequence.current) return;
      setData(result);
      if (
        !refresh &&
        refreshableStatus(result.status) &&
        (result.status !== "available" || result.stale) &&
        (!result.nextAttemptAt ||
          Date.parse(result.nextAttemptAt) <= Date.now())
      ) {
        const updated = await api.searchConsole(days, true);
        if (id === sequence.current) setData(updated);
      }
    } catch (e) {
      if (id === sequence.current)
        setError(
          e instanceof Error ? e.message : "Pesquisa Orgânica indisponível.",
        );
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
  useEffect(() => {
    if (window.location.hash === "#pesquisa-organica")
      document.getElementById("pesquisa-organica")?.scrollIntoView();
  }, []);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const { authorizationUrl } = await api.connectSearchConsole();
      const url = new URL(authorizationUrl);
      if (
        url.origin !== "https://accounts.google.com" ||
        url.pathname !== "/o/oauth2/v2/auth"
      )
        throw Error("Destino OAuth inválido.");
      window.location.assign(url.href);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível iniciar a autorização.",
      );
      setBusy(false);
    }
  }
  const snapshot = data?.data;
  const hasResults = Boolean(
    snapshot &&
    (snapshot.total ||
      snapshot.daily.length ||
      snapshot.pages.length ||
      snapshot.queries.length),
  );
  const refreshable = data && refreshableStatus(data.status);
  const canConnect =
    data?.status === "disconnected" || data?.status === "reauthorize";
  return (
    <section
      id="pesquisa-organica"
      aria-labelledby="organic-title"
      aria-busy={busy}
    >
      <div className="section-heading">
        <div>
          <span className="kicker">PORTFÓLIO · GOOGLE SEARCH CONSOLE</span>
          <h2 id="organic-title">Pesquisa Orgânica</h2>
        </div>
        <div className="analytics-controls">
          {refreshable && (
            <>
              <label>
                Período{" "}
                <select
                  value={days}
                  onChange={(event) =>
                    setDays(Number(event.target.value) as SearchDays)
                  }
                >
                  <option value={7}>7 dias</option>
                  <option value={28}>28 dias</option>
                  <option value={90}>90 dias</option>
                </select>
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={
                  busy || Date.parse(data?.nextAttemptAt ?? "") > Date.now()
                }
                onClick={() => void load(true)}
              >
                Atualizar pesquisa
              </button>
            </>
          )}
          {canConnect && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void connect()}
            >
              {data.status === "reauthorize"
                ? "Renovar autorização"
                : "Conectar Search Console"}
            </button>
          )}
        </div>
      </div>
      <p role="status">
        {busy
          ? "Consultando Pesquisa Orgânica…"
          : data
            ? data.status === "available" && !hasResults
              ? "O Search Console ainda não retornou dados finalizados para este período."
              : statuses[data.status]
            : "Sem snapshot."}
        {data?.fetchedAt
          ? ` Última atualização ${editorialDate(data.fetchedAt)}${data.stale ? " · Dados antigos" : ""}.`
          : ""}
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {data?.error === "gsc_quota" && (
        <p>
          A cota está temporariamente indisponível. Nova tentativa a partir de{" "}
          {editorialDate(data.nextAttemptAt)}.
        </p>
      )}
      {snapshot && (
        <>
          <p>
            {data?.property} · {snapshot.range.start} a {snapshot.range.end}.
            Somente dados finalizados, com margem para atraso da fonte. A API
            retorna parte das consultas e páginas.
          </p>
          {data?.property?.startsWith("sc-domain:") && (
            <p>
              A propriedade de domínio inclui subdomínios. O cruzamento com GA4
              usa páginas do domínio principal.
            </p>
          )}
          <div className="pub-grid">
            {fields.map(([label, field]) => (
              <article className="pub-card" key={field}>
                <h3>{label}</h3>
                <p className="analytics-value">
                  {snapshot.total
                    ? display(field, snapshot.total[field])
                    : "Indisponível"}
                </p>
                <p>
                  Período anterior{" "}
                  {snapshot.previous
                    ? display(field, snapshot.previous[field])
                    : "indisponível"}
                </p>
              </article>
            ))}
          </div>
          <p>
            Comparação com {snapshot.previousRange.start} a{" "}
            {snapshot.previousRange.end}.
          </p>
          <SearchTable
            title="Evolução diária"
            label="Data"
            rows={snapshot.daily}
            bars
          />
          <SearchTable
            title="Principais consultas"
            label="Consulta"
            rows={snapshot.queries}
          />
          <SearchTable
            title="Principais páginas"
            label="Página"
            rows={snapshot.pages}
          />
          <SearchTable
            title="Consultas com potencial de crescimento"
            label="Consulta"
            rows={snapshot.queryOpportunities}
          />
          <article className="pub-card">
            <h3>Páginas com oportunidade editorial</h3>
            <p>
              Páginas com pelo menos 100 impressões e CTR abaixo da propriedade.
              Sessões e engajamento do GA4 usam a mesma janela de datas e
              tráfego orgânico do Google. Cliques e sessões medem eventos
              diferentes, e a comparação é descritiva.
            </p>
            {snapshot.ga4 === "unavailable" && (
              <p>Cruzamento com GA4 indisponível para este snapshot.</p>
            )}
            {snapshot.opportunities.length ? (
              <div className="analytics-table">
                <table>
                  <thead>
                    <tr>
                      <th>Página</th>
                      <th>Impressões</th>
                      <th>CTR</th>
                      <th>Sessões GA4</th>
                      <th>Taxa de engajamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.opportunities.map((row) => (
                      <tr key={row.key}>
                        <th scope="row">{row.key}</th>
                        <td>{number.format(row.impressions)}</td>
                        <td>{percent(row.ctr)}</td>
                        <td>
                          {row.ga4
                            ? number.format(row.ga4.sessions)
                            : "Indisponível"}
                        </td>
                        <td>
                          {row.ga4
                            ? percent(row.ga4.engagementRate)
                            : "Indisponível"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>Nenhuma página atingiu os critérios no conjunto retornado.</p>
            )}
          </article>
        </>
      )}
    </section>
  );
}
