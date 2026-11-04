import JarvisMemory from "./JarvisMemory";
import { jarvisApi as commercialApi } from "./jarvis-client";
import {
  loadJarvisState,
  invalidateJarvisClient,
  clearJarvisSession,
} from "./jarvis-client";
import type {
  Answer,
  Intent,
  JarvisAction,
  JarvisState,
  Notice,
} from "../../../packages/contracts/jarvis";
import type {
  DialogueView,
  DialogueReply,
} from "../../../packages/contracts/jarvis-dialogue";
import { JarvisRequestError } from "./jarvis-client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Minus, X } from "lucide-react";
import type { JarvisContext } from "./experience";
import { usePresence } from "./motion";
type Message = {
  id: string;
  question: string;
  answer?: Answer;
  error?: string;
};
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
  const [messages, setMessages] = useState<Message[]>([]);
  const conversation = useRef<DialogueView | null>(null);
  const pendingSend = useRef(false);
  const initializing = useRef<Promise<DialogueView> | null>(null);
  async function currentConversation(): Promise<DialogueView> {
    if (conversation.current) return conversation.current;
    if (!initializing.current) {
      initializing.current = commercialApi("jarvis/conversation")
        .then((next: DialogueView) => {
          if (sessionAlive.current) conversation.current = next;
          return next;
        })
        .finally(() => {
          initializing.current = null;
        });
    }
    return initializing.current!;
  }
  const [restoredQuestion, setRestoredQuestion] = useState("");
  const followLatest = useRef(true);
  const sessionAlive = useRef(true),
    request = useRef<AbortController | null>(null),
    inputRef = useRef<HTMLTextAreaElement>(null),
    logRef = useRef<HTMLDivElement>(null);
  async function clearConversation() {
    if (pendingSend.current || busy) return;
    pendingSend.current = true;
    setBusy(true);
    try {
      const current = await currentConversation();
      conversation.current = await commercialApi("jarvis/conversation", {
        method: "DELETE",
        body: JSON.stringify({
          conversationId: current.id,
          revision: current.revision,
        }),
      });
    } catch {
      if (sessionAlive.current) {
        conversation.current = null;
        setError(
          "Não foi possível limpar. Tente novamente para recuperar o contexto atual.",
        );
        setBusy(false);
      }
      pendingSend.current = false;
      return;
    }
    if (!sessionAlive.current) return;
    pendingSend.current = false;
    setRestoredQuestion("");
    request.current?.abort();
    request.current = null;
    setMessages([]);
    setQuestion("");
    setAnswer(null);
    setActionLink(null);
    setError("");
    setBusy(false);
    inputRef.current?.focus();
  }
  useEffect(() => {
    const logout = () => {
      sessionAlive.current = false;
      preferenceRequest.current?.abort();
      request.current?.abort();
      clearJarvisSession();
      conversation.current = null;
      setRestoredQuestion("");
      setMessages([]);
      setQuestion("");
      setAnswer(null);
      setActionLink(null);
      setNotice(null);
      setState(null);
      stateRef.current = null;
      setHint(false);
      setOpen(false);
      setEnabled(false);
      setError("");
    };
    window.addEventListener("jarvis:logout", logout);
    return () => {
      request.current?.abort();
      window.removeEventListener("jarvis:logout", logout);
    };
  }, []);
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [state, setState] = useState<JarvisState | null>(null),
    [notice, setNotice] = useState<Notice | null>(null),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<Answer | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (logRef.current && (followLatest.current || (open && !messages.length)))
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, busy, open]);
  const preferenceRequest = useRef<AbortController | null>(null);
  const savingPreferences = useRef(false);
  const claiming = useRef(false),
    lastOffered = useRef<string | null>(null),
    stateRef = useRef<JarvisState | null>(null);
  const interrupted = () =>
    document.visibilityState !== "visible" ||
    !document.hasFocus() ||
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
        if (!active || !sessionAlive.current) return;
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
        if (active && sessionAlive.current && result.allowed) {
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
    const blur = () => setHint(false);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
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
    const preferenceController = new AbortController();
    preferenceRequest.current = preferenceController;
    setError("");
    if (patch.proactive !== undefined) setProactive(patch.proactive);
    try {
      const next = await commercialApi("jarvis/preferences", {
        signal: preferenceController.signal,
        method: "PATCH",
        body: JSON.stringify({ ...current, ...patch, area: context.area }),
      });
      if (!sessionAlive.current || preferenceController.signal.aborted) return;
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
      if (!sessionAlive.current || preferenceController.signal.aborted) return;
      setProactive(current.proactive);
      setEnabled(current.enabled);
      setError("Não foi possível salvar as preferências.");
    } finally {
      savingPreferences.current = false;
    }
  }
  async function ask(choice?: Intent, text = question) {
    if (busy || !text.trim() || !sessionAlive.current) return;
    if (pendingSend.current) return;
    pendingSend.current = true;
    followLatest.current = true;
    const controller = new AbortController();
    request.current = controller;
    const id = crypto.randomUUID();
    setMessages((m) => [...m.slice(-29), { id, question: text }]);
    setQuestion("");
    setBusy(true);
    setError("");
    setActionLink(null);
    try {
      const current = await currentConversation();
      if (controller.signal.aborted || !sessionAlive.current) return;
      const response: DialogueReply = await commercialApi(
        "jarvis/conversation",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            text,
            area: context.area,
            conversationId: current.id,
            revision: current.revision,
          }),
        },
      );
      if (controller.signal.aborted || !sessionAlive.current) return;
      conversation.current = response.conversation;
      setRestoredQuestion("");
      setAnswer(response);
      setMessages((m) =>
        m.map((item) =>
          item.id === id ? { ...item, answer: response } : item,
        ),
      );
    } catch (failure) {
      if (!controller.signal.aborted && sessionAlive.current) {
        conversation.current = null;
        const conflict =
          failure instanceof JarvisRequestError && failure.status === 409;
        if (conflict) {
          try {
            conversation.current = await commercialApi("jarvis/conversation", {
              signal: controller.signal,
            });
          } catch {}
        }
        setMessages((m) =>
          m.map((item) =>
            item.id === id
              ? {
                  ...item,
                  error: conflict
                    ? "A conversa mudou em outra aba ou expirou. Recarreguei o contexto; envie a mensagem novamente."
                    : "A consulta está indisponível. Nenhuma ação foi executada.",
                }
              : item,
          ),
        );
      }
    } finally {
      if (request.current === controller) {
        pendingSend.current = false;
        setBusy(false);
        request.current = null;
      }
    }
  }
  async function act(action: JarvisAction) {
    if (busy) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const resolved = await commercialApi("jarvis/actions", {
        signal: controller.signal,
        method: "POST",
        body: JSON.stringify(action),
      });
      if (controller.signal.aborted || !sessionAlive.current) return;
      if (resolved.url) {
        show();
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
      if (!controller.signal.aborted && sessionAlive.current)
        setError("A ação não está disponível. Consulte novamente os dados.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
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
    if (!open || conversation.current) return;
    let active = true;
    currentConversation()
      .then((next: DialogueView) => {
        if (!active || !sessionAlive.current || pendingSend.current) return;
        if (next.restored)
          setRestoredQuestion(
            next.pending?.question ||
              "Retomei o contexto desta sessão. Pode continuar de onde parou.",
          );
      })
      .catch(() => {
        if (active && sessionAlive.current)
          setError("Não consegui recuperar o contexto. Tente novamente.");
      });
    return () => {
      active = false;
    };
  }, [open]);
  useEffect(() => {
    if (open)
      panelRef.current
        ?.querySelector<HTMLTextAreaElement>("textarea")
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
          <button onClick={() => notice && void act(notice.action)}>
            Revisar ação
          </button>
          <button onClick={() => void dismissHint("snooze")}>Depois</button>
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
          className="jarvis-panel jarvis-chat"
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
          <div className="jarvis-chat-tools">
            <span>Sessão atual · sem IA</span>
            <button
              onClick={clearConversation}
              disabled={
                busy || (!messages.length && !question && !restoredQuestion)
              }
            >
              Limpar conversa
            </button>
          </div>
          <div
            className="jarvis-messages"
            ref={logRef}
            tabIndex={0}
            onScroll={(e) => {
              const el = e.currentTarget;
              followLatest.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            }}
            role="log"
            aria-label="Conversa com Jarvis"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {restoredQuestion && <p role="status">{restoredQuestion}</p>}
            {!messages.length && !restoredQuestion && (
              <div className="jarvis-welcome">
                <span className="kicker">JARVIS / À DISPOSIÇÃO</span>
                <h3>Estou por aqui.</h3>
                <p>
                  Posso consultar o ecossistema e preparar o próximo passo. A
                  decisão continua sendo sua.
                </p>
              </div>
            )}
            {messages.map((message) => (
              <div className="jarvis-turn" key={message.id}>
                <article className="jarvis-message is-user" aria-label="Você">
                  <span>Você</span>
                  <p>{message.question}</p>
                </article>
                {message.answer && (
                  <article
                    className="jarvis-message is-assistant"
                    aria-label="Resposta do Jarvis"
                  >
                    <span>Jarvis</span>
                    <p>{message.answer.text}</p>
                    <small>
                      {message.answer.source} · {message.answer.period.label}
                      {message.answer.kind !== "social" && (
                        <>
                          <br />
                          Sincronização:{" "}
                          {message.answer.syncedAt
                            ? new Date(message.answer.syncedAt).toLocaleString(
                                "pt-BR",
                              )
                            : "indisponível"}
                          {message.answer.stale
                            ? " · Dados desatualizados"
                            : ""}
                          {message.answer.incomplete
                            ? " · Cobertura incompleta"
                            : ""}
                        </>
                      )}
                    </small>
                    {message.answer.action && (
                      <button
                        disabled={busy}
                        onClick={() => void act(message.answer!.action!)}
                      >
                        Revisar ação
                      </button>
                    )}
                  </article>
                )}
                {message.error && (
                  <article className="jarvis-message is-assistant" role="alert">
                    <p>{message.error}</p>
                    <button
                      disabled={busy}
                      onClick={() => void ask(undefined, message.question)}
                    >
                      Tentar novamente
                    </button>
                  </article>
                )}
              </div>
            ))}
            {busy && (
              <p role="status" className="jarvis-loading">
                Consultando os dados…
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            {actionLink && (
              <p>
                <a href={actionLink} target="_blank" rel="noopener noreferrer">
                  Abrir destino revisado ↗
                </a>
              </p>
            )}
            <JarvisMemory />
            <details className="jarvis-settings">
              <summary>Preferências e contexto</summary>
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
            </details>
          </div>
          <form
            className="jarvis-query"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <label className="sr-only" htmlFor="jarvis-question">
              Consultar o ecossistema
            </label>
            <textarea
              ref={inputRef}
              id="jarvis-question"
              rows={2}
              maxLength={500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void ask();
                }
              }}
              placeholder="Fale comigo…"
            />
            <button
              className="primary-button"
              disabled={busy || !question.trim()}
            >
              Enviar
            </button>
            <small>Enter envia · Shift+Enter quebra linha</small>
          </form>

          <small className="jarvis-footnote">
            Modo determinístico. IA desativada; nenhum consumo de inferência.
            Contexto temporário da sessão; apenas memórias selecionadas são
            persistidas.
          </small>
        </div>
      )}
    </aside>
  );
}
