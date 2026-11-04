import { useEffect, useRef, useState } from "react";
import "./radar-board.css";
import {
  Heart,
  Clock,
  X,
  ExternalLink,
  Plus,
  Columns3,
  List,
} from "lucide-react";
import type {
  Content,
  RadarStatus,
  RadarFeedQuery,
} from "../../../packages/contracts";
import { radarTriage } from "../../../packages/contracts";
import { createLastroClient } from "../../../packages/contracts/client";
const api = createLastroClient();
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
  query,
}: {
  onSelect: (c: Content) => Promise<boolean>;
  query?: { q?: string; topic?: string; sourceId?: string; kind?: string };
}) {
  const [items, setItems] = useState<Content[]>([]),
    [status, setStatus] = useState<RadarStatus | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"editorial" | "scientific">("editorial"),
    [sort, setSort] = useState<RadarFeedQuery["sort"]>("novidade"),
    [list, setList] = useState(false),
    [detail, setDetail] = useState<Content | null>(null);
  const [period, setPeriod] = useState("week"),
    [category, setCategory] = useState(""),
    [country, setCountry] = useState(""),
    [source, setSource] = useState(""),
    [language, setLanguage] = useState(""),
    [unread, setUnread] = useState(false),
    [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    generation = useRef(0);
  useEffect(() => {
    setSearch(query?.q ?? query?.topic ?? "");
    setSource(query?.sourceId ?? "");
    if (query?.kind)
      setScope(query.kind === "paper" ? "scientific" : "editorial");
  }, [query?.q, query?.topic, query?.sourceId, query?.kind]);
  async function load() {
    const n = ++generation.current;
    setLoading(true);
    setError("");
    try {
      let page = await api.feed({ limit: 50, scope, sort });
      const fresh = page.items.map((i) => i.content);
      while (page.nextCursor && fresh.length < 500) {
        page = await api.feed({
          limit: 50,
          scope,
          sort,
          cursor: page.nextCursor,
        });
        fresh.push(...page.items.map((i) => i.content));
      }
      let saved = await api.favorites({ limit: 50, offset: 0 });
      const favorites = [...saved.items];
      while (saved.nextCursor && favorites.length < 500) {
        saved = await api.favorites({
          limit: 50,
          offset: Number(saved.nextCursor),
        });
        favorites.push(...saved.items);
      }
      const health = await api.radarStatus().catch(() => null);
      if (n !== generation.current) return;
      setItems([
        ...new Map([...fresh, ...favorites].map((c) => [c.id, c])).values(),
      ]);
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
  }, [scope, sort]);
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
        if (c.state.favorite) await api.unfavorite(c.id);
        updated = await api.interact(c.id, {
          type: "seen",
          active: action === "evaluate",
        });
      } else {
        if (action === "discard" && c.state.favorite)
          await api.unfavorite(c.id);
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
  const clear = () => {
    setPeriod(scope === "scientific" ? "all" : "week");
    setCategory("");
    setCountry("");
    setSource("");
    setLanguage("");
    setUnread(false);
    setSearch("");
  };
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
      (c.state.dismissed ||
        (scope === "editorial" &&
          (!!c.radar?.expiredAt || Date.parse(expires) <= Date.now())))
    )
      return false;
    return (
      (!category || c.radar?.category === category) &&
      (!country || c.radar?.country === country) &&
      (!source || c.sourceId === source) &&
      (!language || c.language === language) &&
      (!unread || !c.state.read) &&
      (period !== "week" ||
        scope !== "scientific" ||
        (!!c.publishedAt &&
          (() => {
            const d = new Date(
              day(new Date().toISOString()) + "T00:00:00-03:00",
            );
            d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
            return Date.parse(c.publishedAt) >= d.getTime();
          })())) &&
      (!search ||
        `${c.title} ${c.authors.map((a) => a.name).join(" ")} ${c.topics.join(" ")}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase())) &&
      (period !== "today" ||
        (!!c.publishedAt &&
          day(c.publishedAt) === day(new Date().toISOString()))) &&
      (period !== "nine" ||
        (!!c.publishedAt &&
          Date.parse(c.publishedAt) >= Date.now() - 9 * 86400000))
    );
  });
  const choices = (key: "country" | "source" | "language") => [
    ...new Map(
      available
        .map((c) =>
          key === "source"
            ? [c.sourceId, c.sourceName]
            : key === "country"
              ? [c.radar?.country, c.radar?.country]
              : [c.language, c.language],
        )
        .filter(([v]) => v) as [string, string][],
    ).entries(),
  ];
  const editorialSources = (status?.sources ?? []).filter(
    (s) => s.cycle === "daily",
  );
  const actions = (c: Content) => (
    <div className="radar-card-actions">
      <button
        disabled={busy}
        aria-pressed={c.state.favorite}
        aria-label={`Favoritar ${c.title}`}
        onClick={() => void act(c, "favorite")}
      >
        <Heart size={16} />
      </button>
      <button
        disabled={busy}
        aria-label={`Avaliar ${c.title}`}
        onClick={() => void act(c, c.state.seen ? "new" : "evaluate")}
      >
        <Clock size={16} />
      </button>
      <button
        disabled={busy}
        aria-label={`Descartar ${c.title}`}
        onClick={() => void act(c, "discard")}
      >
        <X size={16} />
      </button>
      <a
        href={c.url}
        target="_blank"
        rel="noopener noreferrer"
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
          <button onClick={() => setList(!list)} aria-pressed={list}>
            {list ? <Columns3 size={16} /> : <List size={16} />}{" "}
            {list ? "Ver colunas" : "Lista densa"}
          </button>
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
      <div className="radar-filterbar">
        <label>
          Recorte
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as typeof scope);
              clear();
              setPeriod(e.target.value === "scientific" ? "all" : "week");
            }}
          >
            <option value="editorial">Radar Diário</option>
            <option value="scientific">Radar Científico</option>
          </select>
        </label>
        <label>
          Período
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {scope === "scientific" && (
              <option value="all">Todas as datas</option>
            )}
            <option value="today">Hoje</option>
            <option value="week">Esta semana</option>
            <option value="nine">Últimos nove dias</option>
          </select>
        </label>
        <label>
          Assunto
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todos os assuntos</option>
            {Object.entries(categories).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {(["country", "source", "language"] as const).map((key, i) => (
          <label key={key}>
            {["País", "Fonte", "Idioma"][i]}
            <select
              value={[country, source, language][i]}
              onChange={(e) =>
                [setCountry, setSource, setLanguage][i](e.target.value)
              }
            >
              <option value="">Todos</option>
              {choices(key).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
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
        <label>
          Pesquisa
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Título, autoria ou tag"
          />
        </label>
        <label className="radar-check">
          <input
            type="checkbox"
            checked={unread}
            onChange={(e) => setUnread(e.target.checked)}
          />{" "}
          Não lidos
        </label>
        <button onClick={clear}>Limpar filtros</button>
      </div>
      <p className="radar-scope-note">
        {scope === "editorial"
          ? "Diário: publicações da semana civil em Fortaleza. O recorte de nove dias não amplia essa janela; Favoritos incluem o acervo preservado."
          : "Científico: critérios e datas próprios, sem expiração editorial."}{" "}
        Fotografia e ilustração compartilham um assunto. Até 500 referências por
        recorte e 500 favoritos.
      </p>
      <p role="status" className="radar-feedback">
        {feedback}
      </p>
      {error ? (
        <div role="alert" className="radar-empty">
          {error}
          <button onClick={() => void load()}>Tentar novamente</button>
        </div>
      ) : loading ? (
        <div className="radar-columns" aria-label="Carregando referências">
          {[0, 1, 2].map((n) => (
            <div key={n} className="radar-skeleton" />
          ))}
        </div>
      ) : (
        <div className={`radar-columns ${list ? "radar-dense" : ""}`}>
          {(["novidade", "para_avaliar", "favorito"] as const).map(
            (state, i) => {
              const cards = filtered.filter((c) => radarTriage(c) === state);
              return (
                <section
                  key={state}
                  className="radar-column"
                  aria-label={["Novidades", "Para avaliar", "Favoritos"][i]}
                >
                  <header>
                    <h3>{["Novidades", "Para avaliar", "Favoritos"][i]}</h3>
                    <span>{cards.length}</span>
                  </header>
                  <p>
                    {
                      [
                        "Descobrir e separar",
                        "Retenção de nove dias continua",
                        "Preservados na biblioteca Salvos",
                      ][i]
                    }
                  </p>
                  {!cards.length ? (
                    <div className="radar-empty">
                      Nenhuma referência neste recorte.
                    </div>
                  ) : (
                    cards.map((c) => (
                      <article
                        key={c.id}
                        className="radar-compact"
                        data-testid="radar-card"
                        data-reference-id={c.id}
                        id={`content-${c.id}`}
                        tabIndex={-1}
                      >
                        <div className="radar-origin">
                          {c.sourceName}{" "}
                          <span>
                            {c.radar?.country ?? "País não informado"}
                          </span>
                        </div>
                        <button
                          className="radar-title"
                          onClick={() => setDetail(c)}
                        >
                          {c.imageUrl && (
                            <img
                              src={c.imageUrl}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          )}
                          <h4>{c.title}</h4>
                        </button>
                        <div className="radar-card-meta">
                          <span>
                            {c.radar?.category
                              ? categories[c.radar.category]
                              : (c.topics[0] ?? "Assunto não informado")}
                          </span>
                          <time>{date(c.publishedAt)}</time>
                        </div>
                        {state === "para_avaliar" && scope === "editorial" && (
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
                        {actions(c)}
                      </article>
                    ))
                  )}
                </section>
              );
            },
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
            <h2 id="radar-detail-title">{detail.title}</h2>
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
