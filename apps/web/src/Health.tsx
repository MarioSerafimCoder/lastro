import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleMinus,
  CircleX,
  Clock3,
  Gauge,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { createLastroClient } from "../../../packages/contracts/client";
import type {
  HealthEvent,
  HealthItem,
  HealthMetric,
  HealthOverview,
  HealthState,
} from "../../../packages/contracts/health";
import { editorialDate } from "./Ecosystem";
import "./dashboard.css";

const api = createLastroClient();
const states = {
  failed: { label: "Falha", icon: CircleX },
  warning: { label: "Atenção", icon: TriangleAlert },
  healthy: { label: "Saudável", icon: CheckCircle2 },
  unknown: { label: "Sem dados", icon: Clock3 },
  disabled: { label: "Desativado", icon: CircleMinus },
} satisfies Record<HealthState, { label: string; icon: typeof Activity }>;
const order = ["failed", "warning", "healthy", "unknown", "disabled"] as const;
const destinations = {
  "/": { area: "for-you", label: "Abrir Radar" },
  "/publicacoes": { area: "publicacoes", label: "Abrir Publicações" },
  "/oportunidades": { area: "oportunidades", label: "Ver oportunidades" },
  "/newsletters": { area: "newsletters", label: "Ver campanhas" },
  "/analytics": { area: "analytics", label: "Abrir Analytics" },
} as const;
type Navigate = (
  area: (typeof destinations)[keyof typeof destinations]["area"],
) => void;

const authLabels = {
  configured: "Configurada",
  missing: "Ausente",
  reauthorize: "Requer renovação",
  verified: "Verificada na última leitura",
};
const format = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

const plainDetails: Record<string, string> = {
  "Leituras operacionais do D1 concluídas.":
    "Os dados do Lastro estão acessíveis.",
  "Armazenamento de preferências acessível no D1.":
    "As preferências do Jarvis estão acessíveis.",
  "Leitura do armazenamento de memória concluída.":
    "A memória do Jarvis está acessível.",
  "Há documentos com sincronização confirmada no D1.":
    "Há documentos sincronizados com o Drive.",
  "Snapshot mais antigo que a janela esperada.": "Os dados estão atrasados.",
  "Há coleta atrasada em relação à cadência da fonte.":
    "A coleta de uma ou mais fontes está atrasada.",
  "Há tarefas com lease vencida.":
    "Há tarefas que ultrapassaram o tempo de processamento.",
  "A fila cresceu desde o snapshot anterior sem novo processamento confirmado.":
    "Mais tarefas entraram na fila desde a última verificação, sem novas conclusões.",
  "Há tarefas com falha. Abra Publicações para consultar ou retentar.":
    "Algumas tarefas falharam. Você pode revisá-las em Publicações.",
  "A sondagem HTTP da página pública não foi concluída.":
    "Não foi possível confirmar se a página pública está acessível.",
  "Sem operação autenticada recente para confirmar a disponibilidade.":
    "Ainda não há atividade recente para confirmar o funcionamento.",
  "Coleta desativada na configuração.": "A coleta está desligada.",
  "Reconciliação desligada.": "O envio automático está desligado.",
};
const plainDetail = (detail: string) => plainDetails[detail] ?? detail;

function StateBadge({ state }: { state: HealthState }) {
  const { label, icon: Icon } = states[state];
  return (
    <span className="health-badge" data-state={state}>
      <Icon size={14} aria-hidden="true" /> {label}
    </span>
  );
}

function ItemTime({ item }: { item: HealthItem }) {
  const date = item.lastAttempt ?? item.lastSuccess;
  if (!date) return null;
  return (
    <p className="health-note">
      {item.lastAttempt ? "Última verificação" : "Último sucesso"}{" "}
      <time dateTime={date}>{editorialDate(date)}</time>
    </p>
  );
}

function ItemDetails({ item }: { item: HealthItem }) {
  const facts = [
    [
      "Último sucesso",
      item.lastAttempt && item.lastSuccess && editorialDate(item.lastSuccess),
    ],
    ["Próxima tentativa", item.nextRun && editorialDate(item.nextRun)],
    ["Pendentes", item.pending == null ? null : format.format(item.pending)],
    ["Com falha", item.failures == null ? null : format.format(item.failures)],
    [
      "Falhas consecutivas",
      item.consecutiveFailures == null
        ? null
        : format.format(item.consecutiveFailures),
    ],
    [
      "Tempo de resposta",
      item.durationMs == null ? null : `${format.format(item.durationMs)} ms`,
    ],
    ["Autorização", item.auth && authLabels[item.auth]],
  ].filter(([, value]) => value != null);
  if (!facts.length) return null;
  return (
    <details className="health-item-details">
      <summary>Detalhes de {item.label}</summary>
      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function AttentionCard({
  item,
  checkedAt,
  navigate,
  showMetrics,
}: {
  item: HealthItem;
  checkedAt: string;
  navigate: Navigate;
  showMetrics: () => void;
}) {
  const destination =
    item.href && Object.hasOwn(destinations, item.href)
      ? destinations[item.href as keyof typeof destinations]
      : null;
  const external = item.href?.startsWith("https://");
  const quota = item.id.startsWith("quota-");
  const actionLabel = item.id.startsWith("tasks-")
    ? item.state === "failed"
      ? "Ver tarefas com falha"
      : "Revisar tarefas"
    : destination?.label;
  return (
    <article className="health-issue health-enter" data-state={item.state}>
      <header>
        <h3>{item.label}</h3>
        <StateBadge state={item.state} />
      </header>
      <p>{plainDetail(item.detail)}</p>
      {item.lastAttempt || item.lastSuccess ? (
        <ItemTime item={item} />
      ) : (
        <p className="health-note">
          Verificado no diagnóstico de{" "}
          <time dateTime={checkedAt}>{editorialDate(checkedAt)}</time>
        </p>
      )}
      <div className="health-issue-footer">
        {destination && (
          <button
            className="health-action"
            type="button"
            onClick={() => navigate(destination.area)}
          >
            {actionLabel} <ArrowRight size={15} aria-hidden="true" />
          </button>
        )}
        {external && (
          <a
            className="health-action"
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir {item.label} <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        )}
        {quota && (
          <button className="health-action" type="button" onClick={showMetrics}>
            Conferir consumo <ArrowDown size={15} aria-hidden="true" />
          </button>
        )}
        <ItemDetails item={item} />
      </div>
    </article>
  );
}

function ServiceList({ items }: { items: HealthItem[] }) {
  return (
    <ul className="health-services">
      {items.map((item) => (
        <li key={item.id}>
          <header>
            <h3>{item.label}</h3>
            <StateBadge state={item.state} />
          </header>
          <p>{plainDetail(item.detail)}</p>
          <ItemTime item={item} />
        </li>
      ))}
    </ul>
  );
}

const eventLabels: Record<HealthState, string> = {
  failed: "Falha registrada",
  warning: "Atenção registrada",
  healthy: "Funcionamento confirmado",
  unknown: "Verificação inconclusiva",
  disabled: "Desativado",
};

function HistoryList({ events }: { events: HealthEvent[] }) {
  return (
    <ol className="health-history">
      {events.map((event) => {
        const Icon = states[event.state].icon;
        return (
          <li key={event.id + event.at} data-state={event.state}>
            <Icon size={17} aria-hidden="true" />
            <div>
              <p className="health-note">
                {eventLabels[event.state]} <span aria-hidden="true">·</span>{" "}
                <time dateTime={event.at}>{editorialDate(event.at)}</time>
              </p>
              <h3>{event.label}</h3>
              <p>{plainDetail(event.detail)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Infrastructure({
  metrics,
  detailsRef,
}: {
  metrics: HealthMetric[];
  detailsRef: React.Ref<HTMLDetailsElement>;
}) {
  const available = metrics.filter((metric) => metric.value !== null);
  const missing = metrics.length - available.length;
  return (
    <details
      className="health-disclosure health-infrastructure"
      ref={detailsRef}
    >
      <summary>
        <Gauge size={19} aria-hidden="true" />
        <span>Detalhes avançados de infraestrutura</span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="health-disclosure-body">
        {available.length > 0 ? (
          <ul className="health-metrics">
            {available.map((metric) => {
              const value = metric.value!;
              const limit = metric.limit;
              return (
                <li key={metric.id}>
                  <h3>{metric.label}</h3>
                  <p className="health-note">{metric.scope}</p>
                  <p>
                    <strong>{format.format(value)}</strong>
                    {limit != null && <> / {format.format(limit)}</>}{" "}
                    {metric.unit}
                  </p>
                  {limit != null && limit > 0 && (
                    <meter
                      min={0}
                      max={limit}
                      value={Math.min(value, limit)}
                      aria-label={`${metric.label}: ${format.format(value)} de ${format.format(limit)} ${metric.unit}`}
                    />
                  )}
                  {metric.detail && (
                    <p className="health-note">{metric.detail}</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>Este diagnóstico ainda não tem dados de consumo.</p>
        )}
        {missing > 0 && available.length > 0 && (
          <p className="health-note">
            {missing === 1
              ? "Uma métrica está sem dados."
              : `${missing} métricas estão sem dados.`}
          </p>
        )}
      </div>
    </details>
  );
}

export default function Health({ navigate }: { navigate: Navigate }) {
  const [data, setData] = useState<HealthOverview | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(true);
  const pending = useRef<Promise<HealthOverview> | null>(null);
  const infrastructure = useRef<HTMLDetailsElement>(null);

  async function load(refresh = false) {
    if (pending.current) return;
    setBusy(true);
    setError("");
    setFeedback("");
    const request = api.ecosystemHealth(refresh);
    pending.current = request;
    try {
      const result = await request;
      setData(result);
      if (refresh && result.enabled && !result.refreshFailed) {
        if (
          result.snapshot &&
          result.snapshot.checkedAt !== data?.snapshot?.checkedAt
        ) {
          setFeedback("Diagnóstico atualizado.");
        } else if (result.nextRefresh) {
          setFeedback(
            `Próxima atualização disponível em ${editorialDate(result.nextRefresh)}.`,
          );
        } else {
          setFeedback(
            "O diagnóstico ainda não foi atualizado. Tente novamente em instantes.",
          );
        }
      }
    } catch {
      setError(
        "Não foi possível carregar o diagnóstico. Tente atualizar novamente.",
      );
    } finally {
      pending.current = null;
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const snapshot = data?.snapshot;
  const services: Record<HealthState, HealthItem[]> = {
    failed: [],
    warning: [],
    healthy: [],
    unknown: [],
    disabled: [],
  };
  for (const item of snapshot?.items ?? []) services[item.state].push(item);
  const issues = [...services.failed, ...services.warning];
  const otherCount = services.unknown.length + services.disabled.length;
  const outdated = Boolean(
    data?.stale || data?.refreshFailed || (snapshot && error),
  );
  const overall: HealthState = services.failed.length
    ? "failed"
    : issues.length || outdated
      ? "warning"
      : services.healthy.length
        ? "healthy"
        : "unknown";
  const overallTitle = {
    failed: "Há falhas para resolver",
    warning: issues.length
      ? "Há itens para acompanhar"
      : "O diagnóstico precisa ser atualizado",
    healthy: otherCount
      ? "Os serviços verificados estão bem"
      : "Tudo funcionando normalmente",
    unknown: "Aguardando confirmação dos serviços",
    disabled: "Monitoramento desativado",
  }[overall];
  const OverallIcon = states[overall].icon;
  const issueCount =
    issues.length === 1
      ? "1 item precisa de atenção"
      : `${issues.length} itens precisam de atenção`;

  function showMetrics() {
    if (!infrastructure.current) return;
    infrastructure.current.open = true;
    infrastructure.current.querySelector("summary")?.focus();
  }

  return (
    <section
      className="page-section health-dashboard"
      aria-label="Saúde do Ecossistema"
    >
      <div className="health-toolbar">
        <div className="health-timestamp">
          {snapshot ? (
            <p className="health-note">
              <span>Última atualização</span>
              <time dateTime={snapshot.checkedAt}>
                {editorialDate(snapshot.checkedAt)}
              </time>
            </p>
          ) : (
            <p className="health-note">Diagnóstico dos serviços</p>
          )}
        </div>
        <button
          className="secondary-button health-refresh"
          type="button"
          aria-disabled={busy}
          disabled={data?.enabled === false}
          onClick={() => {
            if (!busy) void load(true);
          }}
        >
          <RefreshCw
            size={16}
            aria-hidden="true"
            className={busy ? "health-spin" : undefined}
          />
          {busy ? "Atualizando diagnóstico…" : "Atualizar diagnóstico"}
        </button>
        <div className="health-feedback" role="status">
          {busy
            ? snapshot
              ? "Verificando os serviços…"
              : "Carregando diagnóstico…"
            : feedback}
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {data?.refreshFailed && (
        <p className="notice error" role="alert">
          A última tentativa de diagnóstico falhou.
          {snapshot && " Você está vendo o último diagnóstico disponível."}
        </p>
      )}
      {data?.stale && !data.refreshFailed && (
        <p className="health-stale">
          Os dados abaixo são de uma verificação anterior. Atualize para
          confirmar o estado atual.
        </p>
      )}

      {!snapshot && !busy && !error && (
        <div className="health-empty">
          <Activity size={24} aria-hidden="true" />
          <p>
            {data?.enabled === false
              ? "Monitoramento desativado neste ambiente."
              : "Aguardando o primeiro diagnóstico."}
          </p>
          {data?.enabled && !data.refreshFailed && (
            <span>Atualize o diagnóstico para verificar os serviços.</span>
          )}
        </div>
      )}

      {snapshot && (
        <>
          <div
            className="health-overview health-enter"
            data-state={overall}
            aria-busy={busy}
          >
            <div className="health-overview-main">
              <span className="health-overview-icon">
                <OverallIcon size={26} aria-hidden="true" />
              </span>
              <div>
                <p className="health-eyebrow">Estado geral</p>
                <h3>{overallTitle}</h3>
                <p>
                  {issues.length
                    ? `${issueCount} no último diagnóstico.`
                    : otherCount
                      ? "Veja abaixo os serviços que aguardam confirmação ou estão desativados."
                      : services.healthy.length
                        ? "Nenhuma falha ou atenção no último diagnóstico."
                        : "Nenhum serviço foi registrado neste diagnóstico."}
                </p>
              </div>
            </div>
            <dl className="health-kpis" aria-label="Resumo dos serviços">
              {order.map((state) => {
                const { icon: Icon, label } = states[state];
                return (
                  <div className="health-kpi" data-state={state} key={state}>
                    <dt>
                      <Icon size={15} aria-hidden="true" /> {label}
                    </dt>
                    <dd key={services[state].length} className="health-enter">
                      {services[state].length}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>

          <section className="health-group" aria-labelledby="health-attention">
            <h2 id="health-attention">Precisa da sua atenção</h2>
            {issues.length ? (
              <div className="health-issues">
                {issues.map((item) => (
                  <AttentionCard
                    key={item.id}
                    item={item}
                    checkedAt={snapshot.checkedAt}
                    navigate={navigate}
                    showMetrics={showMetrics}
                  />
                ))}
              </div>
            ) : (
              <div className="health-empty">
                {outdated ? (
                  <Clock3 size={19} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={19} aria-hidden="true" />
                )}
                <p>
                  {outdated
                    ? "Nenhuma falha registrada no último diagnóstico."
                    : "Nenhuma ação pendente no diagnóstico."}
                </p>
              </div>
            )}
          </section>

          <section className="health-group" aria-labelledby="health-healthy">
            <h2 id="health-healthy">Funcionando normalmente</h2>
            {services.healthy.length ? (
              <ServiceList items={services.healthy} />
            ) : (
              <p className="health-note">
                Nenhum serviço com funcionamento confirmado neste diagnóstico.
              </p>
            )}
          </section>

          {otherCount > 0 && (
            <section
              className="health-group health-secondary"
              aria-labelledby="health-other"
            >
              <h2 id="health-other">Sem dados ou desativados</h2>
              <ServiceList
                items={[...services.unknown, ...services.disabled]}
              />
            </section>
          )}

          <section className="health-group" aria-labelledby="health-recent">
            <h2 id="health-recent">Mudanças recentes</h2>
            {snapshot.events.length ? (
              <HistoryList events={snapshot.events.slice(0, 5)} />
            ) : (
              <p className="health-note">
                Nenhuma mudança foi registrada até agora.
              </p>
            )}
            {snapshot.events.length > 5 && (
              <details className="health-disclosure">
                <summary>
                  <span>Ver mudanças anteriores</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div className="health-disclosure-body">
                  <HistoryList events={snapshot.events.slice(5)} />
                </div>
              </details>
            )}
          </section>

          <Infrastructure
            metrics={snapshot.metrics}
            detailsRef={infrastructure}
          />
        </>
      )}
    </section>
  );
}
