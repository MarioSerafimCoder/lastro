import { useEffect, useRef, useState } from "react";
import { createLastroClient } from "../../../packages/contracts/client";
import type {
  EditorialOverview,
  EditorialRun,
  EditorialRunStatus,
} from "../../../packages/contracts/editorial-autopilot";
import { evidenceLabel } from "../../../packages/contracts/editorial-article";
import { editorialDate } from "./Ecosystem";

const api = createLastroClient();
const statuses: Record<EditorialRunStatus, string> = {
  scheduled: "Na fila",
  researching: "Pesquisando",
  generating: "Redigindo",
  validating: "Verificando o artigo",
  sending: "Enviando ao Studio",
  draft_created: "Rascunho criado",
  needs_review: "Revisão necessária",
  failed: "Falha",
  skipped: "Sem geração",
};
const processing = (run: EditorialRun) =>
  ["scheduled", "researching", "generating", "validating", "sending"].includes(
    run.status,
  );
const date = (value: string) => value.split("-").reverse().join("/");

function RunDetails({ run }: { run: EditorialRun }) {
  return (
    <>
      <p>
        {statuses[run.status]}
        {run.theme && ` · ${run.theme}`}
      </p>
      {run.reason && <p>{run.reason}</p>}
      {run.retryAt && (
        <p>Nova tentativa a partir de {editorialDate(run.retryAt)}.</p>
      )}
      {run.sources.length > 0 && (
        <ol className="autopilot-sources" aria-label="Fontes consultadas">
          {run.sources.map((source) => (
            <li key={source.contentId}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
              <small>
                {source.publication} · {evidenceLabel(source.kind)}
              </small>
            </li>
          ))}
        </ol>
      )}
      {run.studio && (
        <a
          className="text-button"
          href={run.studio.adminUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir no Studio ↗
        </a>
      )}
    </>
  );
}

export default function EditorialAutopilot() {
  const [data, setData] = useState<EditorialOverview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [action, setAction] = useState("");
  const lock = useRef(false);
  const load = async () => {
    setData(await api.editorialOverview());
    setError("");
  };
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (lock.current || document.visibilityState === "hidden") return;
      try {
        const overview = await api.editorialOverview();
        if (active && !lock.current) {
          setData(overview);
          setError("");
        }
      } catch (err) {
        if (active && !lock.current)
          setError(
            err instanceof Error ? err.message : "Consulta indisponível.",
          );
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const perform = async (label: string, operation: () => Promise<string>) => {
    if (lock.current) return;
    lock.current = true;
    setAction(label);
    setError("");
    setMessage("");
    try {
      setMessage(await operation());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operação indisponível.");
    } finally {
      lock.current = false;
      setAction("");
    }
  };
  const busy = !!action;
  const latest = data?.history[0];
  const lastArticle =
    data?.history.find((run) => run.title) ?? data?.latestDraft;
  return (
    <section
      className="page-section ecosystem editorial-autopilot"
      aria-label="Execuções editoriais"
    >
      <div className="section-heading autopilot-actions" aria-busy={busy}>
        <button
          className="primary-button"
          disabled={
            !data?.available || busy || (!!latest && processing(latest))
          }
          onClick={() => {
            if (window.confirm("Iniciar a execução editorial de hoje?"))
              void perform("Processando execução…", async () => {
                const run = await api.queueEditorialRun();
                return run.status === "scheduled"
                  ? "Execução na fila. O processamento ocorre no próximo ciclo de integração."
                  : `Execução de ${date(run.date)} · ${statuses[run.status]}.`;
              });
          }}
        >
          Executar agora
        </button>
        <button
          className="secondary-button"
          disabled={(!data?.available && !data?.enabled) || busy}
          onClick={() => {
            const enable = !data?.enabled;
            if (
              window.confirm(
                enable
                  ? "Ativar a execução diária às 08:00 de Fortaleza?"
                  : "Desativar as próximas execuções diárias?",
              )
            )
              void perform("Salvando configuração…", async () => {
                await api.setEditorialAutomation(enable);
                return enable ? "Automação ativada." : "Automação desativada.";
              });
          }}
        >
          {data?.enabled ? "Desativar" : "Ativar"} automação
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void perform("Atualizando…", async () => "")}
        >
          Atualizar
        </button>
      </div>
      {action && <p role="status">{action}</p>}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Carregando execuções…</p>}
      {data && (
        <>
          <dl className="pub-card editorial-metrics autopilot-metrics">
            <div>
              <dt>Automação diária</dt>
              <dd>
                {!data.available
                  ? "Indisponível"
                  : data.enabled
                    ? "Ativa"
                    : "Desativada"}
              </dd>
            </div>
            <div>
              <dt>Próxima execução · Fortaleza</dt>
              <dd>
                {data.nextExecution ? editorialDate(data.nextExecution) : "—"}
              </dd>
            </div>
            <div>
              <dt>Última execução</dt>
              <dd>{latest ? date(latest.date) : "—"}</dd>
            </div>
          </dl>
          {!data.available && (
            <p className="notice">
              A execução requer Workers AI e a integração com o Studio
              configurados.
            </p>
          )}
          {lastArticle && (
            <article className="pub-card">
              <h2>Artigo mais recente</h2>
              <h3>{lastArticle.title}</h3>
              <RunDetails run={lastArticle} />
            </article>
          )}
          <section className="pub-card" aria-labelledby="editorial-history">
            <h2 id="editorial-history">Histórico editorial</h2>
            {data.history.length === 0 && <p>Nenhuma execução registrada.</p>}
            <ul className="editorial-list">
              {data.history.map((run) => (
                <li key={run.id}>
                  <strong>
                    <time dateTime={run.date}>{date(run.date)}</time>
                    {run.title && ` · ${run.title}`}
                  </strong>
                  <RunDetails run={run} />
                  {run.canRetry && (
                    <button
                      className="secondary-button"
                      disabled={!data.available || busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Reprocessar a execução de ${date(run.date)}?`,
                          )
                        )
                          void perform("Reprocessando execução…", async () => {
                            const retried = await api.retryEditorialRun(run.id);
                            return `Reprocessamento · ${statuses[retried.status]}.`;
                          });
                      }}
                    >
                      Reprocessar falha
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
