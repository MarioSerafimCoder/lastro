import { useState } from "react";
import { jarvisApi } from "./jarvis-client";
import {
  memoryTypes,
  type BrainMemory,
  type MemoryDraft,
} from "../../../packages/contracts/jarvis-brain";
const empty = (): MemoryDraft => ({
  type: "preferencia",
  title: "",
  summary: "",
  keywords: [],
  project: null,
  origin: "Registro do proprietário",
  certainty: "preferencia",
});
type Drive = { enabled: boolean; connected: boolean; message: string };
export default function JarvisMemory() {
  const [memories, setMemories] = useState<BrainMemory[]>([]),
    [drive, setDrive] = useState<Drive | null>(null);
  const [query, setQuery] = useState(""),
    [project, setProject] = useState(""),
    [type, setType] = useState(""),
    [state, setState] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [draft, setDraft] = useState<MemoryDraft>(empty),
    [editing, setEditing] = useState<BrainMemory | null>(null);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [deleting, setDeleting] = useState<{
      memory: BrainMemory;
      drive: boolean;
    } | null>(null),
    [confirmation, setConfirmation] = useState("");
  const [document, setDocument] = useState<{
    id: string;
    content: string;
  } | null>(null);
  async function load() {
    const params = new URLSearchParams({ q: query });
    if (project) params.set("project", project);
    if (type) params.set("type", type);
    if (state) params.set("state", state);
    if (from)
      params.set("from", new Date(from + "T00:00:00-03:00").toISOString());
    if (to)
      params.set("to", new Date(to + "T23:59:59.999-03:00").toISOString());
    const result = await jarvisApi("jarvis/brain?" + params);
    setMemories(result.memories);
    setDrive(await jarvisApi("jarvis/drive"));
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível atualizar a memória.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function change(
    memory: BrainMemory,
    operation: string,
    extra: Record<string, unknown> = {},
  ) {
    await jarvisApi("jarvis/brain/" + memory.id, {
      method: "PATCH",
      body: JSON.stringify({ version: memory.version, operation, ...extra }),
    });
    await load();
  }
  const phrase = deleting
    ? `EXCLUIR ${deleting.drive ? "DRIVE " : ""}${deleting.memory.id}`
    : "";
  return (
    <details
      className="jarvis-settings jarvis-memory"
      onToggle={(e) => {
        if (e.currentTarget.open) void run(load);
      }}
    >
      <summary>Memória do Jarvis</summary>
      <p>
        Registros seletivos entre sessões. Lembranças podem precisar de revisão;
        limpar a conversa preserva esta memória.
      </p>
      <form
        className="jarvis-memory-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void run(load);
        }}
      >
        <label>
          Assunto ou ID
          <input
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Projeto exato
          <input
            value={project}
            maxLength={100}
            onChange={(e) => setProject(e.target.value)}
          />
        </label>
        <label>
          Tipo
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos</option>
            {memoryTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">Ativas</option>
            {["proposta", "confirmada", "arquivada"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Atualizada desde
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button className="secondary-button" disabled={busy}>
          Buscar / atualizar
        </button>
      </form>
      <button
        className="secondary-button"
        disabled={busy}
        onClick={() => {
          setEditing(null);
          setDraft(empty());
          setDraftId(crypto.randomUUID());
          setAdding(true);
        }}
      >
        Adicionar memória
      </button>
      {adding && (
        <form
          className="jarvis-memory-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (editing) await change(editing, "corrigir", { draft });
              else {
                await jarvisApi("jarvis/brain", {
                  method: "POST",
                  body: JSON.stringify({
                    id: draftId,
                    draft,
                    state: "confirmada",
                  }),
                });
                await load();
              }
              setAdding(false);
              setEditing(null);
            });
          }}
        >
          <label>
            Título
            <input
              required
              minLength={3}
              maxLength={120}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            Resumo
            <textarea
              required
              minLength={3}
              maxLength={1600}
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />
          </label>
          <label>
            Tipo
            <select
              value={draft.type}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  type: e.target.value as MemoryDraft["type"],
                })
              }
            >
              {memoryTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Natureza
            <select
              value={draft.certainty}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  certainty: e.target.value as MemoryDraft["certainty"],
                })
              }
            >
              {["fato", "preferencia", "hipotese", "provisoria"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Projeto
            <input
              maxLength={100}
              value={draft.project ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, project: e.target.value || null })
              }
            />
          </label>
          <label>
            Palavras-chave (separadas por vírgula)
            <input
              maxLength={500}
              value={draft.keywords.join(",")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  keywords: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 16),
                })
              }
            />
          </label>
          <label>
            Origem
            <input
              required
              maxLength={240}
              value={draft.origin}
              onChange={(e) => setDraft({ ...draft, origin: e.target.value })}
            />
          </label>
          <button className="secondary-button" disabled={busy}>
            Salvar {editing ? "correção" : "memória confirmada"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setAdding(false)}
          >
            Cancelar
          </button>
        </form>
      )}
      {busy && <p role="status">Consultando a memória…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !memories.length && <p>Nenhuma memória neste filtro.</p>}
      <div className="jarvis-memory-list">
        {memories.map((m) => (
          <article key={m.id}>
            <strong>{m.title}</strong>
            <p>{m.summary}</p>
            <small>
              {m.type} · {m.certainty} · {m.state} · versão {m.version}
              <br />
              {m.project ? `Projeto: ${m.project} · ` : ""}Origem: {m.origin}
              <br />
              Criada: {new Date(m.createdAt).toLocaleString("pt-BR")} ·
              Atualizada: {new Date(m.updatedAt).toLocaleString("pt-BR")}
              <br />
              Drive: {m.sync}
              {m.driveVersion ? ` · versão ${m.driveVersion}` : ""}
              {m.driveId ? ` · ID ${m.driveId}` : ""}
              <br />
              ID: {m.id}
            </small>
            <div className="jarvis-memory-actions">
              {m.state === "proposta" && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void run(() => change(m, "aprovar"))}
                >
                  Aprovar
                </button>
              )}
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setEditing(m);
                  setDraft({
                    type: m.type,
                    title: m.title,
                    summary: m.summary,
                    keywords: m.keywords,
                    project: m.project,
                    origin: m.origin,
                    certainty: m.certainty,
                  });
                  setAdding(true);
                }}
              >
                Corrigir
              </button>
              {m.state !== "arquivada" && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void run(() => change(m, "arquivar"))}
                >
                  {m.state === "proposta" ? "Rejeitar" : "Arquivar"}
                </button>
              )}
              <button
                className="secondary-button"
                disabled={busy || !!m.driveId}
                onClick={() => {
                  setDeleting({ memory: m, drive: false });
                  setConfirmation("");
                }}
              >
                Excluir
              </button>
              {drive?.enabled &&
                drive.connected &&
                m.state === "confirmada" && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await jarvisApi(`jarvis/brain/${m.id}/sync`, {
                          method: "POST",
                          body: JSON.stringify({ version: m.version }),
                        });
                        await load();
                      })
                    }
                  >
                    Salvar versão no Drive
                  </button>
                )}
              {m.driveId && (
                <>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const d = await jarvisApi(
                          `jarvis/brain/${m.id}/document`,
                        );
                        setDocument({ id: m.id, content: d.content });
                      })
                    }
                  >
                    Ler documento
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setDeleting({ memory: m, drive: true });
                      setConfirmation("");
                    }}
                  >
                    Remover documento do Drive
                  </button>
                </>
              )}
            </div>
            {m.driveId && (
              <small>
                Para excluir a memória, remova primeiro o documento vinculado.
              </small>
            )}
          </article>
        ))}
      </div>
      {deleting && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (deleting.drive)
                await jarvisApi(`jarvis/brain/${deleting.memory.id}/document`, {
                  method: "DELETE",
                  body: JSON.stringify({
                    version: deleting.memory.version,
                    confirmation,
                  }),
                });
              else await change(deleting.memory, "excluir", { confirmation });
              setDeleting(null);
              await load();
            });
          }}
        >
          <label>
            Para excluir {deleting.memory.title}, digite <code>{phrase}</code>
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || confirmation !== phrase}
          >
            Confirmar exclusão
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setDeleting(null)}
          >
            Cancelar
          </button>
        </form>
      )}
      {document && (
        <div>
          <strong>Documento · {document.id}</strong>
          <pre>{document.content}</pre>
          <button
            className="secondary-button"
            onClick={() => setDocument(null)}
          >
            Fechar documento
          </button>
        </div>
      )}
      <p>
        Google Drive:{" "}
        {drive?.connected
          ? "conexão registrada"
          : drive?.enabled
            ? "desconectado"
            : "desativado"}
        . {drive?.message}{" "}
        <a href="/api/jarvis/drive/privacy" target="_blank" rel="noreferrer">
          Privacidade
        </a>
        {" · "}
        <a href="/api/jarvis/drive/terms" target="_blank" rel="noreferrer">
          Termos
        </a>
      </p>
      {drive?.enabled && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await jarvisApi("jarvis/drive/oauth", {
                method: "POST",
              });
              window.location.assign(r.url);
            })
          }
        >
          {drive.connected
            ? "Reconectar Google Drive"
            : "Conectar Google Drive"}
        </button>
      )}
      {drive?.connected && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const confirmation = window.prompt(
                "Digite REVOGAR DRIVE para revogar o acesso. Memórias D1 e documentos serão preservados.",
              );
              if (confirmation !== "REVOGAR DRIVE") return;
              await jarvisApi("jarvis/drive/disconnect", {
                method: "POST",
                body: JSON.stringify({ confirmation }),
              });
              await load();
            })
          }
        >
          Revogar acesso ao Drive
        </button>
      )}
    </details>
  );
}
