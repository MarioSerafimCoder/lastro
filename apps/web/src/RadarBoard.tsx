import { useEffect, useRef, useState } from "react";
import "./radar-board.css";
import { Heart, Ellipsis, X, ExternalLink, Plus } from "lucide-react";
import type { Content, RadarStatus } from "../../../packages/contracts";
import { radarTriage } from "../../../packages/contracts";
import { createLastroClient } from "../../../packages/contracts/client";
import type { SearchQuery } from "../../../packages/contracts/client";
import { RadarHeadline } from "./RadarHeadline";
const api = createLastroClient();
const formats = {
  news: "Notícia",
  article: "Artigo",
  opinion: "Opinião",
  paper: "Estudo científico",
  case_study: "Estudo de caso",
  visual_reference: "Referência visual",
  post: "Publicação",
  magazine: "Revista",
  other: "Referência",
};
const format = (c: Content) =>
  (c.kind === "article" || c.kind === "post") &&
  c.topics.some((topic) =>
    /^(blog|blog post|post de blog)$/i.test(topic.trim()),
  )
    ? "Blog"
    : formats[c.kind];
const categories = {
  art_visual_culture: "Arte",
  graphic_design: "Design",
  photo_illustration_motion: "Fotografia / Ilustração",
  architecture_objects: "Arquitetura",
  creative_technology: "Tecnologia criativa",
};
const date = (v: string | null | undefined, dateOnly = false) =>
  v?.length === 10
    ? new Date(v + "T12:00:00Z").toLocaleDateString("pt-BR", {
        timeZone: "America/Fortaleza",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : v
      ? new Date(v).toLocaleString("pt-BR", {
          timeZone: "America/Fortaleza",
          day: "2-digit",
          month: "short",
          year: "numeric",
          ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
        })
      : "Não informada";
export default function RadarBoard({
  onSelect,
  onItemsChange,
  query,
  onClearSearch,
}: {
  onSelect: (c: Content) => Promise<boolean>;
  onItemsChange?: (items: Content[]) => void;
  query?: SearchQuery;
  onClearSearch: () => void;
}) {
  const [items, setItems] = useState<Content[]>([]),
    [status, setStatus] = useState<RadarStatus | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false);
  const scope = query?.kind === "paper" ? "scientific" : "editorial";
  const [nextFeed, setNextFeed] = useState<string | null>(null);
  const [nextFavorites, setNextFavorites] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [discarded, setDiscarded] = useState<Content | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState<Content | null>(null);
  const search = query?.q ?? query?.topic;
  const source = query?.sourceId;
  const useSearch = !!(search || source || query?.kind);
  const dialog = useRef<HTMLDialogElement>(null),
    generation = useRef(0);
  async function load() {
    const n = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [page, saved, health] = await Promise.all([
        useSearch
          ? api.search({ ...query, limit: 50, offset: 0 })
          : api.feed({ limit: 50, scope, sort: "relevancia" }),
        useSearch ? null : api.favorites({ limit: 50, offset: 0 }),
        api.radarStatus().catch(() => null),
      ]);
      if (n !== generation.current) return;
      setItems([
        ...new Map(
          [
            ...page.items.map((i) => ("content" in i ? i.content : i)),
            ...(saved?.items ?? []),
          ].map((c) => [c.id, c]),
        ).values(),
      ]);
      setNextFeed(page.nextCursor);
      setNextFavorites(saved?.nextCursor ?? null);
      setStatus(health);
    } catch (e) {
      if (n === generation.current)
        setError(e instanceof Error ? e.message : "Falha ao carregar Radar");
    } finally {
      if (n === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [scope, query?.q, query?.topic, query?.sourceId, query?.kind]);
  useEffect(() => onItemsChange?.(items), [items, onItemsChange]);
  async function loadMore() {
    if (loading || loadingMore) return;
    const requestGeneration = generation.current;
    setLoadingMore(true);
    try {
      const [page, saved] = await Promise.all([
        nextFeed
          ? useSearch
            ? api.search({ ...query, limit: 50, offset: Number(nextFeed) })
            : api.feed({
                limit: 50,
                scope,
                sort: "relevancia",
                cursor: nextFeed,
              })
          : null,
        nextFavorites
          ? api.favorites({ limit: 50, offset: Number(nextFavorites) })
          : null,
      ]);
      if (requestGeneration !== generation.current) return;
      setItems((current) => [
        ...new Map([
          ...current.map((c) => [c.id, c] as const),
          ...(page?.items.map((i) => {
            const content = "content" in i ? i.content : i;
            return [content.id, content] as const;
          }) ?? []),
          ...(saved?.items.map((c) => [c.id, c] as const) ?? []),
        ]).values(),
      ]);
      if (page) setNextFeed(page.nextCursor);
      if (saved) setNextFavorites(saved?.nextCursor ?? null);
    } catch (e) {
      setFeedback(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar mais referências.",
      );
    } finally {
      setLoadingMore(false);
    }
  }
  useEffect(() => {
    if (detail && !dialog.current?.open) dialog.current?.showModal();
  }, [detail?.id]);
  useEffect(() => {
    const timer = window.setInterval(() => setItems((p) => [...p]), 60000);
    return () => clearInterval(timer);
  }, []);
  const patch = (c: Content) => {
    setItems((p) => p.map((v) => (v.id === c.id ? c : v)));
    setDetail((p) => (p?.id === c.id ? c : p));
  };
  async function act(
    c: Content,
    action: "favorite" | "evaluate" | "new" | "discard" | "undo" | "read",
  ) {
    if (action === "discard" && c.state.favorite) {
      setFeedback(
        "Remova dos Favoritos antes de descartar esta referência. Favoritos são preservados no acervo.",
      );
      return;
    }
    if (action === "new" && c.state.selected) {
      setFeedback(
        "Remova a seleção da Oficina no painel de detalhes para devolver às novidades.",
      );
      return;
    }
    if (busy) return;
    setBusy(true);
    setFeedback("");
    const optimistic = action === "favorite" || action === "undo";
    if (optimistic) {
      patch({
        ...c,
        state: {
          ...c.state,
          favorite:
            action === "favorite" ? !c.state.favorite : c.state.favorite,
          dismissed: action === "undo" ? false : c.state.dismissed,
        },
      });
    }
    try {
      let updated: Content;
      if (action === "favorite") {
        if (c.state.favorite) {
          await api.unfavorite(c.id);
          updated = { ...c, state: { ...c.state, favorite: false } };
        } else updated = await api.favorite(c.id);
      } else if (action === "evaluate" || action === "new") {
        updated = await api.interact(c.id, {
          type: "seen",
          active: action === "evaluate",
        });
      } else {
        updated = await api.interact(c.id, {
          type: action === "read" ? "read" : "dismissed",
          active: action === "read" ? !c.state.read : action === "discard",
        });
      }
      patch(updated);
      if (action === "discard") {
        setDiscarded(updated);
        if (detail?.id === c.id) dialog.current?.close();
        requestAnimationFrame(() => undoButton.current?.focus());
      }
      if (action === "undo") {
        setDiscarded(null);
        if (!items.some((item) => item.id === c.id)) void load();
        requestAnimationFrame(() =>
          document
            .getElementById(`content-${c.id}`)
            ?.querySelector<HTMLButtonElement>(".radar-title")
            ?.focus(),
        );
      }
      setFeedback(
        action === "discard"
          ? "Referência descartada."
          : action === "undo"
            ? "Referência restaurada."
            : action === "evaluate"
              ? "Movida para avaliar. O prazo de retenção continua."
              : action === "new"
                ? "Devolvida às novidades."
                : action === "read"
                  ? "Estado de leitura atualizado."
                  : updated.state.favorite
                    ? "Preservada nos Favoritos e Salvos."
                    : "Removida dos Favoritos.",
      );
    } catch (e) {
      if (optimistic) patch(c);
      setFeedback(
        "Ação não concluída. " +
          (e instanceof Error ? e.message : "Tente novamente."),
      );
    } finally {
      setBusy(false);
    }
  }
  async function selectWorkshop(c: Content) {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    try {
      if (!(await onSelect(c)))
        throw new Error("Seleção da Oficina não confirmada. Tente novamente.");
      patch(await api.content(c.id));
      setFeedback("Seleção da Oficina atualizada.");
    } catch (e) {
      setFeedback(
        "Ação não concluída. " +
          (e instanceof Error ? e.message : "Tente novamente."),
      );
      void load();
    } finally {
      setBusy(false);
    }
  }
  const available = items.filter(
    (c) => useSearch || (scope === "scientific") === (c.kind === "paper"),
  );
  const visible = available.filter(
    (c) =>
      c.state.favorite ||
      (!c.state.dismissed &&
        (c.kind === "paper" ||
          (!c.radar?.expiredAt &&
            (c.radar?.expiresAt
              ? Date.parse(c.radar.expiresAt)
              : Date.parse(c.collectedAt) + 9 * 86400000) > Date.now()))),
  );
  const editorialSources = (status?.sources ?? []).filter(
    (s) => s.cycle === "daily",
  );
  const actions = (c: Content) => (
    <div className="radar-card-actions">
      <button
        disabled={busy}
        aria-pressed={c.state.favorite}
        aria-label={`${c.state.favorite ? "Remover dos salvos" : "Salvar"} ${c.title}`}
        onClick={() => void act(c, "favorite")}
      >
        <Heart size={16} aria-hidden="true" />
        {c.state.favorite ? "Salvo" : "Salvar"}
      </button>
      <a href={c.url} target="_blank" rel="noopener noreferrer">
        Ler original <ExternalLink size={14} aria-hidden="true" />
      </a>
      <details
        className="radar-more"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !event.currentTarget.open) return;
          event.stopPropagation();
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }}
      >
        <summary aria-label={`Mais ações: ${c.title}`}>
          <Ellipsis size={18} aria-hidden="true" />
        </summary>
        <div>
          <button
            disabled={busy}
            onClick={(event) => {
              event.currentTarget
                .closest("details")
                ?.querySelector("summary")
                ?.focus();
              event.currentTarget.closest("details")?.removeAttribute("open");
              void act(c, c.state.seen ? "new" : "evaluate");
            }}
          >
            {c.state.seen ? "Devolver às novidades" : "Avaliar depois"}
          </button>
          <button
            disabled={busy}
            onClick={(event) => {
              event.currentTarget
                .closest("details")
                ?.querySelector("summary")
                ?.focus();
              event.currentTarget.closest("details")?.removeAttribute("open");
              void act(c, "discard");
            }}
          >
            Descartar
          </button>
        </div>
      </details>
    </div>
  );
  return (
    <section
      className="radar-board"
      aria-label="Mesa editorial"
      aria-busy={loading}
    >
      <div className="section-heading">
        <div>
          <span className="kicker">RADAR / MESA EDITORIAL</span>
          <h2>
            Um olhar em movimento<span className="asterisk">✳</span>
          </h2>
        </div>
        <div className="radar-actions">
          <button disabled={loading} onClick={() => void load()}>
            Atualizar
          </button>
        </div>
      </div>
      <div className="radar-pulse" aria-label="Pulso editorial">
        {status ? (
          <>
            <span>
              Coleta <strong>{date(status.lastEditorialCheck)}</strong>
            </span>
            <span>
              Descobertas na semana{" "}
              <strong>{status.health?.discoveredThisWeek ?? "—"}</strong>
            </span>
            <span>
              Ainda por avaliar{" "}
              <strong>
                {
                  available.filter(
                    (c) =>
                      !c.state.favorite &&
                      !c.state.seen &&
                      !c.state.selected &&
                      !c.state.dismissed,
                  ).length
                }{" "}
                carregadas
              </strong>
            </span>
            <span>
              Pendentes de ingestão / revisão{" "}
              <strong>{status.health?.pending ?? "—"}</strong>
            </span>
            <span>
              Fontes com falha{" "}
              <strong>{status.health?.failedSources ?? "—"}</strong>
            </span>
            {editorialSources.filter((s) => s.lastSuccessAt).length > 0 &&
              editorialSources
                .filter((s) => s.lastSuccessAt)
                .every((s) => s.state === "no_new_entries") && (
                <span>Nenhuma matéria nova na última coleta editorial.</span>
              )}
            <span>
              Última descoberta{" "}
              <strong>
                {date(
                  editorialSources
                    .map((s) => s.lastNewReferenceAt)
                    .filter((v): v is string => !!v)
                    .sort()
                    .at(-1),
                )}
              </strong>
            </span>
          </>
        ) : (
          "Pulso indisponível. Não foi possível verificar a atualização."
        )}
      </div>
      {useSearch && (
        <div className="radar-search-context">
          <span>
            Resultados para{" "}
            <strong>
              {search ??
                status?.sources.find((s) => s.id === source)?.name ??
                "referências"}
            </strong>
          </span>
          <button onClick={onClearSearch}>Limpar pesquisa</button>
        </div>
      )}
      <div className="radar-feedback">
        <span role="status">{feedback}</span>
        {discarded && (
          <button
            ref={undoButton}
            disabled={busy}
            onClick={() => void act(discarded, "undo")}
          >
            Desfazer descarte
          </button>
        )}
      </div>
      {error ? (
        <div role="alert" className="radar-empty">
          {error}
          <button onClick={() => void load()}>Tentar novamente</button>
        </div>
      ) : loading ? (
        <div className="radar-grid" aria-label="Carregando referências">
          {[0, 1, 2].map((n) => (
            <div key={n} className="radar-skeleton" />
          ))}
        </div>
      ) : (
        <>
          {!visible.length && (
            <div className="radar-empty">
              {useSearch
                ? "Nenhum resultado. Tente outro título, autor, fonte ou assunto."
                : "Nenhuma referência disponível no momento."}
            </div>
          )}
          <div className="radar-grid">
            {visible.map((c) => (
              <article
                key={c.id}
                className="radar-compact"
                data-testid="radar-card"
                data-reference-id={c.id}
                data-triage={radarTriage(c)}
                id={`content-${c.id}`}
                tabIndex={-1}
              >
                <div className="radar-origin">
                  {c.sourceName}
                  <span>{format(c)}</span>
                </div>
                <h3>
                  <button className="radar-title" onClick={() => setDetail(c)}>
                    {c.imageUrl && (
                      <img
                        src={c.imageUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <RadarHeadline content={c} />
                  </button>
                </h3>
                <div className="radar-card-meta">
                  <span>
                    {c.topics[0] ??
                      (c.radar?.category
                        ? categories[c.radar.category]
                        : "Assunto não informado")}
                  </span>
                  {c.publishedAt ? (
                    <time dateTime={c.publishedAt}>
                      {date(c.publishedAt, true)}
                    </time>
                  ) : (
                    <span>Data não informada</span>
                  )}
                </div>
                {radarTriage(c) === "para_avaliar" && (
                  <p className="radar-deadline">Para avaliar</p>
                )}
                {actions(c)}
              </article>
            ))}
          </div>
          {(nextFeed || nextFavorites) && (
            <button
              className="radar-load-more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Carregando…" : "Carregar mais matérias"}
            </button>
          )}
        </>
      )}
      <dialog
        ref={dialog}
        className="radar-detail"
        onClose={() => {
          const id = detail?.id;
          setDetail(null);
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLButtonElement>(
                `[data-reference-id="${id}"] .radar-title`,
              )
              ?.focus(),
          );
        }}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        aria-labelledby="radar-detail-title"
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const controls = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],summary,input:not(:disabled),select:not(:disabled),[tabindex="0"]',
            ),
          ].filter((el) => el.getClientRects().length > 0);
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        {detail && (
          <>
            <button
              autoFocus
              className="radar-close"
              onClick={() => dialog.current?.close()}
              aria-label="Fechar detalhes"
            >
              <X size={20} />
            </button>
            <span className="kicker">
              {detail.sourceName} /{" "}
              {detail.radar?.country ?? "Origem não informada"}
            </span>
            <h2 id="radar-detail-title">
              <RadarHeadline content={detail} showOriginal />
            </h2>
            <p>
              {detail.authors.map((a) => a.name).join(", ") ||
                "Autoria não informada"}
            </p>
            <p>
              Publicação {date(detail.publishedAt)}
              <br />
              Descoberta {date(detail.radar?.firstSeenAt ?? detail.collectedAt)}
              <br />
              Aprovação editorial {date(detail.radar?.approvedAt)}
              <br />
              Última coleta bem-sucedida da fonte{" "}
              {date(
                status?.sources?.find((s) => s.id === detail.sourceId)
                  ?.lastSuccessAt,
              )}
              <br />
              Expiração{" "}
              {detail.state.favorite
                ? "Preservada nos Salvos"
                : date(detail.radar?.expiresAt)}
            </p>
            <p>
              {detail.synopsis?.text ??
                "Metadados verificados. Não há sinopse autorizada e validada disponível."}
            </p>
            <p>{detail.topics.join(" · ")}</p>
            {detail.synopsis?.evidenceUrl && (
              <a
                href={detail.synopsis.evidenceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Procedência da sinopse
              </a>
            )}
            {actions(detail)}
            <button disabled={busy} onClick={() => void selectWorkshop(detail)}>
              {" "}
              <Plus size={16} /> Selecionar / remover da Oficina
            </button>
            <button disabled={busy} onClick={() => void act(detail, "read")}>
              {detail.state.read ? "Marcar não lido" : "Marcar lido"}
            </button>
            <a href={detail.url} target="_blank" rel="noopener noreferrer">
              Ler artigo original ↗
            </a>
          </>
        )}
      </dialog>
    </section>
  );
}
