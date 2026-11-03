import { useCallback, useEffect, useRef, useState } from "react";
import { createLastroClient } from "../../../packages/contracts/client";
import type {
  IntegrationOverview,
  IntegrationWeekly,
  IntegrationTicket,
} from "../../../packages/contracts/integration";
const api = createLastroClient();
export const editorialDate = (value: string | null | undefined) => {
  if (!value) return "Data indisponível";
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Fortaleza",
      }).format(d)
    : "Data indisponível";
};
export const stateLabel = (s: string) =>
  ({
    pending: "Pendente",
    processing: "Em processamento",
    completed: "Concluído",
    error: "Erro",
    intervention: "Aguardando intervenção",
    available: "Publicado",
    scheduled: "Agendado",
    build_pending: "Aguardando confirmação",
    build_failed: "Falha no build",
    remote_changed: "Versão remota alterada",
    github_draft: "Rascunho",
    removed: "Removido",
    private: "Privado",
    isolated_branch: "Branch isolada",
  })[s] || s;
export function AdminLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  let valid = false;
  try {
    const u = new URL(href);
    valid =
      u.protocol === "https:" &&
      ["studio.marioserafim.com.br", "crm.marioserafim.com.br"].includes(
        u.hostname,
      ) &&
      !u.username &&
      !u.password;
  } catch {
    /* invalid URL */
  }
  return valid ? (
    <a
      className="text-button"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children} ↗
    </a>
  ) : (
    <span>Link indisponível</span>
  );
}
export function useEcosystem() {
  const [data, setData] = useState<IntegrationOverview | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const active = useRef(true),
    running = useRef(false);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setLoading(true);
    try {
      const next = await api.integrationOverview();
      if (active.current) {
        setData(next);
        setError("");
      }
    } catch {
      if (active.current)
        setError(
          "Integração indisponível. Os dados anteriores podem estar desatualizados.",
        );
    } finally {
      running.current = false;
      if (active.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
    };
  }, [refresh]);
  return { data, error, loading, refresh };
}
export type EcosystemState = ReturnType<typeof useEcosystem>;
export function StudioDraftAction({
  packageId,
  objective,
  argument,
  ecosystem,
}: {
  packageId: string;
  objective: string;
  argument: string;
  ecosystem: EcosystemState;
}) {
  const [title, setTitle] = useState(objective.slice(0, 200)),
    [ticket, setTicket] = useState<IntegrationTicket | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const link = ecosystem.data?.studioDrafts.find(
    (d) => d.package_id === packageId,
  );
  const task =
    ecosystem.data?.tasks.find(
      (t) => t.kind === "studio" && t.source_id === packageId,
    ) || ticket;
  useEffect(() => {
    if (
      !task ||
      !["pending", "processing", "error"].includes(task.state) ||
      link
    )
      return;
    let tries = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void ecosystem.refresh();
      if (++tries >= 20) window.clearInterval(timer);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [task?.state, link?.id, ecosystem.refresh]);
  const submit = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setTicket(
        await api.studioDraft(packageId, {
          title: title.trim(),
          argument,
          outline: [],
        }),
      );
      await ecosystem.refresh();
    } catch {
      setError(
        "Não foi possível confirmar a solicitação. Você pode tentar novamente com o mesmo pacote.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="ecosystem-action" aria-label="Rascunho no Studio">
      <h4>Continuar no Studio</h4>
      {link ? (
        <AdminLink href={link.admin_url}>Abrir no Studio</AdminLink>
      ) : (
        <>
          <label>
            Título sugerido
            <input
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || !!task || !title.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Solicitando…" : "Criar rascunho no Studio"}
          </button>
        </>
      )}
      {task && (
        <p role="status">
          {stateLabel(task.state)}.{" "}
          {task.state === "pending"
            ? "Aguardando processamento do serviço."
            : ""}
        </p>
      )}
      {(error || ecosystem.error) && (
        <p role="alert">{error || ecosystem.error}</p>
      )}
      <button
        className="text-button"
        disabled={ecosystem.loading}
        onClick={() => void ecosystem.refresh()}
      >
        Consultar estado
      </button>
    </section>
  );
}
export default function Ecosystem({
  ecosystem,
}: {
  ecosystem: EcosystemState;
}) {
  const { data, error, loading, refresh } = ecosystem;
  const [weekly, setWeekly] = useState<IntegrationWeekly | null>(null),
    [weeklyError, setWeeklyError] = useState(""),
    [busy, setBusy] = useState(""),
    [actionError, setActionError] = useState("");
  const lock = useRef(false);
  const loadWeekly = useCallback(() => {
    setWeeklyError("");
    void api
      .integrationWeekly()
      .then(setWeekly)
      .catch(() => setWeeklyError("Resumo indisponível."));
  }, []);
  useEffect(loadWeekly, [loadWeekly]);
  const retry = async (id: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(id);
    setActionError("");
    try {
      await api.retryIntegration(id);
      await refresh();
    } catch {
      setActionError("Não foi possível reabrir a tarefa.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  const rows = (items: React.ReactNode[]) =>
    items.length ? (
      <ul className="editorial-list">{items}</ul>
    ) : (
      <p>
        {data?.freshness?.last_success
          ? "Nenhum registro neste snapshot."
          : "Dados ainda indisponíveis."}
      </p>
    );
  const agenda = [
    ...(data?.articles || [])
      .filter((a) => a.state === "scheduled" || a.state === "available")
      .map((a) => ({
        id: a.slug,
        label: a.title || a.slug,
        date: a.publish_at,
        state: stateLabel(a.state),
      })),
    ...(data?.studioDrafts || []).map((d) => ({
      id: d.id,
      label: d.slug,
      date: d.updated_at,
      state: "Rascunho atualizado",
    })),
    ...(data?.newsletters || []).map((n) => ({
      id: n.target_id,
      label: n.source_id,
      date: n.created_at,
      state: "Newsletter preparada",
    })),
    ...(data?.tasks || [])
      .filter((t) => t.state !== "completed")
      .map((t) => ({
        id: t.id,
        label: t.source_id,
        date: t.next_at ? new Date(t.next_at).toISOString() : t.updated_at,
        state: stateLabel(t.state),
      })),
  ].sort(
    (a, b) => (Date.parse(a.date || "") || 0) - (Date.parse(b.date || "") || 0),
  );
  return (
    <section className="page-section publications ecosystem">
      <div className="section-heading">
        <div>
          <span className="kicker">ECOSSISTEMA EDITORIAL</span>
          <h2>Publicações</h2>
        </div>
        <button
          className="secondary-button"
          disabled={loading}
          onClick={() => {
            void refresh();
            loadWeekly();
          }}
        >
          Atualizar consulta
        </button>
      </div>
      {loading && <p role="status">Consultando integrações…</p>}
      {error && <p role="alert">{error}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      <p>
        Última sincronização: {editorialDate(data?.freshness?.last_success)}.
        Snapshot de até 100 registros por lista; não representa acompanhamento
        em tempo real.
      </p>
      {data && !data.enabled && (
        <p className="notice">
          Integração desativada. A ativação depende de homologação.
        </p>
      )}
      {data?.freshness?.error && (
        <p role="alert">
          A sincronização encontrou uma falha. Revise as pendências.
        </p>
      )}
      <div className="pub-grid">
        <article className="pub-card">
          <h3>Rascunhos do Studio</h3>
          {rows(
            (data?.studioDrafts || []).map((d) => (
              <li key={d.id}>
                <strong>{d.slug}</strong>
                <p>{editorialDate(d.updated_at)}</p>
                <AdminLink href={d.admin_url}>Abrir no Studio</AdminLink>
              </li>
            )),
          )}
        </article>
        <article className="pub-card">
          <h3>Artigos publicados e agendados</h3>
          {rows(
            (data?.articles || []).map((a) => (
              <li key={a.slug}>
                <strong>{a.title || a.slug}</strong>
                <p>
                  {stateLabel(a.state)} · {editorialDate(a.publish_at)}
                </p>
              </li>
            )),
          )}
        </article>
        <article className="pub-card">
          <h3>Newsletters preparadas</h3>
          {rows(
            (data?.newsletters || []).map((n) => (
              <li key={n.target_id}>
                <strong>{n.source_id}</strong>
                <p>{editorialDate(n.created_at)}</p>
                <AdminLink href={n.admin_url}>Abrir no CRM</AdminLink>
              </li>
            )),
          )}
        </article>
        <article className="pub-card">
          <h3>Artigos sem distribuição</h3>
          {rows(
            (data?.withoutNewsletter || []).map((a) => (
              <li key={a.slug}>
                {a.title || a.slug}
                <p>
                  Revise a tarefa correspondente antes de preparar uma
                  newsletter.
                </p>
              </li>
            )),
          )}
        </article>
      </div>
      <section id="integration-attention" className="pub-card">
        <h3>Pendências e revisão do histórico</h3>
        <p>
          Artigos anteriores à ativação aguardam aprovação individual. A
          aprovação prepara somente um rascunho privado.
        </p>
        {rows(
          (data?.tasks || [])
            .filter((t) => t.state !== "completed")
            .map((t) => (
              <li key={t.id}>
                <strong>{t.source_id}</strong>
                <p>
                  {stateLabel(t.state)} ·{" "}
                  {t.error === "backlog_review"
                    ? "Artigo histórico: revisão necessária"
                    : t.error
                      ? stateLabel(t.error)
                      : "Aguardando o serviço"}
                </p>
                {["error", "intervention"].includes(t.state) && (
                  <button
                    className="secondary-button"
                    disabled={!!busy}
                    onClick={() => void retry(t.id)}
                  >
                    {busy === t.id
                      ? "Registrando…"
                      : t.error === "backlog_review"
                        ? "Aprovar rascunho para este artigo"
                        : "Tentar novamente"}
                  </button>
                )}
              </li>
            )),
        )}
      </section>
      <section className="pub-card">
        <h3>Calendário editorial</h3>
        <p>
          Datas em America/Fortaleza · atualizações de rascunhos não são datas
          de publicação.
        </p>
        {rows(
          agenda.map((a) => (
            <li key={a.id}>
              <time>{editorialDate(a.date)}</time>
              <p>
                {a.label} · {a.state}
              </p>
            </li>
          )),
        )}
      </section>
      <section className="pub-card">
        <h3>Resumo de sete dias</h3>
        <p>
          Integrações observadas; o histórico anterior à integração pode estar
          incompleto. Rascunhos pendentes representam o estoque atual.
        </p>
        {weeklyError ? (
          <p role="alert">{weeklyError}</p>
        ) : !weekly ? (
          <p role="status">Carregando resumo…</p>
        ) : (
          <>
            <p>
              {editorialDate(weekly.from)} até {editorialDate(weekly.to)}
            </p>
            <dl className="editorial-metrics">
              {Object.entries(weekly.metrics).map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {
                      (
                        {
                          approvedReferences: "Referências aprovadas",
                          researchPackages: "Pacotes criados",
                          publishedArticles: "Artigos publicados",
                          pendingDrafts: "Rascunhos pendentes",
                          preparedNewsletters: "Newsletters preparadas",
                          integrationFailures: "Falhas de integração",
                        } as Record<string, string>
                      )[key]
                    }
                  </dt>
                  <dd>{value === null ? "Indisponível" : value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
    </section>
  );
}
