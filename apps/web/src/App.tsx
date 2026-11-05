import RadarBoard from "./RadarBoard";
import { clearJarvisSession } from "./jarvis-client";
import Opportunities from "./Opportunities";
import Newsletters from "./Newsletters";
import Analytics from "./Analytics";
import Health from "./Health";
import Ecosystem, { useEcosystem, StudioDraftAction } from "./Ecosystem";
import Select from "./Select";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Curation from "./Curation";
import { ContentCard, Filters } from "./ReferenceCards";
import Jarvis from "./Jarvis";
import Pulso from "./Pulso";
import EditorialPulse from "./EditorialPulse";
import AppearanceControls, {
  fullMotion,
  transitionLayout,
  transitionCards,
} from "./Appearance";
import { chooseDiscovery, discoveryPool, type Area } from "./experience";
import { useDialogFocus } from "./useDialogFocus";
import {
  ArrowDownRight,
  Activity,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  Check,
  ContactRound,
  Copy,
  ExternalLink,
  Filter,
  Globe,
  Layers2,
  Lightbulb,
  Mail,
  Menu,
  Newspaper,
  Plus,
  Search,
  ChartNoAxesCombined,
  Sparkles,
  SquarePen,
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
  PromptResponse,
  ResearchInput,
  Source,
} from "../../../packages/contracts";

const api = createLastroClient();
const areas: { id: Area; label: string; index: string }[] = [
  { id: "for-you", label: "For You", index: "01" },
  { id: "salvos", label: "Salvos", index: "02" },
  { id: "oficina", label: "Oficina", index: "03" },
  { id: "publicacoes", label: "Publicações", index: "04" },
  { id: "curadoria", label: "Curadoria", index: "05" },
  { id: "analytics", label: "Analytics", index: "06" },
  { id: "oportunidades", label: "Oportunidades", index: "07" },
  { id: "newsletters", label: "Newsletters", index: "08" },
  { id: "saude", label: "Saúde do Ecossistema", index: "09" },
];
const navArea = (): Area => {
  const path = location.pathname.slice(1);
  return areas.some((a) => a.id === path) ? (path as Area) : "for-you";
};
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
function Loading({
  count = 3,
  feed = false,
}: {
  count?: number;
  feed?: boolean;
}) {
  return (
    <div
      className={`card-grid ${feed ? "feed-grid" : ""}`}
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

function WorkspaceApp({ onLogout }: { onLogout: () => void }) {
  const ecosystem = useEcosystem();
  const [ingestionError, setIngestionError] = useState("");
  const [area, setArea] = useState<Area>(navArea),
    [mobileMenu, setMobileMenu] = useState(false),
    [selected, setSelected] = useState<Content[]>([]),
    [selectionOpen, setSelectionOpen] = useState(false);
  const [radarItems, setRadarItems] = useState<Content[]>([]),
    [saved, setSaved] = useState<Content[]>([]),
    [next, setNext] = useState<string | null>(null),
    [savedLoading, setSavedLoading] = useState(false),
    [moreLoading, setMoreLoading] = useState(false),
    [savedError, setSavedError] = useState("");
  const [query, setQuery] = useState<SearchQuery>(() => {
      try {
        return JSON.parse(
          localStorage.getItem("lastro-feed-filters") ?? "{}",
        ) as SearchQuery;
      } catch {
        return {};
      }
    }),
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
  const [discovered, setDiscovered] = useState<string>();
  const [discoveryId, setDiscoveryId] = useState<string>();
  const discoveryTimer = useRef<number | undefined>(undefined);
  const [view, setView] = useState<"grid" | "list">(() =>
    localStorage.getItem("lastro-feed-view") === "list" ? "list" : "grid",
  );
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<number | null>(null);
  const positions = useRef<Partial<Record<Area, number>>>({});
  const activeArea = useRef<Area>(area);
  useDialogFocus(selectionOpen || noteTarget !== null);
  const seq = useRef(Promise.resolve()),
    selectedRef = useRef<Content[]>([]),
    toastTimer = useRef<number | undefined>(undefined);
  const notify = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3500);
  };
  useEffect(() => {
    localStorage.setItem("lastro-feed-filters", JSON.stringify(query));
  }, [query]);
  useEffect(() => {
    localStorage.setItem("lastro-feed-view", view);
  }, [view]);
  const navigate = (to: Area) => {
    if (area !== to) {
      positions.current[area] = document.getElementById("main")?.scrollTop ?? 0;
      activeArea.current = to;
      history.pushState({}, "", `/${to}`);
      transitionLayout(() => {
        setArea(to);
        requestAnimationFrame(() =>
          document.getElementById("main")?.scrollTo({
            top: positions.current[to] ?? 0,
            behavior: "instant",
          }),
        );
      });
    }
    setMobileMenu(false);
    setSelectionOpen(false);
  };
  useEffect(() => () => window.clearTimeout(discoveryTimer.current), []);
  useEffect(() => {
    const onPop = () => {
      const to = navArea();
      positions.current[activeArea.current] =
        document.getElementById("main")?.scrollTop ?? 0;
      activeArea.current = to;
      transitionLayout(() => {
        setArea(to);
        requestAnimationFrame(() =>
          document.getElementById("main")?.scrollTo({
            top: positions.current[to] ?? 0,
            behavior: "instant",
          }),
        );
      });
      setMobileMenu(false);
      setSelectionOpen(false);
    };
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
    setRadarItems((p) => p.map((i) => (i.id === item.id ? item : i)));
    setSaved((p) => p.map((i) => (i.id === item.id ? item : i)));
    setSelected((p) => {
      const n = p.map((i) => (i.id === item.id ? item : i));
      selectedRef.current = n;
      return n;
    });
  };
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
    void api
      .selection()
      .then((r) => {
        selectedRef.current = r.items;
        setSelected(r.items);
      })
      .catch((e) => notify(errorText(e)));
    void api
      .sources()
      .then((r) => {
        setSources(r.items.filter((s) => s.status === "approved"));
        setIngestionError(
          r.items.some((s) => s.lastRun?.error)
            ? "Há fontes com erro na última coleta. Consulte Curadoria → Fontes."
            : "",
        );
      })
      .catch(() =>
        setIngestionError(
          "Não foi possível verificar o estado das fontes. Consulte a Curadoria.",
        ),
      );
  }, []);
  useEffect(() => {
    if (area === "salvos") {
      void loadSaved();
      void loadCollections();
    }
  }, [area, loadSaved, loadCollections]);
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
      }
    } catch (e) {
      const err = e as LastroApiError;
      if (err instanceof LastroApiError && err.status === 410)
        notify(
          "A sequência mudou. Atualize a lista para carregar a página seguinte.",
        );
      else notify(errorText(e));
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
    patch({
      ...item,
      state: { ...item.state, favorite: !item.state.favorite },
    });
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
      patch(item);
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
      return Promise.resolve(false);
    }
    setPrompt(null);
    selectedRef.current = desired;
    setSelected(desired);
    const mark = (c: Content) => ({
      ...c,
      state: { ...c.state, selected: desired.some((s) => s.id === c.id) },
    });
    setRadarItems((p) => p.map(mark));
    setSaved((p) => p.map(mark));
    let confirmed = false;
    seq.current = seq.current
      .catch(() => {})
      .then(async () => {
        try {
          const r = await api.setSelection(desired.map((i) => i.id));
          confirmed = true;
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
            if (area === "salvos") void loadSaved();
          } catch {}
        }
      });
    return seq.current.then(() => confirmed);
  };
  const interact = async (
    item: Content,
    type: "read" | "dismissed" | "opened",
    active = true,
  ) => {
    if (type === "read")
      patch({ ...item, state: { ...item.state, read: active } });
    try {
      const updated = await api.interact(item.id, { type, active });
      patch(updated);
      if (type === "dismissed") {
        setRadarItems((p) => p.filter((i) => i.id !== item.id));
        notify("Essa referência saiu do seu For You.");
      } else if (type === "read")
        notify(active ? "Marcado como lido." : "Marcado como não lido.");
    } catch (e) {
      if (type === "read") patch(item);
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
      notify("Prompt gerado com as referências selecionadas.");
      document.getElementById("main")?.scrollTo({
        top: 0,
        behavior: fullMotion() ? "smooth" : "instant",
      });
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
    onExplore: (topic: string) => {
      setQuery({ topic });
      navigate("for-you");
    },
  });
  const feedItems = radarItems;
  const visibleSaved = saved.filter((item) => {
    const q = (query.q ?? "").toLowerCase();
    return (
      (!q ||
        `${item.title} ${item.synopsis?.text ?? item.description ?? ""}`
          .toLowerCase()
          .includes(q)) &&
      (!query.topic || item.topics.includes(query.topic)) &&
      (!query.kind || item.kind === query.kind) &&
      (!query.sourceId || item.sourceId === query.sourceId)
    );
  });
  const surprise = () => {
    const item = chooseDiscovery(feedItems, discovered);
    if (!item) return;
    setDiscovered(item.id);
    setDiscoveryId(item.id);
    window.clearTimeout(discoveryTimer.current);
    discoveryTimer.current = window.setTimeout(
      () => setDiscoveryId(undefined),
      1900,
    );
    requestAnimationFrame(() => {
      const card = document.getElementById(`content-${item.id}`);
      card?.scrollIntoView({
        block: "center",
        behavior: fullMotion() ? "smooth" : "instant",
      });
      card?.focus({ preventScroll: true });
    });
    notify(`Descoberta entre as referências carregadas: ${item.title}`);
  };
  const jarvisAction = (action: string) => {
    if (action === "analytics") navigate("analytics");
    else if (action === "saude") navigate("saude");
    else if (action === "opportunities") navigate("oportunidades");
    else if (action === "newsletters") navigate("newsletters");
    else if (action === "publications") navigate("publicacoes");
    else if (action === "studio") {
      navigate("oficina");
      setTimeout(
        () =>
          document
            .querySelector<HTMLElement>(".ecosystem-action input")
            ?.focus(),
        0,
      );
    } else if (action.startsWith("open-studio:")) {
      const id = action.slice(12);
      const draft = ecosystem.data?.studioDrafts.find((d) => d.id === id);
      if (
        draft &&
        (/^https:\/\/studio\.marioserafim\.com\.br\//.test(draft.admin_url) ||
          (location.hostname ===
            "lastro-ecosystem-staging.marioserafim-da.workers.dev" &&
            draft.admin_url.startsWith(
              "https://studio-ecosystem-staging.marioserafim-da.workers.dev/editor/",
            )))
      )
        window.open(draft.admin_url, "_blank", "noopener,noreferrer");
    } else if (action === "surprise") surprise();
    else if (action === "workshop") navigate("oficina");
    else if (action === "radar") navigate("for-you");
    else if (action === "collection")
      document.getElementById("collection-name")?.focus();
    else if (action === "form")
      document
        .querySelector<HTMLElement>('.creation-form input[name="format"]')
        ?.focus();
    else if (action === "queue")
      document.getElementById("curation-queue")?.click();
    else navigate("curadoria");
  };
  return (
    <div className={`app-shell view-${view}`}>
      <a className="skip-link" href="#main">
        Ir para o conteúdo
      </a>
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
              <span className="nav-icon" aria-hidden="true">
                {a.id === "for-you" ? (
                  <Search size={18} />
                ) : a.id === "salvos" ? (
                  <Bookmark size={18} />
                ) : a.id === "oficina" ? (
                  <Layers2 size={18} />
                ) : a.id === "curadoria" ? (
                  <Filter size={18} />
                ) : a.id === "publicacoes" ? (
                  <Newspaper size={18} />
                ) : a.id === "analytics" ? (
                  <ChartNoAxesCombined size={18} />
                ) : a.id === "oportunidades" ? (
                  <Lightbulb size={18} />
                ) : a.id === "newsletters" ? (
                  <Mail size={18} />
                ) : a.id === "saude" ? (
                  <Activity size={18} />
                ) : (
                  <BookOpen size={18} />
                )}
              </span>
              {a.label}
            </button>
          ))}
          <div
            className="quick-access"
            role="group"
            aria-labelledby="quick-access-title"
          >
            <span className="quick-access-title" id="quick-access-title">
              Acessos rápidos
            </span>
            <a
              href="https://marioserafim.com.br/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Globe size={18} aria-hidden="true" />
              <span>
                Portfólio<span className="sr-only"> (abre em nova aba)</span>
              </span>
              <ExternalLink
                className="quick-access-external"
                size={13}
                aria-hidden="true"
              />
            </a>
            <a
              href="https://studio.marioserafim.com.br/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <SquarePen size={18} aria-hidden="true" />
              <span>
                Novo artigo<span className="sr-only"> (abre em nova aba)</span>
              </span>
              <ExternalLink
                className="quick-access-external"
                size={13}
                aria-hidden="true"
              />
            </a>
            <a
              href="https://crm.marioserafim.com.br/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ContactRound size={18} aria-hidden="true" />
              <span>
                CRM<span className="sr-only"> (abre em nova aba)</span>
              </span>
              <ExternalLink
                className="quick-access-external"
                size={13}
                aria-hidden="true"
              />
            </a>
          </div>
        </nav>
        <div className="top-right">
          <span className="private-label">Espaço privado</span>
          <button className="logout-button" onClick={onLogout} type="button">
            Sair
          </button>
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
        <div className="workspace-heading" key={area}>
          <div>
            <span className="workspace-breadcrumb">
              Lastro <span>/</span> {areas.find((a) => a.id === area)?.label}
            </span>
            <h1>
              {area === "for-you"
                ? "Seu radar criativo"
                : area === "salvos"
                  ? "Biblioteca pessoal"
                  : area === "oficina"
                    ? "Oficina de ideias"
                    : area === "curadoria"
                      ? "Curadoria editorial"
                      : area === "analytics"
                        ? "Analytics do portfólio"
                        : area === "saude"
                          ? "Saúde do Ecossistema"
                          : area === "oportunidades"
                            ? "Oportunidades"
                            : area === "newsletters"
                              ? "Newsletters"
                              : "Publicações"}
            </h1>
            <p>
              {area === "for-you"
                ? "Referências que ampliam o olhar. Conexões que você constrói."
                : area === "salvos"
                  ? "Guarde, organize e reencontre o que move suas ideias."
                  : area === "oficina"
                    ? "Das referências a uma proposta com direção."
                    : area === "curadoria"
                      ? "A origem importa. O critério também."
                      : area === "analytics"
                        ? "Dados reais para acompanhar a leitura do seu trabalho."
                        : area === "oportunidades"
                          ? "Acompanhe conversas e próximos passos de cada projeto."
                          : area === "newsletters"
                            ? "Acompanhe os leitores que chegam pelas suas edições."
                            : "O próximo destino das suas ideias."}
            </p>
          </div>
          <AppearanceControls />
          <button
            className="secondary-button"
            onClick={() =>
              navigate(area === "curadoria" ? "for-you" : "curadoria")
            }
          >
            {area === "curadoria" ? "Ver Radar" : "Gerenciar fontes"}
            <ArrowRight size={16} />
          </button>
          <div className="workspace-feedback">
            {toast && <Pulso message={toast} />}
          </div>
        </div>
        {area === "for-you" && (
          <RadarBoard
            onSelect={selection}
            onItemsChange={setRadarItems}
            query={query}
          />
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
                            <Select
                              aria-label={`Adicionar ${item.title} à coleção`}
                              value=""
                              onValueChange={(nextValue) =>
                                void addCollection(item, nextValue)
                              }
                            >
                              <option value="">Escolha uma coleção</option>
                              {collections.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </Select>
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
              <div
                className="work-main"
                key={prompt ? "result" : "configuration"}
              >
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
                    <StudioDraftAction
                      key={prompt.packageId}
                      packageId={prompt.packageId}
                      objective={objective}
                      argument={argument}
                      ecosystem={ecosystem}
                    />
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
                    <details className="work-refinements">
                      <summary>Ajustar linguagem, público e contexto</summary>{" "}
                      <label className="field">
                        Linguagem editorial
                        <Select
                          label="Linguagem editorial"
                          value={tone}
                          onValueChange={(nextValue) => setTone(nextValue)}
                        >
                          <option value="autoral e analítico">
                            Autoral e analítica
                          </option>
                          <option value="didático">Didática</option>
                          <option value="técnico-científico">
                            Técnico-científica
                          </option>
                        </Select>
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
                    </details>
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
        {area === "curadoria" && (
          <Curation
            onOverview={(overview) => setPending(overview.pending)}
            onChanged={() => {
              notify("Curadoria atualizada.");
            }}
          />
        )}
        {area === "publicacoes" && <Ecosystem ecosystem={ecosystem} />}
        {area === "analytics" && <Analytics />}
        {area === "saude" && <Health navigate={navigate} />}
        {area === "oportunidades" && <Opportunities />}
        {area === "newsletters" && <Newsletters />}
      </main>
      <Jarvis
        context={{
          area,
          selected: selected.length,
          available: discoveryPool(feedItems).length,
          saved: saved.length,
          pending,
          ecosystem: ecosystem.error ? null : ecosystem.data,
          packageReady:
            !!prompt &&
            !ecosystem.data?.studioDrafts.some(
              (d) => d.package_id === prompt.packageId,
            ) &&
            !ecosystem.data?.tasks.some(
              (t) => t.kind === "studio" && t.source_id === prompt.packageId,
            ),
        }}
        onAction={jarvisAction}
      />
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
              aria-label="Texto da nota pessoal"
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
    </div>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Não foi possível verificar o acesso.");
        return response.json() as Promise<{ authenticated: boolean }>;
      })
      .then((data) => {
        if (active) setAuthenticated(data.authenticated);
      })
      .catch((e) => {
        if (active) {
          setAuthenticated(false);
          setError(errorText(e));
        }
      });
    const expired = () => {
      window.dispatchEvent(new Event("jarvis:logout"));
      clearJarvisSession();
      sessionStorage.removeItem("jarvis:opportunity");
      setAuthenticated(false);
    };
    window.addEventListener("lastro:unauthorized", expired);
    return () => {
      active = false;
      window.removeEventListener("lastro:unauthorized", expired);
    };
  }, []);
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? "Não foi possível entrar.");
      }
      setPassword("");
      setAuthenticated(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    window.dispatchEvent(new Event("jarvis:logout"));
    clearJarvisSession();
    sessionStorage.removeItem("jarvis:opportunity");
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    setAuthenticated(false);
  }
  if (authenticated === null)
    return (
      <div className="login-shell">
        <p>Verificando acesso…</p>
      </div>
    );
  if (authenticated) return <WorkspaceApp onLogout={() => void logout()} />;
  return (
    <main className="login-shell">
      <AppearanceControls />
      <div className="login-card">
        <span className="login-mark">
          L<span>.</span>
        </span>
        <span className="kicker">LASTRO / HUB CRIATIVO</span>
        <h1>
          Seu repertório,
          <br />
          <em>em um só lugar.</em>
        </h1>
        <p>Este é um espaço privado. Entre com sua senha para continuar.</p>
        <form onSubmit={(event) => void login(event)}>
          <label htmlFor="owner-password">Senha de acesso</label>
          <input
            id="owner-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"} <ArrowRight size={18} />
          </button>
        </form>
      </div>
    </main>
  );
}
