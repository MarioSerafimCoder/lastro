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
  const offered = useRef(
    read("sessionStorage", "lastro:jarvis:offered") === "true",
  );
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { ref: panelRef, visible: panelVisible } = usePresence<HTMLDivElement>(
    open,
    "translateY(8px) scale(.98)",
  );
  const { ref: hintRef, visible: hintVisible } = usePresence<HTMLDivElement>(
    hint && !open,
    "translateY(6px) scale(.98)",
  );
  const suggestion = contextualSuggestion(context);
  const dismissHint = () => {
    setHint(false);
  };
  const close = () => {
    setOpen(false);
    toggleRef.current?.focus({ preventScroll: true });
  };
  const show = () => {
    setOpen(true);
    setHint(false);
  };
  useEffect(() => {
    if (context.area !== "for-you") setHint(false);
  }, [context.area]);
  useEffect(() => {
    if (
      !enabled ||
      !proactive ||
      offered.current ||
      context.area !== "for-you" ||
      !context.available
    )
      return;
    offered.current = true;
    write("sessionStorage", "lastro:jarvis:offered", "true");
    setHint(true);
  }, [enabled, proactive, context.area, context.available]);
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
            setEnabled(true);
            write("localStorage", "lastro:jarvis:enabled", "true");
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
          <p>Quer explorar uma referência diferente?</p>
          <button onClick={show}>Explorar com Jarvis</button>
          <button aria-label="Dispensar sugestão" onClick={dismissHint}>
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
            <span>Uma provocação, um caminho.</span>
            <button aria-label="Minimizar Jarvis" onClick={close}>
              <Minus size={18} />
            </button>
          </div>
          <div className="jarvis-suggestion" key={suggestion.action}>
            <span className="kicker">Um ponto de partida</span>
            <h3>{suggestion.title}</h3>
            <p>{suggestion.body}</p>
            <button
              className="primary-button"
              onClick={() => {
                close();
                onAction(suggestion.action);
              }}
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
                setProactive(e.target.checked);
                write("localStorage", preferenceKey, String(e.target.checked));
                setHint(false);
              }}
            />
            Receber sugestões espontâneas
          </label>
          <button
            className="quiet-link"
            onClick={() => {
              setEnabled(false);
              setOpen(false);
              setHint(false);
              write("localStorage", "lastro:jarvis:enabled", "false");
            }}
          >
            Desativar Jarvis
          </button>
          <small>Contexto e regras do Lastro. Sem IA generativa.</small>
        </div>
      )}
    </aside>
  );
}
