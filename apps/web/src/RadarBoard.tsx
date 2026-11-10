import { useEffect, useRef, useState } from "react";
import "./radar-board.css";
import { Heart, Clock, X, ExternalLink, Plus } from "lucide-react";
import RadarCountryCarousel from "./RadarCountryCarousel";
import type { Content, RadarStatus } from "../../../packages/contracts";
import { radarTriage } from "../../../packages/contracts";
import { createLastroClient } from "../../../packages/contracts/client";
import type { SearchQuery } from "../../../packages/contracts/client";
import { RadarHeadline } from "./RadarHeadline";
const api = createLastroClient();
const countries = new Intl.DisplayNames(["pt-BR"], { type: "region" });
const countryName = (code?: string | null) =>
  code ? (countries.of(code) ?? code) : "País não informado";
const triageLabels = {
  novidade: "Novidade",
  para_avaliar: "Para avaliar",
  favorito: "Favorito",
  descartado: "Descartado",
};
const categories = {
  art_visual_culture: "Arte",
  graphic_design: "Design",
  photo_illustration_motion: "Fotografia / Ilustração",
  architecture_objects: "Arquitetura",
  creative_technology: "Tecnologia criativa",
};
const day = (v: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(v));
const date = (v: string | null | undefined) =>
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
          hour: "2-digit",
          minute: "2-digit",
        })
      : "Não informada";
export default function RadarBoard({
  onSelect,
  onItemsChange,
  query,
}: {
  onSelect: (c: Content) => Promise<boolean>;
  onItemsChange?: (items: Content[]) => void;
  query?: SearchQuery;
}) {
  const [items, setItems] = useState<Content[]>([]),
    [status, setStatus] = useState<RadarStatus | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false);
  const scope = query?.kind === "paper" ? "scientific" : "editorial";
  const [sort, setSort] = useState<"novidade" | "relevancia">(() =>
    localStorage.getItem("lastro-radar-sort") === "relevancia"
      ? "relevancia"
      : "novidade",
  );
  useEffect(() => {
    localStorage.setItem("lastro-radar-sort", sort);
  }, [sort]);
  const [nextFeed, setNextFeed] = useState<string | null>(null);
  const [nextFavorites, setNextFavorites] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filters, setFilters] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("lastro-radar-filters") ?? '{"period":"week"}',
      ) as {
        search?: string;
        country?: string;
        category?: string;
        source?: string;
        language?: string;
        period?: string;
        triage?: string;
        unread?: boolean;
      };
    } catch {
      return {};
    }
  });
  const [detail, setDetail] = useState<Content | null>(null);
  const search = query?.q ?? query?.topic;
  const source = query?.sourceId;
  const useSearch = !!(search || source || query?.kind);
  const feedTriage = filters.triage === "descartado" ? "descartado" : undefined;
  useEffect(() => {
    localStorage.setItem("lastro-radar-filters", JSON.stringify(filters));
  }, [filters]);
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
          : api.feed({ limit: 50, scope, sort, triage: feedTriage }),
        api.favorites({ limit: 50, offset: 0 }),
        api.radarStatus().catch(() => null),
      ]);
      if (n !== generation.current) return;
      setItems([
        ...new Map(
          [
            ...page.items.map((i) => ("content" in i ? i.content : i)),
            ...saved.items,
          ].map((c) => [c.id, c]),
        ).values(),
      ]);
      setNextFeed(page.nextCursor);
      setNextFavorites(saved.nextCursor);
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
  }, [
    scope,
    sort,
    query?.q,
    query?.topic,
    query?.sourceId,
    query?.kind,
    feedTriage,
  ]);
  useEffect(() => onItemsChange?.(items), [items, onItemsChange]);
  async function loadMore() {
    if (loadingMore) return;
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
                sort,
                triage: feedTriage,
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
      if (saved) setNextFavorites(saved.nextCursor);
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
    action: "favorite" | "evaluate" | "new" | "discard" | "read",
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
    try {
      let updated: Content;
      if (action === "favorite") {
        if (c.state.favorite) {
          await api.unfavorite(c.id);
          updated = await api.content(c.id);
        } else updated = await api.favorite(c.id);
      } else if (action === "evaluate" || action === "new") {
        updated = await api.interact(c.id, {
          type: "seen",
          active: action === "evaluate",
        });
      } else {
        updated = await api.interact(c.id, {
          type: action === "discard" ? "dismissed" : "read",
          active: action === "discard" ? true : !c.state.read,
        });
      }
      patch(updated);
      setFeedback(
        action === "discard"
          ? "Referência descartada."
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
      setFeedback(
        "Ação não concluída. " +
          (e instanceof Error ? e.message : "Tente novamente."),
      );
      void load();
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
    (c) => (scope === "scientific") === (c.kind === "paper"),
  );
  const filtered = available.filter((c) => {
    const saved = c.state.favorite,
      expires =
        c.radar?.expiresAt ??
        new Date(
          Date.parse(c.radar?.firstSeenAt ?? c.collectedAt) + 9 * 86400000,
        ).toISOString();
    if (
      !saved &&
      ((c.state.dismissed && filters.triage !== "descartado") ||
        (scope === "editorial" &&
          (!!c.radar?.expiredAt || Date.parse(expires) <= Date.now())))
    )
      return false;
    const text =
      `${c.title} ${c.authors.map((a) => a.name).join(" ")} ${c.topics.join(" ")}`.toLocaleLowerCase();
    const today = day(new Date().toISOString());
    const weekStart = new Date(`${today}T00:00:00-03:00`);
    weekStart.setUTCDate(
      weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7),
    );
    const withinPeriod =
      saved ||
      filters.period === "all" ||
      !filters.period ||
      (filters.period === "today" &&
        !!c.publishedAt &&
        day(c.publishedAt) === today) ||
      (filters.period === "week" &&
        !!c.publishedAt &&
        Date.parse(c.publishedAt) >= weekStart.getTime()) ||
      (filters.period === "nine" &&
        !!c.publishedAt &&
        Date.parse(c.publishedAt) >= Date.now() - 9 * 86400000);
    return (
      (!source || c.sourceId === source) &&
      (!search || text.includes(search.toLocaleLowerCase())) &&
      (!filters.search || text.includes(filters.search.toLocaleLowerCase())) &&
      (!filters.country ||
        (c.radar?.country ?? "unknown") === filters.country) &&
      (!filters.category || c.radar?.category === filters.category) &&
      (!filters.source || c.sourceId === filters.source) &&
      (!filters.language || c.language === filters.language) &&
      (!filters.triage || radarTriage(c) === filters.triage) &&
      (!filters.unread || !c.state.read) &&
      withinPeriod
    );
  });
  const byCountry = new Map<string, Content[]>();
  for (const c of filtered) {
    const key = c.radar?.country ?? "unknown";
    const group = byCountry.get(key) ?? [];
    group.push(c);
    byCountry.set(key, group);
  }
  const groups = [...byCountry.entries()].sort(([a, first], [b, second]) => {
    if (a === b) return 0;
    if (a === "BR") return -1;
    if (b === "BR") return 1;
    return (
      second.length - first.length ||
      countryName(a).localeCompare(countryName(b), "pt-BR")
    );
  });
  const editorialSources = (status?.sources ?? []).filter(
    (s) => s.cycle === "daily",
  );
  const countryChoices = [
    ...new Set(available.map((c) => c.radar?.country ?? "unknown")),
  ];
  const sourceChoices = [
    ...new Map(available.map((c) => [c.sourceId, c.sourceName])).entries(),
  ];
  const languageChoices = [
    ...new Set(
      available.map((c) => c.language).filter((v): v is string => !!v),
    ),
  ];
  const setFilter = (key: string, value: string | boolean) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => {
    setFilters({ period: "week" });
    setSort("novidade");
  };
  const actions = (c: Content) => (
    <div className="radar-card-actions">
      <button
        disabled={busy}
        aria-pressed={c.state.favorite}
        title={c.state.favorite ? "Remover dos favoritos" : "Favoritar"}
        aria-label={`Favoritar ${c.title}`}
        onClick={() => void act(c, "favorite")}
      >
        <Heart size={16} />
      </button>
      <button
        disabled={busy}
        title={c.state.seen ? "Devolver às novidades" : "Avaliar depois"}
        aria-label={`Avaliar ${c.title}`}
        onClick={() => void act(c, c.state.seen ? "new" : "evaluate")}
      >
        <Clock size={16} />
      </button>
      <button
        disabled={busy}
        title="Descartar"
        aria-label={`Descartar ${c.title}`}
        onClick={() => void act(c, "discard")}
      >
        <X size={16} />
      </button>
      <a
        href={c.url}
        target="_blank"
        rel="noopener noreferrer"
        title="Abrir artigo original"
        aria-label={`Abrir original: ${c.title}`}
      >
        <ExternalLink size={16} />
      </a>
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
      <p className="radar-browse-hint">
        Explore por país. Arraste as matérias ou use as setas para continuar.
      </p>
      <div className="radar-filterbar" aria-label="Filtros do Radar">
        <label>
          Busca textual
          <input
            value={filters.search ?? ""}
            onChange={(e) => setFilter("search", e.target.value)}
            placeholder="Título, autoria ou tag"
          />
        </label>
        <label>
          País
          <select
            value={filters.country ?? ""}
            onChange={(e) => setFilter("country", e.target.value)}
          >
            <option value="">Todos</option>
            {countryChoices.map((code) => (
              <option key={code} value={code}>
                {countryName(code === "unknown" ? null : code)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoria
          <select
            value={filters.category ?? ""}
            onChange={(e) => setFilter("category", e.target.value)}
          >
            <option value="">Todas</option>
            {Object.entries(categories).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fonte
          <select
            value={filters.source ?? ""}
            onChange={(e) => setFilter("source", e.target.value)}
          >
            <option value="">Todas</option>
            {sourceChoices.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Idioma
          <select
            value={filters.language ?? ""}
            onChange={(e) => setFilter("language", e.target.value)}
          >
            <option value="">Todos</option>
            {languageChoices.map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Período
          <select
            value={filters.period ?? "week"}
            onChange={(e) => setFilter("period", e.target.value)}
          >
            <option value="today">Hoje</option>
            <option value="week">Esta semana</option>
            <option value="nine">Últimos nove dias</option>
            <option value="all">Todas as datas</option>
          </select>
        </label>
        <label>
          Estado de triagem
          <select
            value={filters.triage ?? ""}
            onChange={(e) => setFilter("triage", e.target.value)}
          >
            <option value="">Todos</option>
            <option value="novidade">Novidade</option>
            <option value="para_avaliar">Para avaliar</option>
            <option value="favorito">Favorito</option>
            <option value="descartado">Descartado</option>
          </select>
        </label>
        <label>
          Ordenação
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="novidade">Mais recentes</option>
            <option value="relevancia">Relevância</option>
          </select>
        </label>
        <label className="radar-filter-check">
          <input
            type="checkbox"
            checked={filters.unread ?? false}
            onChange={(e) => setFilter("unread", e.target.checked)}
          />
          Não lidos
        </label>
        <button type="button" onClick={clearFilters}>
          Limpar filtros
        </button>
      </div>
      <p role="status" className="radar-feedback">
        {feedback}
      </p>
      {error ? (
        <div role="alert" className="radar-empty">
          {error}
          <button onClick={() => void load()}>Tentar novamente</button>
        </div>
      ) : loading ? (
        <div
          className="radar-carousel-loading"
          aria-label="Carregando referências"
        >
          {[0, 1, 2].map((n) => (
            <div key={n} className="radar-skeleton" />
          ))}
        </div>
      ) : (
        <div className="radar-countries">
          {!groups.length && (
            <div className="radar-empty">Nenhuma referência neste recorte.</div>
          )}
          {groups.map(([code, cards]) => (
            <RadarCountryCarousel
              key={code}
              code={code}
              name={countryName(code === "unknown" ? null : code)}
              count={cards.length}
            >
              {cards.map((c) => (
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
                    <span>{triageLabels[radarTriage(c)]}</span>
                  </div>
                  <button className="radar-title" onClick={() => setDetail(c)}>
                    {c.imageUrl && (
                      <img
                        draggable={false}
                        src={c.imageUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <h4>
                      <RadarHeadline content={c} />
                    </h4>
                  </button>
                  <div className="radar-card-meta">
                    <span>
                      {c.radar?.category
                        ? categories[c.radar.category]
                        : (c.topics[0] ?? "Assunto não informado")}
                    </span>
                    <time>{date(c.publishedAt)}</time>
                  </div>
                  <div className="radar-card-state">
                    {radarTriage(c) === "para_avaliar" &&
                      scope === "editorial" && (
                        <p className="radar-deadline">
                          {Math.max(
                            0,
                            Math.ceil(
                              (Date.parse(
                                c.radar?.expiresAt ??
                                  new Date(
                                    Date.parse(c.collectedAt) + 9 * 86400000,
                                  ).toISOString(),
                              ) -
                                Date.now()) /
                                86400000,
                            ),
                          )}{" "}
                          dias restantes · não preservado
                        </p>
                      )}
                  </div>
                  {actions(c)}
                </article>
              ))}
            </RadarCountryCarousel>
          ))}
          {(nextFeed || nextFavorites) && (
            <button
              className="radar-load-more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? "Carregando…" : "Carregar mais matérias"}
            </button>
          )}
        </div>
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
              'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]',
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
