import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Filter,
  Heart,
  Layers2,
  Menu,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  createLastroClient,
  LastroApiError,
  type Collection,
  type SearchQuery,
} from "../../../packages/contracts/client";
import type {
  Content,
  FeedItem,
  FeedPage,
  PromptResponse,
  ResearchInput,
  Source,
} from "../../../packages/contracts";

const api = createLastroClient();
type Area = "for-you" | "salvos" | "oficina" | "publicacoes";
const areas: { id: Area; label: string; index: string }[] = [
  { id: "for-you", label: "For You", index: "01" },
  { id: "salvos", label: "Salvos", index: "02" },
  { id: "oficina", label: "Oficina", index: "03" },
  { id: "publicacoes", label: "Publicações", index: "04" },
];
const navArea = (): Area => {
  const path = location.pathname.slice(1);
  return areas.some((a) => a.id === path) ? (path as Area) : "for-you";
};
const kindName: Record<Content["kind"], string> = {
  news: "Notícia",
  article: "Artigo",
  paper: "Pesquisa",
  case_study: "Estudo de caso",
  visual_reference: "Referência visual",
  post: "Post",
  magazine: "Revista",
  other: "Referência",
};
const knowledgeName = {
  scientific_evidence: "Evidência científica",
  editorial_interpretation: "Interpretação editorial",
  application_hypothesis: "Hipótese de aplicação",
};
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(value))
    : "Data não informada";
const errorText = (err: unknown) =>
  err instanceof LastroApiError
    ? `${err.message}${err.body.error.requestId ? ` · Ref. ${err.body.error.requestId.slice(0, 8)}` : ""}`
    : err instanceof Error
      ? err.message
      : "Não foi possível concluir a operação.";
function IconButton({
  label,
  onClick,
  active,
  children,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "is-active" : ""}`}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">L.</span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function Loading({ count = 3 }: { count?: number }) {
  return (
    <div
      className="card-grid"
      aria-label="Carregando conteúdos"
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton" key={i}>
          <div />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="notice error" role="alert">
      <div>
        <strong>Não foi possível carregar.</strong>
        <p>{message}</p>
      </div>
      <button className="text-button" onClick={onRetry}>
        Tentar novamente <ArrowRight size={16} />
      </button>
    </div>
  );
}
function Cover({
  item,
  featured = false,
}: {
  item: Content;
  featured?: boolean;
}) {
  const initials = item.sourceName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div
      className={`cover ${featured ? "cover-large" : ""}`}
      aria-label={`Identidade gráfica de ${item.sourceName}; imagem da fonte indisponível`}
    >
      <span>{initials}</span>
      <span className="cover-orbit" />
      <small>{kindName[item.kind]}</small>
    </div>
  );
}
type CardProps = {
  item: Content;
  explanation?: FeedItem["explanation"];
  onFavorite: (c: Content) => void;
  onSelect: (c: Content) => void;
  onDismiss?: (c: Content) => void;
  onRead: (c: Content) => void;
  onOpen: (c: Content) => void;
  onNote?: (c: Content) => void;
  busy: boolean;
  featured?: boolean;
};
function ContentCard({
  item,
  explanation,
  onFavorite,
  onSelect,
  onDismiss,
  onRead,
  onOpen,
  onNote,
  busy,
  featured = false,
}: CardProps) {
  const [why, setWhy] = useState(false);
  const author = item.authors
    .map((a) => a.name.replace(/^.*\((.*)\)$/, "$1"))
    .join(", ");
  return (
    <article className={`content-card ${featured ? "featured" : ""}`}>
      <Cover item={item} featured={featured} />
      <div className="card-copy">
        <div className="eyebrow">
          <span>{item.sourceName}</span>
          <span className="dot">·</span>
          <span>{kindName[item.kind]}</span>
        </div>
        <a
          className="article-link"
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onOpen(item)}
        >
          <h3>{item.title}</h3>
          <ExternalLink size={featured ? 20 : 17} aria-hidden="true" />
        </a>
        <p className="description">
          {item.description ??
            "A fonte não forneceu um resumo autorizado. Consulte o conteúdo na origem."}
        </p>
        <div className="byline">
          <span>{author || "Autoria não informada"}</span>
          <span>{date(item.publishedAt)}</span>
        </div>
        <div className="badges">
          {item.annotations.map((a) => (
            <span key={a.id} className="badge">
              {knowledgeName[a.classification]}
            </span>
          ))}
          {item.state.read && <span className="badge subtle">Lido</span>}
          {item.editorialStatus !== "approved" && (
            <span className="badge caution">Fora do índice</span>
          )}
        </div>
        <div className="card-bottom">
          <div className="card-actions">
            <IconButton
              label={
                item.state.favorite ? "Remover dos salvos" : "Salvar referência"
              }
              onClick={() => onFavorite(item)}
              active={item.state.favorite}
              disabled={busy}
            >
              <Heart
                size={18}
                fill={item.state.favorite ? "currentColor" : "none"}
              />
            </IconButton>
            <IconButton
              label={
                item.state.selected
                  ? "Remover da Oficina"
                  : "Selecionar para a Oficina"
              }
              onClick={() => onSelect(item)}
              active={item.state.selected}
              disabled={
                busy ||
                (!item.state.selected && item.editorialStatus !== "approved")
              }
            >
              <Plus size={19} />
            </IconButton>
            <IconButton
              label={
                item.state.read ? "Marcar como não lido" : "Marcar como lido"
              }
              onClick={() => onRead(item)}
              active={item.state.read}
              disabled={busy}
            >
              <BookOpen size={18} />
            </IconButton>
            {onNote && (
              <IconButton
                label="Editar nota pessoal"
                onClick={() => onNote(item)}
              >
                <BookOpen size={17} />
              </IconButton>
            )}
          </div>
          <div className="minor-actions">
            {explanation && (
              <button
                className="quiet-link"
                type="button"
                onClick={() => setWhy((v) => !v)}
                aria-expanded={why}
              >
                Por que estou vendo? <ChevronDown size={14} />
              </button>
            )}
            {onDismiss && (
              <button
                className="quiet-link"
                type="button"
                onClick={() => onDismiss(item)}
              >
                Não me interessa
              </button>
            )}
          </div>
        </div>
        {why && explanation && (
          <div className="why" role="region">
            <strong>Esta referência aparece porque</strong>
            <ul>
              {explanation.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
            <small>
              Critério {explanation.algorithmVersion}. A pontuação é editorial,
              não uma avaliação científica.
            </small>
          </div>
        )}
      </div>
    </article>
  );
}
function Filters({
  query,
  setQuery,
  sources,
}: {
  query: SearchQuery;
  setQuery: (q: SearchQuery) => void;
  sources: Source[];
}) {
  return (
    <div className="filters">
      <label className="searchbox">
        <Search size={19} />
        <span className="sr-only">Buscar conteúdos</span>
        <input
          value={query.q ?? ""}
          onChange={(e) => setQuery({ ...query, q: e.target.value, offset: 0 })}
          placeholder="Busque uma ideia, fonte ou tema"
          type="search"
        />
      </label>
      <div className="filter-controls">
        <Filter size={16} />
        <label>
          <span className="sr-only">Assunto</span>
          <select
            value={query.topic ?? ""}
            onChange={(e) =>
              setQuery({
                ...query,
                topic: e.target.value || undefined,
                offset: 0,
              })
            }
          >
            <option value="">Todos os assuntos</option>
            {[
              "design",
              "branding",
              "typography",
              "visual",
              "perception",
              "technology",
              "cultura",
              "css",
              "ux",
              "accessibility",
            ].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Fonte</span>
          <select
            value={query.sourceId ?? ""}
            onChange={(e) =>
              setQuery({
                ...query,
                sourceId: e.target.value || undefined,
                offset: 0,
              })
            }
          >
            <option value="">Todas as fontes</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Formato</span>
          <select
            value={query.kind ?? ""}
            onChange={(e) =>
              setQuery({
                ...query,
                kind: (e.target.value as Content["kind"]) || undefined,
                offset: 0,
              })
            }
          >
            <option value="">Todos os formatos</option>
            {Object.entries(kindName).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

export default function App() {
  const [area, setArea] = useState<Area>(navArea),
    [mobileMenu, setMobileMenu] = useState(false),
    [selected, setSelected] = useState<Content[]>([]),
    [selectionOpen, setSelectionOpen] = useState(false);
  const [feed, setFeed] = useState<FeedPage | null>(null),
    [results, setResults] = useState<Content[]>([]),
    [saved, setSaved] = useState<Content[]>([]),
    [next, setNext] = useState<string | null>(null),
    [feedLoading, setFeedLoading] = useState(true),
    [savedLoading, setSavedLoading] = useState(false),
    [moreLoading, setMoreLoading] = useState(false),
    [feedError, setFeedError] = useState(""),
    [savedError, setSavedError] = useState("");
  const [query, setQuery] = useState<SearchQuery>({}),
    [sources, setSources] = useState<Source[]>([]),
    [toast, setToast] = useState(""),
    [busyId, setBusyId] = useState<string | null>(null),
    [noteTarget, setNoteTarget] = useState<Content | null>(null),
    [noteDraft, setNoteDraft] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]),
    [activeCollection, setActiveCollection] = useState<string | null>(null),
    [collectionName, setCollectionName] = useState("");
  const [format, setFormat] = useState<ResearchInput["format"]>("carousel"),
    [slides, setSlides] = useState(6),
    [tone, setTone] = useState("autoral e analítico"),
    [audience, setAudience] = useState("profissionais criativos"),
    [objective, setObjective] = useState(""),
    [argument, setArgument] = useState(""),
    [notes, setNotes] = useState(""),
    [prompt, setPrompt] = useState<PromptResponse | null>(null),
    [generating, setGenerating] = useState(false),
    [workError, setWorkError] = useState(""),
    [copied, setCopied] = useState(false);
  const seq = useRef(Promise.resolve()),
    selectedRef = useRef<Content[]>([]),
    toastTimer = useRef<number | undefined>(undefined);
  const notify = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3500);
  };
  const navigate = (to: Area) => {
    if (area !== to) {
      history.pushState({}, "", `/${to}`);
      setArea(to);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    setMobileMenu(false);
    setSelectionOpen(false);
  };
  useEffect(() => {
    const onPop = () => setArea(navArea());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNoteTarget(null);
        setSelectionOpen(false);
        setMobileMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const patch = (item: Content) => {
    setFeed((p) =>
      p
        ? {
            ...p,
            items: p.items.map((i) =>
              i.content.id === item.id ? { ...i, content: item } : i,
            ),
          }
        : p,
    );
    setResults((p) => p.map((i) => (i.id === item.id ? item : i)));
    setSaved((p) => p.map((i) => (i.id === item.id ? item : i)));
    setSelected((p) => {
      const n = p.map((i) => (i.id === item.id ? item : i));
      selectedRef.current = n;
      return n;
    });
  };
  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    setFeedError("");
    try {
      const page = await api.feed({ limit: 12 });
      setFeed(page);
    } catch (e) {
      setFeedError(errorText(e));
    } finally {
      setFeedLoading(false);
    }
  }, []);
  const loadSaved = useCallback(async () => {
    setSavedLoading(true);
    setSavedError("");
    try {
      const data = activeCollection
        ? await api.collectionItems(activeCollection, { limit: 20, offset: 0 })
        : await api.favorites({ ...query, limit: 20, offset: 0 });
      setSaved(data.items);
      setNext(data.nextCursor);
    } catch (e) {
      setSavedError(errorText(e));
    } finally {
      setSavedLoading(false);
    }
  }, [activeCollection, query.q, query.topic, query.kind, query.sourceId]);
  const loadCollections = useCallback(async () => {
    try {
      const data = await api.collections({ limit: 50 });
      setCollections(data.items);
    } catch (e) {
      notify(errorText(e));
    }
  }, []);
  useEffect(() => {
    void loadFeed();
    void api
      .selection()
      .then((r) => {
        selectedRef.current = r.items;
        setSelected(r.items);
      })
      .catch((e) => notify(errorText(e)));
    void fetch("/api/admin/sources?limit=50", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (r) =>
          r &&
          setSources(r.items.filter((s: Source) => s.status === "approved")),
      )
      .catch(() => {});
  }, [loadFeed]);
  useEffect(() => {
    if (area === "salvos") {
      void loadSaved();
      void loadCollections();
    }
  }, [area, loadSaved, loadCollections]);
  const exploring = !!(
    query.q?.trim() ||
    query.topic ||
    query.sourceId ||
    query.kind
  );
  useEffect(() => {
    if (area !== "for-you" || !exploring) return;
    const timeout = window.setTimeout(() => {
      setFeedLoading(true);
      setFeedError("");
      void api
        .search({ ...query, limit: 20, offset: 0 })
        .then((r) => {
          setResults(r.items);
          setNext(r.nextCursor);
        })
        .catch((e) => setFeedError(errorText(e)))
        .finally(() => setFeedLoading(false));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [area, query.q, query.topic, query.sourceId, query.kind, exploring]);
  const more = async () => {
    setMoreLoading(true);
    try {
      if (area === "salvos") {
        const data = activeCollection
          ? await api.collectionItems(activeCollection, {
              limit: 20,
              offset: Number(next),
            })
          : await api.favorites({ ...query, limit: 20, offset: Number(next) });
        setSaved((p) => [...p, ...data.items]);
        setNext(data.nextCursor);
      } else if (exploring) {
        const data = await api.search({
          ...query,
          limit: 20,
          offset: Number(next),
        });
        setResults((p) => [...p, ...data.items]);
        setNext(data.nextCursor);
      } else if (feed?.nextCursor) {
        const data = await api.feed({ limit: 12, cursor: feed.nextCursor });
        setFeed((p) =>
          p ? { ...data, items: [...p.items, ...data.items] } : data,
        );
      }
    } catch (e) {
      const err = e as LastroApiError;
      if (err instanceof LastroApiError && err.status === 410) {
        notify("A sequência mudou. Atualizando o For You.");
        void loadFeed();
      } else notify(errorText(e));
    } finally {
      setMoreLoading(false);
    }
  };
  const createCollection = async (e: FormEvent) => {
    e.preventDefault();
    const name = collectionName.trim();
    if (!name) return;
    try {
      const created = await api.createCollection(name);
      setCollectionName("");
      setCollections((p) => [created, ...p]);
      setActiveCollection(created.id);
      notify("Coleção criada.");
    } catch (err) {
      notify(errorText(err));
    }
  };
  const addCollection = async (item: Content, id: string) => {
    if (!id) return;
    try {
      await api.addToCollection(id, item.id);
      notify("Adicionado à coleção.");
    } catch (err) {
      notify(errorText(err));
    }
  };
  const removeCollection = async (item: Content) => {
    if (!activeCollection) return;
    try {
      await api.removeFromCollection(activeCollection, item.id);
      setSaved((p) => p.filter((i) => i.id !== item.id));
      notify("Removido da coleção.");
    } catch (err) {
      notify(errorText(err));
    }
  };
  const favorite = async (item: Content) => {
    setBusyId(item.id);
    try {
      if (item.state.favorite) {
        await api.unfavorite(item.id);
        patch({ ...item, state: { ...item.state, favorite: false } });
        if (area === "salvos")
          setSaved((p) => p.filter((i) => i.id !== item.id));
        notify("Removido dos Salvos.");
      } else {
        const updated = await api.favorite(item.id);
        patch(updated);
        notify("Referência guardada nos Salvos.");
      }
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusyId(null);
    }
  };
  const selection = (item: Content) => {
    const desired = selectedRef.current.some((i) => i.id === item.id)
      ? selectedRef.current.filter((i) => i.id !== item.id)
      : [...selectedRef.current, item];
    if (desired.length > 20) {
      notify("A Oficina comporta até 20 referências.");
      return;
    }
    setPrompt(null);
    selectedRef.current = desired;
    setSelected(desired);
    const mark = (c: Content) => ({
      ...c,
      state: { ...c.state, selected: desired.some((s) => s.id === c.id) },
    });
    setFeed((p) =>
      p
        ? {
            ...p,
            items: p.items.map((i) => ({ ...i, content: mark(i.content) })),
          }
        : p,
    );
    setResults((p) => p.map(mark));
    setSaved((p) => p.map(mark));
    seq.current = seq.current
      .catch(() => {})
      .then(async () => {
        try {
          const r = await api.setSelection(desired.map((i) => i.id));
          if (
            selectedRef.current.map((i) => i.id).join(",") ===
            desired.map((i) => i.id).join(",")
          ) {
            selectedRef.current = r.items;
            setSelected(r.items);
          }
          notify(
            `${desired.length} ${desired.length === 1 ? "referência selecionada" : "referências selecionadas"}.`,
          );
        } catch (e) {
          notify(errorText(e));
          try {
            const r = await api.selection();
            selectedRef.current = r.items;
            setSelected(r.items);
            void loadFeed();
            if (area === "salvos") void loadSaved();
          } catch {}
        }
      });
  };
  const interact = async (
    item: Content,
    type: "read" | "dismissed" | "opened",
    active = true,
  ) => {
    try {
      const updated = await api.interact(item.id, { type, active });
      patch(updated);
      if (type === "dismissed") {
        setFeed((p) =>
          p
            ? { ...p, items: p.items.filter((i) => i.content.id !== item.id) }
            : p,
        );
        notify("Essa referência saiu do seu For You.");
      } else if (type === "read")
        notify(active ? "Marcado como lido." : "Marcado como não lido.");
    } catch (e) {
      if (type !== "opened") notify(errorText(e));
    }
  };
  const saveNote = async () => {
    if (!noteTarget) return;
    try {
      await api.note(noteTarget.id, noteDraft);
      patch({ ...noteTarget, state: { ...noteTarget.state, note: noteDraft } });
      setNoteTarget(null);
      notify("Nota salva.");
    } catch (e) {
      notify(errorText(e));
    }
  };
  const generate = async (e: FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setWorkError("");
    try {
      const pack = await api.createPackage({
        format,
        ...(format === "carousel" ? { slides } : {}),
        tone,
        audience,
        objective,
        notes: [
          argument.trim() ? `Argumento central: ${argument.trim()}` : "",
          notes.trim(),
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      setPrompt(await api.prompt(pack.id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setWorkError(errorText(err));
    } finally {
      setGenerating(false);
    }
  };
  const copy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.text);
      setCopied(true);
      notify("Prompt copiado. Cole no assistente que escolher.");
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      notify(
        "Não foi possível copiar automaticamente. Selecione o texto abaixo.",
      );
    }
  };
  const cardProps = (item: Content) => ({
    item,
    onFavorite: favorite,
    onSelect: selection,
    onRead: (c: Content) => void interact(c, "read", !c.state.read),
    onOpen: (c: Content) => void interact(c, "opened"),
    busy: busyId === item.id,
  });
  const feedItems = exploring
    ? results
    : (feed?.items.map((i) => i.content) ?? []);
  const visibleSaved = saved.filter((item) => {
    const q = (query.q ?? "").toLowerCase();
    return (
      (!q ||
        `${item.title} ${item.description ?? ""}`.toLowerCase().includes(q)) &&
      (!query.topic || item.topics.includes(query.topic)) &&
      (!query.kind || item.kind === query.kind) &&
      (!query.sourceId || item.sourceId === query.sourceId)
    );
  });
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => navigate("for-you")}
          aria-label="Lastro, voltar ao For You"
        >
          <span className="brand-symbol">
            L<span>.</span>
          </span>
          <span>
            LASTRO<small>HUB CRIATIVO</small>
          </span>
        </button>
        <nav
          className={`nav ${mobileMenu ? "open" : ""}`}
          aria-label="Navegação principal"
        >
          {areas.map((a) => (
            <button
              key={a.id}
              className={area === a.id ? "active" : ""}
              onClick={() => navigate(a.id)}
              aria-current={area === a.id ? "page" : undefined}
            >
              <small>{a.index}</small>
              {a.label}
            </button>
          ))}
        </nav>
        <div className="top-right">
          <span className="private-label">
            <span className="live-dot" /> ESPAÇO PRIVADO
          </span>
          <button
            className="menu-button"
            onClick={() => setMobileMenu((v) => !v)}
            aria-label={mobileMenu ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileMenu}
          >
            {mobileMenu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main id="main">
        <div className="masthead">
          <div className="masthead-line">
            <span>ARQUIVO VIVO / REPERTÓRIO EM MOVIMENTO</span>
            <span>EST. 2026 ↗</span>
          </div>
          <h1>
            {area === "for-you" ? (
              <>
                Informação com <em>critério.</em>
              </>
            ) : area === "salvos" ? (
              <>
                O que merece <em>ficar.</em>
              </>
            ) : area === "oficina" ? (
              <>
                Ideias em <em>construção.</em>
              </>
            ) : (
              <>
                Do rascunho ao <em>mundo.</em>
              </>
            )}
          </h1>
          <div className="masthead-bottom">
            <p>
              {area === "for-you"
                ? "Referências escolhidas para expandir seu olhar, sem perder o fundamento."
                : area === "salvos"
                  ? "Sua biblioteca pessoal de ideias, pesquisas e referências."
                  : area === "oficina"
                    ? "Reúna fontes, defina a direção e prepare a próxima criação."
                    : "Um espaço editorial em preparação."}
            </p>
            <span className="edition">
              {areas.find((a) => a.id === area)?.index} / 04
            </span>
          </div>
        </div>
        {area === "for-you" && (
          <section className="page-section" aria-labelledby="feed-title">
            <div className="section-heading">
              <div>
                <span className="kicker">RADAR / FOR YOU</span>
                <h2 id="feed-title">
                  Para observar agora<span className="asterisk">✳</span>
                </h2>
              </div>
              <span className="section-note">Curadoria que abre caminhos.</span>
            </div>
            <Filters query={query} setQuery={setQuery} sources={sources} />
            {feedError ? (
              <ErrorState message={feedError} onRetry={() => void loadFeed()} />
            ) : feedLoading ? (
              <Loading />
            ) : feedItems.length === 0 ? (
              <Empty
                title="Ainda não há referências por aqui"
                body={
                  exploring
                    ? "Experimente outra busca ou remova um filtro."
                    : "O Radar mostra conteúdos após a coleta e a aprovação editorial das fontes."
                }
                action={
                  exploring ? (
                    <button
                      className="primary-button"
                      onClick={() => setQuery({})}
                    >
                      Limpar filtros <ArrowRight size={16} />
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="result-line">
                  <span>
                    {exploring ? "RESULTADOS DA BUSCA" : "SELEÇÃO EDITORIAL"}
                  </span>
                  <span>
                    {feedItems.length}{" "}
                    {feedItems.length === 1 ? "REFERÊNCIA" : "REFERÊNCIAS"}
                  </span>
                </div>
                {!exploring && feedItems[0] && (
                  <ContentCard
                    {...cardProps(feedItems[0])}
                    explanation={feed?.items[0]?.explanation}
                    onDismiss={(c) => void interact(c, "dismissed")}
                    featured
                  />
                )}
                <div className="card-grid">
                  {(exploring ? feedItems : feedItems.slice(1)).map((item) => (
                    <ContentCard
                      key={item.id}
                      {...cardProps(item)}
                      explanation={
                        !exploring
                          ? feed?.items.find((i) => i.content.id === item.id)
                              ?.explanation
                          : undefined
                      }
                      onDismiss={(c) => void interact(c, "dismissed")}
                    />
                  ))}
                </div>
                {(exploring ? next : feed?.nextCursor) && (
                  <button
                    className="load-more"
                    onClick={() => void more()}
                    disabled={moreLoading}
                  >
                    {moreLoading ? "Carregando…" : "Carregar mais referências"}{" "}
                    <ArrowDownRight size={18} />
                  </button>
                )}
              </>
            )}
          </section>
        )}
        {area === "salvos" && (
          <section className="page-section">
            <div className="section-heading">
              <div>
                <span className="kicker">ACERVO / SALVOS</span>
                <h2>
                  Sua memória criativa<span className="asterisk">✳</span>
                </h2>
              </div>
              <span className="section-note">
                O que foi salvo continua disponível.
              </span>
            </div>
            <div className="collection-tools">
              <div className="collection-tabs" aria-label="Coleções">
                <button
                  className={!activeCollection ? "active" : ""}
                  onClick={() => setActiveCollection(null)}
                >
                  Todos os salvos
                </button>
                {collections.map((c) => (
                  <button
                    key={c.id}
                    className={activeCollection === c.id ? "active" : ""}
                    onClick={() => setActiveCollection(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <form onSubmit={(e) => void createCollection(e)}>
                <label className="sr-only" htmlFor="collection-name">
                  Nome da nova coleção
                </label>
                <input
                  id="collection-name"
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  maxLength={100}
                  placeholder="Nova coleção"
                />
                <button
                  type="submit"
                  disabled={!collectionName.trim()}
                  aria-label="Criar coleção"
                >
                  <Plus size={18} />
                </button>
              </form>
            </div>
            <Filters query={query} setQuery={setQuery} sources={sources} />
            {savedError ? (
              <ErrorState
                message={savedError}
                onRetry={() => void loadSaved()}
              />
            ) : savedLoading ? (
              <Loading />
            ) : visibleSaved.length === 0 ? (
              <Empty
                title={
                  activeCollection
                    ? "Nenhuma referência nesta coleção"
                    : Object.values(query).some(Boolean)
                      ? "Nenhuma referência encontrada"
                      : "Seu acervo começa aqui"
                }
                body={
                  activeCollection
                    ? "Adicione referências a esta coleção a partir de Todos os salvos, ou ajuste os filtros."
                    : Object.values(query).some(Boolean)
                      ? "Experimente outra busca ou remova um filtro."
                      : "Ao favoritar uma referência no For You, ela aparece nesta biblioteca."
                }
                action={
                  <button
                    className="primary-button"
                    onClick={() =>
                      activeCollection
                        ? setActiveCollection(null)
                        : navigate("for-you")
                    }
                  >
                    {activeCollection
                      ? "Ver todos os salvos"
                      : "Explorar For You"}{" "}
                    <ArrowRight size={16} />
                  </button>
                }
              />
            ) : (
              <>
                <div className="result-line">
                  <span>
                    {activeCollection
                      ? "ITENS DA COLEÇÃO"
                      : "REFERÊNCIAS GUARDADAS"}
                  </span>
                  <span>{saved.length} ITENS</span>
                </div>
                <div className="card-grid">
                  {visibleSaved.map((item) => (
                    <div className="saved-item" key={item.id}>
                      <ContentCard
                        {...cardProps(item)}
                        onNote={(c) => {
                          setNoteTarget(c);
                          setNoteDraft(c.state.note ?? "");
                        }}
                      />
                      <div className="collection-control">
                        {activeCollection ? (
                          <button
                            className="quiet-link"
                            onClick={() => void removeCollection(item)}
                          >
                            Remover desta coleção
                          </button>
                        ) : collections.length > 0 ? (
                          <label>
                            Adicionar à coleção{" "}
                            <select
                              aria-label={`Adicionar ${item.title} à coleção`}
                              value=""
                              onChange={(e) =>
                                void addCollection(item, e.target.value)
                              }
                            >
                              <option value="">Escolha uma coleção</option>
                              {collections.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <span>
                            Crie uma coleção para organizar suas referências.
                          </span>
                        )}
                        {item.state.note && (
                          <p className="saved-note">
                            <strong>Sua nota</strong>
                            {item.state.note}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {next && (
                  <button
                    className="load-more"
                    onClick={() => void more()}
                    disabled={moreLoading}
                  >
                    Carregar mais <ArrowDownRight size={18} />
                  </button>
                )}
              </>
            )}
          </section>
        )}
        {area === "oficina" && (
          <section className="page-section workshop">
            <div className="section-heading">
              <div>
                <span className="kicker">OFICINA / CRIAÇÃO</span>
                <h2>
                  Da fonte à ideia<span className="asterisk">✳</span>
                </h2>
              </div>
              <span className="section-note">
                Autoria humana, referências à vista.
              </span>
            </div>
            <div className="work-grid">
              <div className="work-main">
                {selected.length === 0 ? (
                  <Empty
                    title="Escolha por onde começar"
                    body="Selecione referências no For You ou no acervo para montar um contexto de criação."
                    action={
                      <button
                        className="primary-button"
                        onClick={() => navigate("for-you")}
                      >
                        Encontrar referências <ArrowRight size={16} />
                      </button>
                    }
                  />
                ) : prompt ? (
                  <div className="prompt-panel">
                    <div className="step">RESULTADO / PROMPT</div>
                    <h3>Pronto para criar.</h3>
                    <p>
                      Copie o texto e cole manualmente no assistente de sua
                      preferência. Os links não garantem acesso à fonte
                      original.
                    </p>
                    <div className="prompt-actions">
                      <button
                        className="primary-button"
                        onClick={() => void copy()}
                      >
                        {copied ? <Check size={18} /> : <Copy size={18} />}{" "}
                        {copied ? "Copiado" : "Copiar prompt"}
                      </button>
                      <a
                        className="secondary-button"
                        href="https://chatgpt.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir ChatGPT <ExternalLink size={16} />
                      </a>
                      <a
                        className="secondary-button"
                        href="https://gemini.google.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Abrir Gemini <ExternalLink size={16} />
                      </a>
                    </div>
                    <label className="sr-only" htmlFor="prompt-text">
                      Prompt gerado
                    </label>
                    <textarea
                      id="prompt-text"
                      readOnly
                      value={prompt.text}
                      rows={18}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      className="back-button"
                      onClick={() => setPrompt(null)}
                    >
                      <ArrowLeft size={17} /> Voltar e editar parâmetros
                    </button>
                  </div>
                ) : (
                  <form
                    className="creation-form"
                    onSubmit={(e) => void generate(e)}
                  >
                    <div className="step">01 / DEFINIR A DIREÇÃO</div>
                    <h3>O que vamos criar?</h3>
                    <fieldset>
                      <legend>Formato</legend>
                      <div className="format-grid">
                        {(
                          [
                            ["post", "Post único"],
                            ["carousel", "Carrossel"],
                            ["article", "Artigo"],
                            ["newsletter", "Newsletter"],
                          ] as const
                        ).map(([value, label]) => (
                          <label
                            key={value}
                            className={`format-choice ${format === value ? "chosen" : ""}`}
                          >
                            <input
                              type="radio"
                              name="format"
                              value={value}
                              checked={format === value}
                              onChange={() => setFormat(value)}
                            />
                            <span>{label}</span>
                            <Check size={17} />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {format === "carousel" && (
                      <label className="field">
                        Número de slides
                        <input
                          type="number"
                          min={2}
                          max={30}
                          value={slides}
                          onChange={(e) => setSlides(Number(e.target.value))}
                          required
                        />
                      </label>
                    )}
                    <label className="field">
                      Linguagem editorial
                      <select
                        value={tone}
                        onChange={(e) => setTone(e.target.value)}
                      >
                        <option value="autoral e analítico">
                          Autoral e analítica
                        </option>
                        <option value="didático">Didática</option>
                        <option value="técnico-científico">
                          Técnico-científica
                        </option>
                      </select>
                    </label>
                    <label className="field">
                      Público-alvo
                      <input
                        value={audience}
                        onChange={(e) => setAudience(e.target.value)}
                        maxLength={300}
                      />
                    </label>
                    <label className="field">
                      Objetivo da publicação <span className="required">*</span>
                      <textarea
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        minLength={3}
                        maxLength={2000}
                        placeholder="O que esta publicação deve alcançar?"
                        required
                        rows={3}
                      />
                    </label>
                    <label className="field">
                      Orientação ou argumento central
                      <textarea
                        value={argument}
                        onChange={(e) => setArgument(e.target.value)}
                        maxLength={2000}
                        placeholder="Qual ideia deve conduzir o texto?"
                        rows={3}
                      />
                    </label>
                    <label className="field">
                      Notas adicionais
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        maxLength={5000}
                        rows={3}
                        placeholder="Contexto, ênfases e cuidados editoriais"
                      />
                    </label>
                    {workError && (
                      <div className="notice error" role="alert">
                        {workError}
                      </div>
                    )}
                    <button
                      className="primary-button submit"
                      type="submit"
                      disabled={generating}
                    >
                      {generating
                        ? "Montando pacote…"
                        : `Gerar prompt com ${selected.length} ${selected.length === 1 ? "fonte" : "fontes"}`}{" "}
                      <Sparkles size={18} />
                    </button>
                    <p className="form-footnote">
                      O Lastro organiza metadados e notas. Confira as fontes e
                      revise o texto antes de usar.
                    </p>
                  </form>
                )}
              </div>
              <aside className="selected-aside">
                <div className="aside-head">
                  <span className="step">02 / FONTES</span>
                  <strong>
                    {selected.length}{" "}
                    {selected.length === 1 ? "selecionada" : "selecionadas"}
                  </strong>
                </div>
                {selected.length === 0 ? (
                  <p>Nenhuma referência selecionada.</p>
                ) : (
                  <ol>
                    {selected.map((item, i) => (
                      <li key={item.id}>
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.sourceName}</small>
                        </div>
                        <button
                          onClick={() => selection(item)}
                          aria-label={`Remover ${item.title} da seleção`}
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <button
                  className="quiet-link"
                  onClick={() => navigate("for-you")}
                >
                  Adicionar mais referências <ArrowRight size={16} />
                </button>
              </aside>
            </div>
          </section>
        )}
        {area === "publicacoes" && (
          <section className="page-section publications">
            <div className="section-heading">
              <div>
                <span className="kicker">PUBLICAÇÕES / EM PREPARAÇÃO</span>
                <h2>
                  Onde as ideias chegam<span className="asterisk">✳</span>
                </h2>
              </div>
            </div>
            <p className="pub-intro">
              O espaço editorial vai reunir textos revisados e edições futuras.
              A publicação integrada ainda não está disponível nesta etapa.
            </p>
            <div className="pub-grid">
              <div className="pub-card">
                <span>01 / BLOG</span>
                <h3>Artigos que permanecem.</h3>
                <p>
                  Rascunhos, edição e publicação no portfólio serão integrados
                  em uma próxima etapa.
                </p>
                <div className="coming">
                  EM DESENVOLVIMENTO <ArrowRight size={16} />
                </div>
              </div>
              <div className="pub-card">
                <span>02 / NEWSLETTER</span>
                <h3>Uma edição para compartilhar.</h3>
                <p>
                  Versão web e exportação em HTML serão desenvolvidas junto à
                  área editorial.
                </p>
                <div className="coming">
                  EM DESENVOLVIMENTO <ArrowRight size={16} />
                </div>
              </div>
            </div>
            <button className="text-button" onClick={() => navigate("oficina")}>
              Preparar um prompt na Oficina <ArrowRight size={17} />
            </button>
          </section>
        )}
      </main>
      <footer>
        <span className="footer-logo">
          LASTRO<span>.</span>
        </span>
        <span>INFORMAÇÃO COM CRITÉRIO · REPERTÓRIO QUE PERMANECE</span>
        <span>UMA FERRAMENTA DE TRABALHO CRIATIVO</span>
      </footer>
      {selected.length > 0 && (
        <div className="selection-bar">
          <div>
            <span className="selection-count">
              {String(selected.length).padStart(2, "0")}
            </span>
            <div>
              <strong>
                {selected.length === 1
                  ? "referência selecionada"
                  : "referências selecionadas"}
              </strong>
              <button onClick={() => setSelectionOpen(true)}>
                Ver seleção <ArrowRight size={15} />
              </button>
            </div>
          </div>
          <button
            className="selection-create"
            onClick={() => navigate("oficina")}
          >
            Criar <ArrowRight size={20} />
          </button>
        </div>
      )}
      {selectionOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelectionOpen(false);
          }}
        >
          <div
            className="selection-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Referências selecionadas"
          >
            <div className="panel-heading">
              <div>
                <span className="kicker">OFICINA / SELEÇÃO</span>
                <h3>Seu conjunto atual</h3>
              </div>
              <IconButton
                label="Fechar painel"
                onClick={() => setSelectionOpen(false)}
              >
                <X />
              </IconButton>
            </div>
            <ol>
              {selected.map((item, i) => (
                <li key={item.id}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.sourceName}</small>
                  </div>
                  <IconButton
                    label={`Remover ${item.title}`}
                    onClick={() => selection(item)}
                  >
                    <X size={17} />
                  </IconButton>
                </li>
              ))}
            </ol>
            <button
              className="primary-button"
              onClick={() => navigate("oficina")}
            >
              Ir para Oficina <ArrowRight size={17} />
            </button>
          </div>
        </div>
      )}
      {noteTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNoteTarget(null);
          }}
        >
          <div
            className="note-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Nota pessoal"
          >
            <div className="panel-heading">
              <h3>Nota da referência</h3>
              <IconButton label="Fechar" onClick={() => setNoteTarget(null)}>
                <X />
              </IconButton>
            </div>
            <p>{noteTarget.title}</p>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              maxLength={5000}
              rows={8}
              autoFocus
            />
            <button className="primary-button" onClick={() => void saveNote()}>
              Salvar nota <Check size={17} />
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
