import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Minus, X } from "lucide-react";
import { contextualSuggestion, type JarvisContext } from "./experience";

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
    /* Private mode: keep in-memory preference. */
  }
}
export function JarvisMark() {
  return (
    <svg
      className="jarvis-mark"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="5" fill="currentColor" />
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="8"
        stroke="currentColor"
        strokeWidth="1.5"
        transform="rotate(-35 16 16)"
      />
      <circle cx="25" cy="7" r="2.5" fill="currentColor" />
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
  const suggestion = contextualSuggestion(context);
  useEffect(() => {
    if (context.area !== "for-you") setHint(false);
  }, [context.area]);
  useEffect(() => {
    // Only offer on an idle Radar with real content, never during a form or reading.
    if (
      !enabled ||
      !proactive ||
      offered.current ||
      context.area !== "for-you" ||
      context.available === 0
    )
      return;
    offered.current = true;
    write("sessionStorage", "lastro:jarvis:offered", "true");
    setHint(true);
  }, [enabled, proactive, context.area, context.available]);
  if (!enabled)
    return (
      <aside className="jarvis-dock">
        <p>Jarvis desativado</p>
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
    <aside className="jarvis-dock" aria-label="Assistente Jarvis">
      <button
        className="jarvis-toggle"
        aria-expanded={open}
        aria-controls="jarvis-panel"
        onClick={() => {
          setOpen(!open);
          setHint(false);
        }}
      >
        <JarvisMark />
        <span>Jarvis</span>
        <span className="jarvis-caption">Seu próximo caminho</span>
        {open ? <Minus size={16} /> : <ArrowUpRight size={16} />}
      </button>
      {hint && !open && (
        <div className="jarvis-hint">
          <p>Quer explorar uma referência diferente?</p>
          <button
            onClick={() => {
              setOpen(true);
              setHint(false);
            }}
          >
            Explorar com Jarvis
          </button>
          <button
            aria-label="Dispensar sugestão"
            onClick={() => setHint(false)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {open && (
        <div id="jarvis-panel" className="jarvis-panel">
          <div className="jarvis-heading">
            <span>Uma provocação, um caminho.</span>
            <button
              aria-label="Minimizar Jarvis"
              onClick={() => setOpen(false)}
            >
              <Minus size={16} />
            </button>
          </div>
          <h3>{suggestion.title}</h3>
          <p>{suggestion.body}</p>
          <button
            className="primary-button"
            onClick={() => {
              onAction(suggestion.action);
            }}
          >
            {suggestion.label}
            <ArrowUpRight size={16} />
          </button>
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
