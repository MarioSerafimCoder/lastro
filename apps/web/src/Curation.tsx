import Select from "./Select";
import Synopses from "./Synopses";
import { useEffect, useState, type FormEvent } from "react";
import { createLastroClient } from "../../../packages/contracts/client";
import {
  sourceInputSchema,
  policySchema,
  type SourceInput,
  type Policy,
  type AdminSource,
  type AdminOverview,
  type ReviewCandidate,
  type IngestionRun,
  type EditorialDecision,
  type Page,
} from "../../../packages/contracts";
const api = createLastroClient();
const emptySource: SourceInput = {
  name: "",
  url: "",
  connector: "rss",
  authority: 50,
  topics: ["design"],
  autoTopics: [],
  languages: ["pt", "en"],
  maxAgeDays: null,
  metadataAllowed: false,
  summaryAllowed: false,
  synopsisAllowed: false,
  synopsisRightsNote: "",
  synopsisLicenseUrl: undefined,
  imageAllowed: false,
  rightsNote: "",
  autoApprove: false,
  intervalMinutes: 1440,
};
const date = (v?: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR") : "Ainda não registrada";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Não foi possível concluir.";
const labels: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  paused: "Pausada",
  duplicate: "Duplicado",
  running: "Em andamento",
  partial: "Fila em andamento",
  completed: "Concluída",
  failed: "Falhou",
  not_modified: "Sem novidades",
  article: "Artigo",
  paper: "Estudo (metadados)",
  news: "Notícia",
  opinion: "Opinião",
  case_study: "Estudo de caso",
  visual_reference: "Referência visual",
  post: "Publicação",
  magazine: "Revista",
  other: "Outro",
  manual_review_required: "Revisão humana obrigatória",
  source_manual_review: "Aprovação automática desativada para a fonte",
  language_unverified: "Idioma não verificado",
  possible_title_duplicate: "Título semelhante já cadastrado",
  secondary_material: "Material secundário",
  promotional_material: "Conteúdo promocional",
  too_old_for_automatic_approval: "Fora do período de aprovação automática",
  authority_below_auto_minimum: "Autoridade abaixo do mínimo automático",
  material_below_auto_minimum:
    "Metadados insuficientes para aprovação automática",
  relevance_below_auto_minimum: "Relevância abaixo do mínimo automático",
  originality_below_auto_minimum: "Originalidade insuficiente",
  scientific_authority_below_minimum: "Fonte científica abaixo do mínimo",
  scientific_provenance_incomplete: "Procedência científica incompleta",
  scientific_title_off_topic: "Título científico não demonstra relevância",
  title_off_topic: "Título não demonstra um assunto prioritário",
  scientific_publication_type_unverified:
    "Tipo de publicação científica exige revisão",
  below_auto_threshold: "Pontuação abaixo do limiar de aprovação automática",
  duplicate_identifier: "Identificador já cadastrado",
  concurrent_duplicate: "Duplicata detectada",
  source_not_approved: "Fonte não aprovada",
  metadata_not_authorized: "Coleta não autorizada",
  missing_title: "Título ausente",
  invalid_url: "Endereço inválido",
  off_topic: "Fora dos assuntos da fonte",
  language_excluded: "Idioma não incluído",
  future_date: "Data futura",
  outside_period: "Fora do período",
  unavailable: "Indisponível",
  retracted: "Retratado",
};
const label = (value: string) => labels[value] ?? value;
const safeLink = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:"
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
};
function SourceForm({
  source,
  onSaved,
  onCancel,
}: {
  source: AdminSource | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<SourceInput>(
    source
      ? sourceInputSchema.parse(
          Object.fromEntries(
            Object.keys(emptySource).map((k) => [
              k,
              source[k as keyof SourceInput],
            ]),
          ),
        )
      : emptySource,
  );
  const [topics, setTopics] = useState(value.topics.join(", ")),
    [autoTopics, setAutoTopics] = useState(value.autoTopics.join(", ")),
    [languages, setLanguages] = useState(value.languages.join(", "));
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const field = (name: keyof SourceInput, v: unknown) =>
    setValue((p) => ({ ...p, [name]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const input = sourceInputSchema.parse({
        ...value,
        topics: topics
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        autoTopics: autoTopics
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        languages: languages
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      });
      await api.saveSource(input, source?.id);
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="curation-form" onSubmit={submit}>
      <h3>{source ? "Editar fonte" : "Cadastrar fonte"}</h3>
      <p>
        Salvar uma alteração exige nova aprovação da fonte. A curadoria
        automática só publica itens que passarem nos critérios editoriais;
        exceções ficam na fila.
      </p>
      <label>
        Nome
        <input
          required
          value={value.name}
          onChange={(e) => field("name", e.target.value)}
        />
      </label>
      <label>
        Endereço do RSS, Atom ou API
        <input
          required
          type="url"
          value={value.url}
          onChange={(e) => field("url", e.target.value)}
        />
      </label>
      <label>
        Conector
        <Select
          label="Conector"
          value={value.connector}
          onValueChange={(nextValue) => field("connector", nextValue)}
        >
          <option value="rss">RSS / Atom</option>
          <option value="openalex">OpenAlex</option>
        </Select>
      </label>
      <label>
        Assuntos, separados por vírgula
        <input
          required
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
        />
      </label>
      <label>
        Assuntos prioritários no título para aprovação automática (vazio: todos
        acima)
        <input
          value={autoTopics}
          onChange={(e) => setAutoTopics(e.target.value)}
        />
      </label>
      <label>
        Idiomas (pt, en…)
        <input
          value={languages}
          onChange={(e) => setLanguages(e.target.value)}
        />
      </label>
      <label>
        Autoridade editorial (0–100)
        <input
          type="number"
          min="0"
          max="100"
          value={value.authority}
          onChange={(e) => field("authority", Number(e.target.value))}
        />
      </label>
      <label>
        Intervalo em minutos
        <input
          type="number"
          min="60"
          max="43200"
          value={value.intervalMinutes}
          onChange={(e) => field("intervalMinutes", Number(e.target.value))}
        />
      </label>
      <label>
        Idade máxima em dias (vazio: sem corte)
        <input
          type="number"
          min="1"
          max="36500"
          value={value.maxAgeDays ?? ""}
          onChange={(e) =>
            field("maxAgeDays", e.target.value ? Number(e.target.value) : null)
          }
        />
      </label>
      <label className="check-line">
        <input
          type="checkbox"
          checked={value.metadataAllowed}
          onChange={(e) => field("metadataAllowed", e.target.checked)}
        />{" "}
        Direitos de coleta dos metadados verificados
      </label>
      <label className="check-line">
        <input
          type="checkbox"
          checked={value.summaryAllowed}
          onChange={(e) => field("summaryAllowed", e.target.checked)}
        />{" "}
        Reprodução de resumos autorizada
      </label>
      <label className="check-line">
        <input
          type="checkbox"
          checked={value.synopsisAllowed ?? false}
          onChange={(e) => field("synopsisAllowed", e.target.checked)}
        />
        Processamento das descrições para sinopses originais autorizado
      </label>
      <label>
        Permissão de processamento e procedência
        <textarea
          value={value.synopsisRightsNote ?? ""}
          required={value.synopsisAllowed}
          minLength={20}
          maxLength={2000}
          onChange={(e) => field("synopsisRightsNote", e.target.value)}
          placeholder="Registre a licença ou autorização verificável. Acesso público, sozinho, não comprova permissão."
        />
      </label>
      <label className="check-line">
        <input
          type="checkbox"
          checked={value.imageAllowed}
          onChange={(e) => field("imageAllowed", e.target.checked)}
        />{" "}
        Exibição de imagens do feed autorizada
      </label>
      <label className="check-line">
        <input
          type="checkbox"
          checked={value.autoApprove}
          onChange={(e) => field("autoApprove", e.target.checked)}
        />{" "}
        Aprovar automaticamente conteúdos que passarem na política editorial
      </label>
      <label>
        Direitos, evidências e limitações
        <textarea
          required
          minLength={5}
          value={value.rightsNote}
          onChange={(e) => field("rightsNote", e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="curation-actions">
        <button disabled={busy} className="primary-button">
          Salvar como pendente
        </button>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
function SourceCard({
  source,
  onEdit,
  onChanged,
}: {
  source: AdminSource;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  async function action(status?: AdminSource["status"]) {
    setBusy(true);
    setResult("");
    try {
      if (status) {
        await api.sourceStatus(source.id, status, reason);
        setReason("");
      } else {
        const r = await api.ingest(source.id);
        setResult(
          `Coleta ${r.status}: ${r.pending} pendentes, ${r.rejected} rejeitados, ${r.duplicates} duplicados; ${r.queuedRemaining} na fila.${r.error ? ` Erro: ${r.error}` : ""}`,
        );
      }
      onChanged();
    } catch (e) {
      setResult(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="curation-card">
      <h3>{source.name}</h3>
      <p>
        {label(source.status)} · {source.connector} · {source.topics.join(", ")}
      </p>
      <a href={safeLink(source.url)} target="_blank" rel="noreferrer">
        Ver endereço da fonte ↗
      </a>
      <p>{source.rightsNote}</p>
      <p>
        Curadoria automática: {source.autoApprove ? "ativa" : "desativada"}.
      </p>
      <p>
        Próxima coleta: {date(source.nextFetchAt)}
        <br />
        Última execução: {date(source.lastRun?.startedAt)}{" "}
        {source.lastRun && label(source.lastRun.status)}
        <br />
        Última coleta bem-sucedida: {date(source.lastSuccessAt)}
        <br />
        Última referência descoberta: {date(source.lastReferenceAt)} ·{" "}
        {source.queued ?? 0} na fila.
      </p>
      {source.lastSuccessAt &&
        Date.now() - Date.parse(source.lastReferenceAt ?? source.createdAt) >=
          30 * 86400000 && (
          <p>
            Sem novas referências indexadas nos últimos 30 dias. A fonte pode
            ter sido consultada normalmente sem material elegível novo.
          </p>
        )}
      {source.lastRun?.error && (
        <p role="alert">Falha na última coleta: {source.lastRun.error}</p>
      )}
      <label>
        Justificativa da decisão
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
        />
      </label>
      <div className="curation-actions">
        {(
          [
            ["approved", "Aprovar"],
            ["paused", "Pausar"],
            ["rejected", "Rejeitar"],
          ] as const
        ).map(([status, label]) => (
          <button
            key={status}
            disabled={busy || reason.trim().length < 5}
            onClick={() => void action(status)}
          >
            {label}
          </button>
        ))}
        <button disabled={busy} onClick={onEdit}>
          Editar
        </button>
        <button
          disabled={busy || source.status !== "approved"}
          onClick={() => void action()}
        >
          Coletar / continuar fila
        </button>
      </div>
      {result && <p role="status">{result}</p>}
    </article>
  );
}
function CandidateCard({
  item,
  source,
  onChanged,
}: {
  item: ReviewCandidate;
  source?: string;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState(""),
    [correction, setCorrection] = useState<
      Partial<ReviewCandidate["metadata"]>
    >({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function review(decision: "approved" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await api.review(item.id, {
        decision,
        reason,
        correction,
      });
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const m = item.metadata;
  return (
    <article className="curation-card">
      <span className="kicker">
        {source ?? item.sourceId} · {label(item.outcome)}
      </span>
      <h3>{m.title || "Título ausente"}</h3>
      <p>
        {m.authors.map((a) => a.name).join(", ") || "Autoria não informada"} ·{" "}
        {date(m.publishedAt)} · {label(m.kind)} ·{" "}
        {m.language ?? "Idioma ausente"}
      </p>
      <a href={safeLink(m.url)} target="_blank" rel="noreferrer">
        Conferir original ↗
      </a>
      <p>
        Pontuação calculada: {item.quality.score.toFixed(1)} / 100. Relevância:{" "}
        {item.quality.factors.relevance} / 100. Não comprova validade
        científica.
      </p>
      {m.kind === "paper" && (
        <p className="curation-warning">
          A indexação bibliográfica não valida método, resultados ou conclusões.
          Revise o estudo original antes de usar suas afirmações como evidência.
        </p>
      )}
      <p>{item.reasons.map(label).join(" · ")}</p>
      <ul>
        {item.quality.limitations.map((v) => (
          <li key={v}>{v}</li>
        ))}
      </ul>
      <p>
        Licença: {m.license ?? "Não informada"}. {m.accessNote}
      </p>
      <details>
        <summary>Corrigir metadados</summary>
        <p>Corrija apenas informações conferidas na fonte original.</p>
        <label>
          Título
          <input
            value={correction.title ?? m.title}
            onChange={(e) =>
              setCorrection((v) => ({ ...v, title: e.target.value }))
            }
          />
        </label>
        <label>
          Endereço original
          <input
            type="url"
            value={correction.url ?? m.url}
            onChange={(e) =>
              setCorrection((v) => ({ ...v, url: e.target.value }))
            }
          />
        </label>
        <label>
          Autores (um por linha)
          <textarea
            value={(correction.authors ?? m.authors)
              .map((a) => a.name)
              .join("\n")}
            onChange={(e) =>
              setCorrection((v) => ({
                ...v,
                authors: e.target.value
                  .split("\n")
                  .filter(Boolean)
                  .map(
                    (name) =>
                      m.authors.find((a) => a.name === name) ?? {
                        name,
                        orcid: null,
                        openalex: null,
                      },
                  ),
              }))
            }
          />
        </label>
        <label>
          Data de publicação
          <input
            type="date"
            value={(
              ("publishedAt" in correction
                ? correction.publishedAt
                : m.publishedAt) ?? ""
            ).slice(0, 10)}
            onChange={(e) =>
              setCorrection((v) => ({
                ...v,
                publishedAt: e.target.value || null,
              }))
            }
          />
        </label>
        <label>
          Idioma
          <Select
            label="Idioma"
            value={
              ("language" in correction ? correction.language : m.language) ??
              ""
            }
            onValueChange={(nextValue) =>
              setCorrection((v) => ({ ...v, language: nextValue || null }))
            }
          >
            <option value="">Não informado</option>
            <option value="pt">Português</option>
            <option value="en">Inglês</option>
            <option value="es">Espanhol</option>
          </Select>
        </label>
      </details>
      <label>
        Justificativa editorial
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={5}
        />
      </label>
      <div className="curation-actions">
        <button
          disabled={
            busy || reason.trim().length < 5 || item.outcome === "duplicate"
          }
          onClick={() => void review("approved")}
        >
          Aprovar referência
        </button>
        <button
          disabled={
            busy || reason.trim().length < 5 || item.outcome === "duplicate"
          }
          onClick={() => void review("rejected")}
        >
          Rejeitar referência
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
function PolicyEditor() {
  const [value, setValue] = useState<Policy | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api
      .policy()
      .then(setValue)
      .catch((e) => setError(message(e)));
  }, []);
  const setGate = (key: keyof Policy["autoApproval"], number: number) =>
    setValue((p) =>
      p
        ? {
            ...p,
            autoApproval: { ...p.autoApproval, [key]: number },
          }
        : p,
    );
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      const next = policySchema.parse({
        ...value,
        version: `lastro-${Date.now().toString(36)}`,
      });
      setValue(await api.savePolicy(next));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!value) return <p role="status">Carregando política editorial…</p>;
  const gates: [keyof Policy["autoApproval"], string][] = [
    ["minimumAuthority", "Confiabilidade mínima da fonte"],
    ["minimumMaterial", "Completude mínima dos metadados"],
    ["minimumRelevance", "Relevância mínima"],
    ["minimumOriginality", "Originalidade mínima"],
    ["minimumScientificAuthority", "Confiabilidade mínima para estudos"],
  ];
  return (
    <form className="curation-form" onSubmit={(e) => void save(e)}>
      <h3>Política editorial</h3>
      <p>
        Versão ativa: {value.version}. Alterações criam uma nova versão
        auditável e passam a valer para novas coletas.
      </p>
      <label>
        Pontuação mínima para aprovação automática
        <input
          type="number"
          min="0"
          max="100"
          value={value.approvalThreshold}
          onChange={(e) =>
            setValue({ ...value, approvalThreshold: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Pontuação mínima no For You
        <input
          type="number"
          min="0"
          max="100"
          value={value.minimumQuality}
          onChange={(e) =>
            setValue({ ...value, minimumQuality: Number(e.target.value) })
          }
        />
      </label>
      {gates.map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min="0"
            max="100"
            value={value.autoApproval[key]}
            onChange={(e) => setGate(key, Number(e.target.value))}
          />
        </label>
      ))}
      <label>
        Idade máxima para aprovação automática (dias)
        <input
          type="number"
          min="1"
          max="36500"
          value={value.autoApproval.maximumAgeDays}
          onChange={(e) => setGate("maximumAgeDays", Number(e.target.value))}
        />
      </label>
      <label>
        Peso da diversidade no For You
        <input
          type="number"
          min="0"
          max="100"
          value={value.ranking.diversity}
          onChange={(e) =>
            setValue({
              ...value,
              ranking: { ...value.ranking, diversity: Number(e.target.value) },
            })
          }
        />
      </label>
      <button className="primary-button" disabled={busy}>
        Salvar nova versão
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export default function Curation({
  onOverview,
  onChanged,
}: {
  onOverview?: (overview: AdminOverview) => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState("sources"),
    [sources, setSources] = useState<AdminSource[]>([]),
    [overview, setOverview] = useState<AdminOverview | null>(null),
    [queue, setQueue] = useState<Page<ReviewCandidate>>({
      items: [],
      nextCursor: null,
    }),
    [runs, setRuns] = useState<Page<IngestionRun>>({
      items: [],
      nextCursor: null,
    }),
    [decisions, setDecisions] = useState<Page<EditorialDecision>>({
      items: [],
      nextCursor: null,
    });
  const [outcome, setOutcome] = useState("pending"),
    [offset, setOffset] = useState(0),
    [runOffset, setRunOffset] = useState(0),
    [decisionOffset, setDecisionOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<AdminSource | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      const all: AdminSource[] = [];
      let cursor = 0;
      do {
        const page = await api.sources(cursor);
        all.push(...page.items);
        if (!page.nextCursor) break;
        cursor = Number(page.nextCursor);
      } while (true);
      const [o, q, r, d] = await Promise.all([
        api.adminOverview(),
        api.candidates(outcome, offset),
        api.runs(runOffset),
        api.decisions(decisionOffset),
      ]);
      if (active) {
        setSources(all);
        setOverview(o);
        onOverview?.(o);
        if (revision > 0) onChanged?.();
        setQueue(q);
        setRuns(r);
        setDecisions(d);
      }
    }
    void load()
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [outcome, offset, runOffset, decisionOffset, revision]);
  const refresh = () => {
    setRevision((v) => v + 1);
  };
  return (
    <section className="page-section curation">
      <div className="section-heading">
        <div>
          <span className="kicker">CURADORIA / ESPAÇO DO PROPRIETÁRIO</span>
          <h2>Critério antes de volume.</h2>
        </div>
        <button onClick={refresh}>Atualizar</button>
      </div>
      {overview && (
        <>
          <div className="curation-metrics">
            <div>
              <span>Agendamento</span>
              <strong>
                {overview.ingestEnabled ? "Habilitado" : "Desativado"}
              </strong>
            </div>
            <div>
              <span>Fontes</span>
              <strong>{overview.sources}</strong>
            </div>
            <div>
              <span>Aguardando revisão</span>
              <strong>{overview.pending}</strong>
            </div>
            <div>
              <span>Referências aprovadas</span>
              <strong>{overview.approved}</strong>
            </div>
          </div>
          <p className="curation-language" role="status">
            Acervo editorial aprovado: {overview.portuguese} em português ·{" "}
            {overview.international} em outros idiomas ·{" "}
            {overview.unknownLanguage} sem idioma verificado.
            {overview.portuguese < 10 &&
              " O estoque em português ainda limita lotes completos de 20 referências."}
          </p>
        </>
      )}
      <nav className="curation-actions" aria-label="Seções da Curadoria">
        {[
          ["sources", "Fontes"],
          ["queue", "Fila de revisão"],
          ["policy", "Política"],
          ["synopses", "Sinopses"],
          ["history", "Histórico"],
        ].map(([id, label]) => (
          <button
            id={`curation-${id}`}
            key={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error ? (
        <p role="alert">Falha ao carregar a Curadoria: {error}</p>
      ) : loading ? (
        <p role="status">Carregando Curadoria…</p>
      ) : (
        <>
          {tab === "sources" && (
            <>
              <p>
                Hosts permitidos: {overview?.allowedHosts.join(", ")}. Alterar
                esta lista exige configuração do operador.
              </p>
              <button onClick={() => setEditing(null)}>Cadastrar fonte</button>
              {editing !== undefined && (
                <SourceForm
                  key={editing?.id ?? "new"}
                  source={editing}
                  onCancel={() => setEditing(undefined)}
                  onSaved={() => {
                    setEditing(undefined);
                    refresh();
                  }}
                />
              )}
              {sources.length === 0 && (
                <p>
                  Nenhuma fonte cadastrada. Comece pelo catálogo verificado da
                  Etapa 03.
                </p>
              )}
              {sources.map((s) => (
                <SourceCard
                  key={s.id}
                  source={s}
                  onEdit={() => setEditing(s)}
                  onChanged={refresh}
                />
              ))}
            </>
          )}
          {tab === "queue" && (
            <>
              <label>
                Estado
                <Select
                  label="Estado"
                  value={outcome}
                  onValueChange={(nextValue) => {
                    setOutcome(nextValue);
                    setOffset(0);
                  }}
                >
                  {[
                    ["pending", "Aguardando revisão"],
                    ["approved", "Aprovados"],
                    ["rejected", "Rejeitados"],
                    ["duplicate", "Duplicados"],
                    ["", "Todos"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </label>
              {queue.items.length === 0 && (
                <p>Nenhum candidato neste estado.</p>
              )}
              {queue.items.map((i) => (
                <CandidateCard
                  key={i.id}
                  item={i}
                  source={sources.find((s) => s.id === i.sourceId)?.name}
                  onChanged={refresh}
                />
              ))}
              <Pager
                offset={offset}
                next={queue.nextCursor}
                onChange={setOffset}
              />
            </>
          )}
          {tab === "policy" && <PolicyEditor />}
          {tab === "synopses" && <Synopses />}
          {tab === "history" && (
            <>
              <h3>Execuções de coleta</h3>
              {runs.items.length === 0 && <p>Nenhuma execução registrada.</p>}
              {runs.items.map((r) => (
                <article className="curation-card" key={r.id}>
                  <strong>
                    {sources.find((s) => s.id === r.sourceId)?.name ??
                      r.sourceId}
                  </strong>
                  <p>
                    {date(r.startedAt)} · {label(r.status)}
                  </p>
                  <p>
                    Recebidos nesta chamada: {r.received ?? "não registrado"} ·
                    Processados:{" "}
                    {r.accepted + r.pending + r.rejected + r.duplicates} ·
                    Aprovados: {r.accepted} · Pendentes: {r.pending} ·
                    Rejeitados: {r.rejected} · Duplicados: {r.duplicates} ·
                    Restantes: {r.queuedRemaining}
                  </p>
                  {r.error && <p role="alert">{r.error}</p>}
                </article>
              ))}
              <Pager
                offset={runOffset}
                next={runs.nextCursor}
                onChange={setRunOffset}
              />
              <h3>Decisões editoriais</h3>
              {decisions.items.length === 0 && (
                <p>Nenhuma decisão registrada.</p>
              )}
              {decisions.items.map((d) => (
                <article className="curation-card" key={d.id}>
                  <strong>
                    {d.scope === "source" ? "Fonte" : "Conteúdo"} ·{" "}
                    {label(d.decision)}
                  </strong>
                  <p>{d.reason}</p>
                  <small>
                    {date(d.createdAt)} · {d.targetId}
                  </small>
                </article>
              ))}
              <Pager
                offset={decisionOffset}
                next={decisions.nextCursor}
                onChange={setDecisionOffset}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
function Pager({
  offset,
  next,
  onChange,
}: {
  offset: number;
  next: string | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="curation-actions">
      <button
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - 20))}
      >
        Anterior
      </button>
      <span>Página {offset / 20 + 1}</span>
      <button disabled={!next} onClick={() => onChange(Number(next))}>
        Próxima
      </button>
    </div>
  );
}
