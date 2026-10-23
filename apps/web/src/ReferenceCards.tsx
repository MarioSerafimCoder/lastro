import Select from "./Select";
import { useState, type ReactNode } from "react";
import {
  BookOpen,
  Heart,
  Plus,
  ChevronDown,
  ExternalLink,
  Search,
  Filter,
} from "lucide-react";
import type { Content, FeedItem, Source } from "../../../packages/contracts";
import type { SearchQuery } from "../../../packages/contracts/client";
import { presentContent } from "./experience";
const kindName: Record<Content["kind"], string> = {
  news: "Notícia",
  opinion: "Opinião",
  article: "Artigo",
  paper: "Estudo (metadados)",
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
      }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value))
    : "Data não informada";

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

type CardProps = {
  item: Content;
  explanation?: FeedItem["explanation"];
  onFavorite: (c: Content) => void;
  onSelect: (c: Content) => void;
  onDismiss?: (c: Content) => void;
  onRead: (c: Content) => void;
  onOpen: (c: Content) => void;
  onNote?: (c: Content) => void;
  onExplore?: (topic: string) => void;
  busy: boolean;
  discovering?: boolean;
  prominence?: "lead" | "secondary";
  fresh?: boolean;
};
export function ContentCard({
  item,
  explanation,
  onFavorite,
  onSelect,
  onDismiss,
  onRead,
  onOpen,
  onNote,
  onExplore,
  busy,
  discovering = false,
  prominence,
  fresh = false,
}: CardProps) {
  const [why, setWhy] = useState(false);
  const author = item.authors
    .map((a) => a.name.replace(/^.*\((.*)\)$/, "$1"))
    .join(", ");
  return (
    <article
      id={`content-${item.id}`}
      tabIndex={-1}
      className={`content-card kind-${item.kind} ${prominence ? `editorial-${prominence}` : ""} ${fresh ? "is-new" : ""} ${item.state.selected ? "is-selected" : ""} ${item.state.favorite ? "is-saved" : ""} ${item.state.read ? "is-read" : ""} ${discovering ? "is-discovering" : ""}`}
    >
      {item.imageUrl && (
        <img
          className="card-image"
          src={item.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <div className="card-copy">
        <div className="eyebrow">
          {fresh && <span className="new-label">Nova</span>}
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
          <h3>{presentContent(item).originalTitle}</h3>
          <ExternalLink size={17} aria-hidden="true" />
        </a>
        {item.description && <p className="description">{item.description}</p>}
        <div className="byline">
          <span>{author || "Autoria não informada"}</span>
          <span>{date(item.publishedAt)}</span>
        </div>
        <div className="badges">
          {item.language && (
            <span className="badge subtle">{item.language.toUpperCase()}</span>
          )}
          {item.topics.slice(0, 3).map((topic) =>
            onExplore ? (
              <button
                key={topic}
                className="topic-button"
                onClick={() => onExplore(topic)}
                aria-label={`Continue explorando ${topic}`}
              >
                {topic}
              </button>
            ) : (
              <span className="badge subtle" key={topic}>
                {topic}
              </span>
            ),
          )}
          {item.annotations.map((a) => (
            <span key={a.id} className="badge">
              {knowledgeName[a.classification]}
            </span>
          ))}
          {item.kind === "paper" && (
            <span className="badge subtle">Método não revisado</span>
          )}
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
export function Filters({
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
          <Select
            label="Assunto"
            value={query.topic ?? ""}
            onValueChange={(nextValue) =>
              setQuery({
                ...query,
                topic: nextValue || undefined,
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
                {(
                  {
                    design: "Design",
                    branding: "Branding",
                    typography: "Tipografia",
                    visual: "Referências visuais",
                    perception: "Percepção",
                    technology: "Tecnologia",
                    cultura: "Cultura",
                    css: "CSS",
                    ux: "UX",
                    accessibility: "Acessibilidade",
                  } as Record<string, string>
                )[t] ?? t}
              </option>
            ))}
          </Select>
        </label>
        <label>
          <span className="sr-only">Fonte</span>
          <Select
            label="Fonte"
            value={query.sourceId ?? ""}
            onValueChange={(nextValue) =>
              setQuery({
                ...query,
                sourceId: nextValue || undefined,
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
          </Select>
        </label>
        <label>
          <span className="sr-only">Formato</span>
          <Select
            label="Formato"
            value={query.kind ?? ""}
            onValueChange={(nextValue) =>
              setQuery({
                ...query,
                kind: (nextValue as Content["kind"]) || undefined,
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
          </Select>
        </label>
      </div>
    </div>
  );
}
