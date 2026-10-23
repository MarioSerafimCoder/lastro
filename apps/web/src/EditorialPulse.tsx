import { useEffect, useRef, useState } from "react";
import { createLastroClient } from "../../../packages/contracts/client";
import type { RadarStatus } from "../../../packages/contracts";

const api = createLastroClient();
const markerKey = "lastro-editorial-visit";
const cacheKey = "lastro-editorial-pulse";
const interval = 5 * 60 * 1000;
const date = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function EditorialPulse({
  onExplore,
}: {
  onExplore: (ids: string[]) => Promise<void>;
}) {
  const [since] = useState(() => {
    const stored = localStorage.getItem(markerKey);
    if (stored && Number.isFinite(Date.parse(stored))) return stored;
    const initial = new Date().toISOString();
    localStorage.setItem(markerKey, initial);
    return initial;
  });
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const checked = useRef(0);
  useEffect(() => {
    let active = true;
    let fetching = false;
    const check = async () => {
      if (
        document.hidden ||
        fetching ||
        Date.now() - checked.current < interval
      )
        return;
      try {
        const cached = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
        if (cached?.since === since && Date.now() - cached.at < interval) {
          checked.current = cached.at;
          if (active) setStatus(cached.status);
          return;
        }
      } catch {
        /* A missing cache never prevents a real check. */
      }
      fetching = true;
      checked.current = Date.now();
      try {
        const value = await api.radarStatus(since);
        setStatus(value);
        setError(false);
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({ since, at: checked.current, status: value }),
        );
      } catch {
        setError(true);
      } finally {
        fetching = false;
      }
    };
    void check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [since]);
  const updated = [status?.lastEditorialCheck, status?.lastScientificRound]
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);
  const count = status?.newApprovals ?? 0;
  return (
    <aside className="editorial-pulse" aria-label="Pulso editorial">
      <div className="pulse-label">
        <span
          className={`activity-dot ${count ? "has-news" : ""}`}
          aria-hidden="true"
        />
        PULSO EDITORIAL
      </div>
      <div className="pulse-copy">
        <strong>
          {status
            ? count
              ? `${count} ${count === 1 ? "nova referência" : "novas referências"} desde sua última conferência`
              : "Você está em dia com o Radar"
            : error
              ? "Atividade indisponível no momento"
              : "Conferindo o Radar…"}
        </strong>
        <span>
          {updated
            ? `Radar atualizado em ${date(updated)}`
            : status
              ? "Atualização ainda não registrada"
              : ""}
        </span>
        {!!status?.recentTopics?.length && (
          <span className="pulse-topics">
            Nas novidades:{" "}
            {status.recentTopics.map((topic) => topic.name).join(" · ")}
          </span>
        )}
        {actionError && (
          <span role="alert">
            Não foi possível abrir as novidades. Tente novamente.
          </span>
        )}
      </div>
      {count > 0 && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setActionError(false);
            try {
              await onExplore(status?.newContentIds ?? []);
              localStorage.setItem(markerKey, status!.checkedAt);
              sessionStorage.removeItem(cacheKey);
            } catch {
              setActionError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Abrindo…" : "Ver novidades"}
        </button>
      )}
    </aside>
  );
}
