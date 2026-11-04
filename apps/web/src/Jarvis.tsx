import { commercialApi } from "./Opportunities";
import { loadJarvisState, invalidateJarvisClient } from "./jarvis-client";
import type {
  Answer,
  Intent,
  JarvisAction,
  JarvisState,
  Notice,
} from "../../../packages/contracts/jarvis";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Minus, X } from "lucide-react";
import { contextualSuggestion, type JarvisContext } from "./experience";
import { usePresence } from "./motion";
const preferenceKey = "lastro:jarvis:proactive";
function read(store: "localStorage" | "sessionStorage", key: string) {
  try {
    return window[store].getItem(key);
  } catch {
    return null;
  }
}
function write(
  store: "localStorage" | "sessionStorage",
  key: string,
  value: string,
) {
  try {
    window[store].setItem(key, value);
  } catch {
    /* Keep the in-memory preference when storage is unavailable. */
  }
}
export function JarvisMark() {
  return (
    <svg
      className="jarvis-mark"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="jarvis-halo"
        cx="24"
        cy="24"
        r="17"
        stroke="currentColor"
        strokeWidth=".6"
        opacity=".24"
      />
      <g className="jarvis-orbit">
        <ellipse
          cx="24"
          cy="24"
          rx="21"
          ry="10"
          stroke="currentColor"
          strokeWidth="1.1"
        />
        <circle cx="45" cy="24" r="2.4" fill="currentColor" />
      </g>
      <g className="jarvis-orbit counter">
        <ellipse
          cx="24"
          cy="24"
          rx="10"
          ry="21"
          stroke="currentColor"
          strokeWidth=".8"
          opacity=".6"
        />
        <circle cx="24" cy="3" r="1.6" fill="currentColor" />
      </g>
      <circle
        className="jarvis-core"
        cx="24"
        cy="24"
        r="5"
        fill="currentColor"
      />
    </svg>
  );
}
export default function Jarvis({
  context,
  onAction,
}: {
  context: JarvisContext;
  onAction: (action: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(
    () => read("localStorage", "lastro:jarvis:enabled") !== "false",
  );
  const [proactive, setProactive] = useState(
    () => read("localStorage", preferenceKey) !== "false",
  );
  const [hint, setHint] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { ref: panelRef, visible: panelVisible } = usePresence<HTMLDivElement>(
    open,
    "translateY(8px) scale(.98)",
  );
  const { ref: hintRef, visible: hintVisible } = usePresence<HTMLDivElement>(
    hint && !open,
    "translateY(6px) scale(.98)",
  );
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [state, setState] = useState<JarvisState | null>(null),
    [notice, setNotice] = useState<Notice | null>(null),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<Answer | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const savingPreferences = useRef(false);
  const claiming = useRef(false),
    lastOffered = useRef<string | null>(null),
    stateRef = useRef<JarvisState | null>(null);
  const suggestion = contextualSuggestion(context);
  const interrupted = () =>
    document.visibilityState !== "visible" ||
    context.area === "oficina" ||
    !!document.querySelector('[role="dialog"], [aria-busy="true"]') ||
    !!document.activeElement?.matches(
      'input,textarea,select,[contenteditable="true"]',
    );
  useEffect(() => {
    let active = true;
    async function check() {
      if (document.visibilityState !== "visible" || savingPreferences.current)
        return;
      let ownsClaim = false;
      try {
        const next = await loadJarvisState();
        if (!active) return;
        stateRef.current = next;
        setState(next);
        setEnabled(next.preferences.enabled);
        setProactive(next.preferences.proactive);
        // Allow the initial workspace to settle; no extra data request is made.
        await new Promise((resolve) => setTimeout(resolve, 800));
        if (!active || claiming.current) return;
        const candidate = next.notices[0];
        if (
          !next.preferences.enabled ||
          !next.preferences.proactive ||
          !candidate ||
          open ||
          interrupted() ||
          lastOffered.current === candidate.id
        )
          return;
        claiming.current = true;
        ownsClaim = true;
        const result = await commercialApi("jarvis/notices", {
          method: "POST",
          body: JSON.stringify({ id: candidate.id, operation: "shown" }),
        });
        if (active && result.allowed) {
          lastOffered.current = candidate.id;
          setNotice(candidate);
          if (!interrupted()) setHint(true);
        }
      } catch {
        if (active) setHint(false);
        if (active)
          setError(
            "Jarvis indisponível. Seus dados e preferências foram preservados.",
          );
      } finally {
        if (ownsClaim) claiming.current = false;
      }
    }
    void check();
    const timer = setInterval(() => void check(), 300000);
    const visibility = () => {
      if (document.visibilityState === "visible") void check();
      else setHint(false);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [context.area, open]);
  useEffect(() => {
    if (context.area === "oficina") setHint(false);
    const dismissOnEdit = (event: FocusEvent) => {
      if (
        (event.target as Element)?.matches(
          "input,textarea,select,[contenteditable='true']",
        )
      )
        setHint(false);
    };
    document.addEventListener("focusin", dismissOnEdit);
    return () => document.removeEventListener("focusin", dismissOnEdit);
  }, [context.area]);
  async function dismissHint(operation: "dismiss" | "snooze" = "dismiss") {
    setHint(false);
    if (!notice) return;
    try {
      await commercialApi("jarvis/notices", {
        method: "POST",
        body: JSON.stringify({ id: notice.id, operation }),
      });
      invalidateJarvisClient();
      setState((s) =>
        s ? { ...s, notices: s.notices.filter((n) => n.id !== notice.id) } : s,
      );
      setNotice(null);
    } catch {
      setError("Não foi possível salvar a dispensa. Tente novamente.");
    }
  }
  async function preferences(patch: {
    enabled?: boolean;
    proactive?: boolean;
    communication?: "formal" | "discreto";
  }) {
    const current = stateRef.current?.preferences;
    if (!current) {
      setError("Aguarde a leitura das preferências antes de alterar.");
      return;
    }
    if (savingPreferences.current) return;
    savingPreferences.current = true;
    setError("");
    if (patch.proactive !== undefined) setProactive(patch.proactive);
    try {
      const next = await commercialApi("jarvis/preferences", {
        method: "PATCH",
        body: JSON.stringify({ ...current, ...patch, area: context.area }),
      });
      stateRef.current = { ...stateRef.current!, preferences: next };
      setState(stateRef.current);
      setEnabled(next.enabled);
      setProactive(next.proactive);
      write("localStorage", "lastro:jarvis:enabled", String(next.enabled));
      write("localStorage", preferenceKey, String(next.proactive));
      invalidateJarvisClient();
      if (!next.enabled) setOpen(false);
      setHint(false);
    } catch {
      setProactive(current.proactive);
      setEnabled(current.enabled);
      setError("Não foi possível salvar as preferências.");
    } finally {
      savingPreferences.current = false;
    }
  }
  async function ask(choice?: Intent) {
    if (busy || !question.trim()) return;
    setBusy(true);
    setError("");
    setActionLink(null);
    try {
      setAnswer(
        await commercialApi("jarvis/query", {
          method: "POST",
          body: JSON.stringify({ text: question, area: context.area, choice }),
        }),
      );
    } catch {
      setError(
        "Não foi possível consultar os dados. Nenhuma ação foi executada.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function act(action: JarvisAction) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const resolved = await commercialApi("jarvis/actions", {
        method: "POST",
        body: JSON.stringify(action),
      });
      if (resolved.url) {
        setActionLink(resolved.url);
        return;
      }
      if (action.kind === "opportunity.open" && action.target)
        sessionStorage.setItem("jarvis:opportunity", action.target);
      close();
      onAction(resolved.navigation);
      if (action.kind === "opportunity.open" && action.target) {
        window.dispatchEvent(
          new CustomEvent("jarvis:opportunity", { detail: action.target }),
        );
      }
      if (action.kind === "article.open" && action.target) {
        window.dispatchEvent(
          new CustomEvent("jarvis:article", { detail: action.target }),
        );
      }
    } catch {
      setError("A ação não está disponível. Consulte novamente os dados.");
    } finally {
      setBusy(false);
    }
  }
  const close = () => {
    setOpen(false);
    toggleRef.current?.focus({ preventScroll: true });
  };
  const show = () => {
    setOpen(true);
    setHint(false);
  };
  useEffect(() => {
    if (open)
      panelRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]'))
        close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!enabled)
    return (
      <aside className="jarvis-dock is-disabled" aria-label="Assistente Jarvis">
        <span>Jarvis desativado</span>
        <button
          className="secondary-button"
          onClick={() => {
            void preferences({ enabled: true });
          }}
        >
          Reativar Jarvis
        </button>
      </aside>
    );
  return (
    <aside
      className={`jarvis-dock ${open ? "is-open" : ""} ${hint ? "has-suggestion" : ""}`}
      aria-label="Assistente Jarvis"
    >
      <button
        ref={toggleRef}
        className="jarvis-toggle"
        aria-expanded={open}
        aria-controls="jarvis-panel"
        onClick={() => (open ? close() : show())}
      >
        <JarvisMark />
        <span>
          Jarvis<span className="jarvis-caption">Seu próximo caminho</span>
        </span>
        <span className="jarvis-signal" aria-hidden="true" />
        {open ? <Minus size={16} /> : <ArrowUpRight size={16} />}
      </button>
      {hintVisible && (
        <div
          ref={hintRef}
          className="jarvis-hint"
          inert={!hint || open}
          aria-hidden={!hint || open || undefined}
        >
          <p>{notice?.text}</p>
          <button onClick={show}>Revisar com Jarvis</button>
          <button onClick={() => void dismissHint("snooze")}>
            Adiar 24 horas
          </button>
          <button
            aria-label="Dispensar sugestão"
            onClick={() => void dismissHint()}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {panelVisible && (
        <div
          id="jarvis-panel"
          ref={panelRef}
          className="jarvis-panel"
          aria-hidden={!open || undefined}
          inert={!open}
          role="region"
          aria-label="Painel Jarvis"
        >
          <div className="jarvis-heading">
            <JarvisMark />
            <span>À disposição, com os fatos.</span>
            <button aria-label="Minimizar Jarvis" onClick={close}>
              <Minus size={18} />
            </button>
          </div>
          <form
            className="jarvis-query"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <label htmlFor="jarvis-question">Consultar o ecossistema</label>
            <input
              id="jarvis-question"
              maxLength={500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Quais oportunidades estão atrasadas?"
            />
            <button
              className="primary-button"
              disabled={busy || !question.trim()}
            >
              Consultar
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
          {actionLink && (
            <p>
              <a href={actionLink} target="_blank" rel="noopener noreferrer">
                Abrir destino revisado ↗
              </a>
            </p>
          )}
          {answer && (
            <section className="jarvis-answer" aria-live="polite">
              <p>{answer.text}</p>
              <small>
                {answer.source} · {answer.period.label}
                <br />
                Sincronização:{" "}
                {answer.syncedAt
                  ? new Date(answer.syncedAt).toLocaleString("pt-BR")
                  : "indisponível"}
                {answer.stale ? " · Dados desatualizados" : ""}
                {answer.incomplete ? " · Cobertura incompleta" : ""}
              </small>
              {answer.choices?.map((c) => (
                <button
                  disabled={busy}
                  key={c.intent}
                  onClick={() => void ask(c.intent)}
                >
                  {c.label}
                </button>
              ))}
              {answer.action && (
                <button
                  disabled={busy}
                  onClick={() => void act(answer.action!)}
                >
                  Revisar ação
                </button>
              )}
            </section>
          )}
          {!!state?.notices.length && (
            <section aria-label="Prioridades">
              <h3>Prioridades</h3>
              {state.notices.slice(0, 5).map((n) => (
                <article key={n.id}>
                  <p>{n.text}</p>
                  <button disabled={busy} onClick={() => void act(n.action)}>
                    Revisar
                  </button>
                  <button
                    onClick={() => {
                      setNotice(n);
                      void commercialApi("jarvis/notices", {
                        method: "POST",
                        body: JSON.stringify({
                          id: n.id,
                          operation: "dismiss",
                        }),
                      })
                        .then(() => {
                          invalidateJarvisClient();
                          setState((s) =>
                            s
                              ? {
                                  ...s,
                                  notices: s.notices.filter(
                                    (x) => x.id !== n.id,
                                  ),
                                }
                              : s,
                          );
                        })
                        .catch(() =>
                          setError("Não foi possível salvar a dispensa."),
                        );
                    }}
                  >
                    Dispensar
                  </button>
                  <button
                    onClick={() => {
                      void commercialApi("jarvis/notices", {
                        method: "POST",
                        body: JSON.stringify({ id: n.id, operation: "snooze" }),
                      })
                        .then(() => {
                          invalidateJarvisClient();
                          setState((s) =>
                            s
                              ? {
                                  ...s,
                                  notices: s.notices.filter(
                                    (x) => x.id !== n.id,
                                  ),
                                }
                              : s,
                          );
                        })
                        .catch(() =>
                          setError("Não foi possível adiar o alerta."),
                        );
                    }}
                  >
                    Adiar 24h
                  </button>
                </article>
              ))}
            </section>
          )}
          <div className="jarvis-suggestion" key={suggestion.action}>
            <span className="kicker">Um ponto de partida</span>
            <h3>{suggestion.title}</h3>
            <p>{suggestion.body}</p>
            <button
              className="primary-button"
              onClick={() =>
                void act(
                  suggestion.action === "queue"
                    ? { kind: "references.open", target: "queue" }
                    : suggestion.action.startsWith("open-studio:")
                      ? {
                          kind: "studio.continue",
                          target: suggestion.action.slice(12),
                        }
                      : {
                          kind:
                            suggestion.action === "opportunities"
                              ? "opportunity.open"
                              : suggestion.action === "newsletters"
                                ? "newsletters.open"
                                : suggestion.action === "publications"
                                  ? "integration.review"
                                  : suggestion.action === "studio"
                                    ? "workshop.prepare"
                                    : "references.open",
                        },
                )
              }
            >
              {suggestion.label}
              <ArrowUpRight size={16} />
            </button>
          </div>
          <label className="jarvis-preference">
            <input
              type="checkbox"
              checked={proactive}
              onChange={(e) => {
                void preferences({ proactive: e.target.checked });
              }}
            />
            Receber sugestões espontâneas
          </label>
          <button
            className="quiet-link"
            onClick={() => {
              void preferences({ enabled: false });
            }}
          >
            Desativar Jarvis
          </button>
          <label className="jarvis-preference">
            Comunicação
            <select
              value={state?.preferences.communication || "discreto"}
              onChange={(e) =>
                void preferences({
                  communication: e.target.value as "formal" | "discreto",
                })
              }
            >
              <option value="discreto">Formal, com humor discreto</option>
              <option value="formal">Apenas os fatos</option>
            </select>
          </label>
          <small>
            Modo determinístico. IA desativada; nenhum consumo de inferência.
            Perguntas não são armazenadas.
          </small>
        </div>
      )}
    </aside>
  );
}
