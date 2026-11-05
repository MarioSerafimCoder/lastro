import { useEffect, useState } from "react";
import { createLastroClient } from "../../../packages/contracts/client";
import type {
  HealthOverview,
  HealthState,
} from "../../../packages/contracts/health";
import { editorialDate } from "./Ecosystem";

const api = createLastroClient();
const labels: Record<HealthState, string> = {
  healthy: "Saudável",
  warning: "Atenção",
  failed: "Falha",
  unknown: "Sem dados suficientes",
  disabled: "Desativado",
};
const destinations = {
  "/": "for-you",
  "/publicacoes": "publicacoes",
  "/oportunidades": "oportunidades",
  "/newsletters": "newsletters",
  "/analytics": "analytics",
} as const;
const authLabels = {
  configured: "Configurada",
  missing: "Ausente",
  reauthorize: "Requer renovação",
  verified: "Verificada na última leitura",
};
const format = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export default function Health({
  navigate,
}: {
  navigate: (area: (typeof destinations)[keyof typeof destinations]) => void;
}) {
  const [data, setData] = useState<HealthOverview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  async function load(refresh = false) {
    setBusy(true);
    setError("");
    try {
      setData(await api.ecosystemHealth(refresh));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diagnóstico indisponível.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const snapshot = data?.snapshot;
  return (
    <section
      className="page-section ecosystem analytics"
      aria-label="Saúde do Ecossistema"
      aria-busy={busy}
    >
      <div className="section-heading">
        <div>
          <span className="kicker">OPERAÇÕES · LASTRO</span>
          <h2>Visão geral</h2>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={busy || data?.enabled === false}
          onClick={() => void load(true)}
        >
          Atualizar diagnóstico
        </button>
      </div>
      <p role="status">
        {busy
          ? "Carregando diagnóstico…"
          : data?.enabled === false
            ? "Monitoramento desativado neste ambiente."
            : snapshot
              ? `Última atualização ${editorialDate(snapshot.checkedAt)}${data?.stale ? " · Snapshot antigo" : ""}`
              : "Aguardando o primeiro diagnóstico."}
      </p>
      {data?.nextRefresh && (
        <p>Próxima atualização permitida {editorialDate(data.nextRefresh)}.</p>
      )}
      {data?.refreshFailed && (
        <p className="notice error" role="alert">
          A última tentativa de diagnóstico falhou.
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {snapshot && (
        <>
          <div className="pub-grid">
            {(Object.keys(labels) as HealthState[]).map((state) => (
              <article className="pub-card" key={state}>
                <h3>{labels[state]}</h3>
                <p className="analytics-value">
                  {snapshot.items.filter((item) => item.state === state).length}
                </p>
              </article>
            ))}
          </div>
          <h2>Serviços e integrações</h2>
          <div className="pub-grid">
            {snapshot.items.map((item) => (
              <article className="pub-card" key={item.id}>
                <span className="kicker">
                  {item.kind === "service" ? "SERVIÇO" : "INTEGRAÇÃO"}
                </span>
                <h3>{item.label}</h3>
                <p>
                  <strong>{labels[item.state]}</strong>
                </p>
                <p>{item.detail}</p>
                {item.lastSuccess && (
                  <p>Último sucesso {editorialDate(item.lastSuccess)}</p>
                )}
                {item.lastAttempt && (
                  <p>Última tentativa {editorialDate(item.lastAttempt)}</p>
                )}
                {item.nextRun && (
                  <p>Próxima janela {editorialDate(item.nextRun)}</p>
                )}
                {item.pending != null && (
                  <p>
                    {item.pending} pendentes · {item.failures ?? 0} em erro
                  </p>
                )}
                {item.consecutiveFailures ? (
                  <p>
                    {item.consecutiveFailures} falhas consecutivas na fonte mais
                    afetada
                  </p>
                ) : null}
                {item.durationMs != null && (
                  <p>Tempo de resposta {format.format(item.durationMs)} ms</p>
                )}
                {item.auth && <p>Autorização · {authLabels[item.auth]}</p>}
                {item.href?.startsWith("https://") && (
                  <a href={item.href} target="_blank" rel="noopener noreferrer">
                    Abrir aplicativo
                  </a>
                )}
                {item.href && item.href in destinations && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      navigate(
                        destinations[item.href as keyof typeof destinations],
                      )
                    }
                  >
                    Abrir no Lastro
                  </button>
                )}
              </article>
            ))}
          </div>
          <article className="pub-card">
            <h2>Consumo e cotas</h2>
            <div className="analytics-table">
              <table>
                <thead>
                  <tr>
                    <th>Métrica</th>
                    <th>Escopo</th>
                    <th>Valor</th>
                    <th>Fonte</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.metrics.map((metric) => (
                    <tr key={metric.id}>
                      <th scope="row">{metric.label}</th>
                      <td>{metric.scope}</td>
                      <td>
                        {metric.value === null
                          ? "Indisponível"
                          : `${format.format(metric.value)} ${metric.unit}`}
                        {metric.value !== null && metric.limit !== null
                          ? ` / ${format.format(metric.limit)}`
                          : ""}
                      </td>
                      <td>{metric.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
          <article className="pub-card">
            <h2>Histórico recente</h2>
            {snapshot.events.length ? (
              <ul>
                {snapshot.events.map((event) => (
                  <li key={event.id + event.at}>
                    <strong>
                      {event.label} · {labels[event.state]}
                    </strong>{" "}
                    · {editorialDate(event.at)}. {event.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nenhuma mudança de estado registrada.</p>
            )}
          </article>
        </>
      )}
    </section>
  );
}
