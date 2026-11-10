import { useEffect, useRef, useState } from "react";
import { createLastroClient } from "../../../packages/contracts/client";
import type {
  HealthOverview,
  HealthState,
} from "../../../packages/contracts/health";
import { editorialDate } from "./Ecosystem";
import "./dashboard.css";

const api = createLastroClient();
const labels: Record<HealthState, string> = {
  healthy: "Saudável",
  warning: "Atenção",
  failed: "Falha",
  unknown: "Sem dados suficientes",
  disabled: "Desativado",
};
const stateOrder: HealthState[] = [
  "failed",
  "warning",
  "unknown",
  "disabled",
  "healthy",
];
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
  const pendingRead = useRef<Promise<HealthOverview> | null>(null);
  async function load(refresh = false) {
    setBusy(true);
    setError("");
    const request = refresh
      ? api.ecosystemHealth(true)
      : (pendingRead.current ??= api.ecosystemHealth(false));
    try {
      setData(await request);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diagnóstico indisponível.");
    } finally {
      if (pendingRead.current === request) pendingRead.current = null;
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const snapshot = data?.snapshot;
  const counts = { failed: 0, warning: 0, unknown: 0, disabled: 0, healthy: 0 };
  const services = [...(snapshot?.items ?? [])].sort(
    (a, b) => stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state),
  );
  for (const item of services) counts[item.state]++;

  return (
    <section
      className="page-section ecosystem analytics lastro-dashboard"
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
      <p className="dashboard-status" role="status">
        {busy
          ? "Carregando diagnóstico…"
          : data?.enabled === false
            ? "Monitoramento desativado neste ambiente."
            : snapshot
              ? `Última atualização ${editorialDate(snapshot.checkedAt)}${data?.stale ? " · Dados desatualizados" : ""}`
              : "Aguardando o primeiro diagnóstico."}
      </p>
      {data?.nextRefresh && (
        <p className="dashboard-note">
          Próxima atualização disponível em {editorialDate(data.nextRefresh)}.
        </p>
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
          <div className="dashboard-kpis" aria-label="Resumo dos serviços">
            {stateOrder.map((state) => (
              <article className="pub-card dashboard-kpi" key={state}>
                <h3 className="dashboard-state" data-state={state}>
                  {labels[state]}
                </h3>
                <p className="analytics-value">{counts[state]}</p>
              </article>
            ))}
          </div>
          <h2>Serviços e integrações</h2>
          {services.length === 0 && (
            <p>Nenhum serviço foi registrado neste diagnóstico.</p>
          )}
          <div className="dashboard-services">
            {services.map((item) => (
              <article className="pub-card dashboard-service" key={item.id}>
                <header>
                  <h3>{item.label}</h3>
                  <span className="dashboard-state" data-state={item.state}>
                    {labels[item.state]}
                  </span>
                </header>
                <p>{item.detail}</p>
                {item.lastAttempt ? (
                  <p className="dashboard-note">
                    Última tentativa · {editorialDate(item.lastAttempt)}
                  </p>
                ) : item.lastSuccess ? (
                  <p className="dashboard-note">
                    Último sucesso · {editorialDate(item.lastSuccess)}
                  </p>
                ) : (
                  <p className="dashboard-note">
                    Horário da verificação não informado.
                  </p>
                )}
                <div className="dashboard-service-actions">
                  {item.href?.startsWith("https://") && (
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir aplicativo
                    </a>
                  )}
                  {item.href && Object.hasOwn(destinations, item.href) && (
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
                  <details className="dashboard-disclosure">
                    <summary>Detalhes técnicos</summary>
                    <dl>
                      <dt>Tipo</dt>
                      <dd>
                        {item.kind === "service" ? "Serviço" : "Integração"}
                      </dd>
                      {item.lastAttempt && item.lastSuccess && (
                        <>
                          <dt>Último sucesso</dt>
                          <dd>{editorialDate(item.lastSuccess)}</dd>
                        </>
                      )}
                      {item.nextRun && (
                        <>
                          <dt>Próxima janela</dt>
                          <dd>{editorialDate(item.nextRun)}</dd>
                        </>
                      )}
                      {item.pending != null && (
                        <>
                          <dt>Pendentes</dt>
                          <dd>{format.format(item.pending)}</dd>
                        </>
                      )}
                      {item.failures != null && (
                        <>
                          <dt>Em erro</dt>
                          <dd>{format.format(item.failures)}</dd>
                        </>
                      )}
                      {item.consecutiveFailures != null && (
                        <>
                          <dt>Falhas consecutivas</dt>
                          <dd>{format.format(item.consecutiveFailures)}</dd>
                        </>
                      )}
                      {item.durationMs != null && (
                        <>
                          <dt>Resposta</dt>
                          <dd>{format.format(item.durationMs)} ms</dd>
                        </>
                      )}
                      {item.auth && (
                        <>
                          <dt>Autorização</dt>
                          <dd>{authLabels[item.auth]}</dd>
                        </>
                      )}
                    </dl>
                  </details>
                </div>
              </article>
            ))}
          </div>
          <article className="pub-card">
            <h2>Consumo e cotas</h2>
            {!snapshot.metrics.length ? (
              <p>O diagnóstico atual não trouxe métricas de consumo.</p>
            ) : (
              <div
                className="analytics-table"
                role="region"
                aria-label="Consumo e cotas"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Métrica</th>
                      <th scope="col">Escopo</th>
                      <th scope="col">Consumo</th>
                      <th scope="col">Fonte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.metrics.map((metric) => (
                      <tr key={metric.id}>
                        <th scope="row">{metric.label}</th>
                        <td>{metric.scope}</td>
                        <td>
                          <span className="dashboard-consumption">
                            {metric.value == null
                              ? "Consumo indisponível"
                              : `${format.format(metric.value)} ${metric.unit}`}
                            {metric.limit != null
                              ? ` / ${format.format(metric.limit)} ${metric.unit}`
                              : " · Limite não informado"}
                          </span>
                          {metric.value != null &&
                            metric.limit != null &&
                            metric.limit > 0 && (
                              <meter
                                min={0}
                                max={metric.limit}
                                value={Math.min(metric.value, metric.limit)}
                                aria-label={`${metric.label}: ${format.format(metric.value)} de ${format.format(metric.limit)} ${metric.unit}`}
                              />
                            )}
                        </td>
                        <td>{metric.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
          <details className="pub-card dashboard-disclosure">
            <summary>Histórico recente</summary>
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
          </details>
        </>
      )}
    </section>
  );
}
