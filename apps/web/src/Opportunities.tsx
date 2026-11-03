import { useEffect, useState } from "react";
export type Opportunity = {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  project_type: string;
  area: string;
  budget: string;
  description: string;
  received_at: string;
  status: string;
  next_contact: string | null;
  notes: string;
};
export const statuses: Record<string, string> = {
  novo: "Novo",
  em_conversa: "Em conversa",
  proposta_enviada: "Proposta enviada",
  ganho: "Ganho",
  perdido: "Perdido",
  arquivado: "Arquivado",
};
export async function commercialApi(path: string, init?: RequestInit) {
  const r = await fetch("/api/" + path, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!r.ok)
    throw new Error("Não foi possível concluir a operação. Tente novamente.");
  return r.json();
}
export default function Opportunities() {
  const [items, setItems] = useState<Opportunity[]>([]),
    [selected, setSelected] = useState<Opportunity | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  async function load() {
    try {
      const data = await commercialApi("opportunities");
      setItems(data.items);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(remove = false) {
    if (!selected || busy) return;
    if (
      remove &&
      !window.confirm(
        "Excluir esta oportunidade e suas observações? Esta ação não pode ser desfeita.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await commercialApi("opportunities/" + selected.id, {
        method: remove ? "DELETE" : "PATCH",
        body: remove
          ? undefined
          : JSON.stringify({
              status: selected.status,
              notes: selected.notes,
              next_contact: selected.next_contact,
            }),
      });
      setSelected(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = (o: Opportunity) =>
    !["ganho", "perdido", "arquivado"].includes(o.status);
  const overdue = items.filter(
    (o) =>
      active(o) && o.next_contact && Date.parse(o.next_contact) <= Date.now(),
  );
  const visible = items.filter(
    (o) =>
      (!filter || o.status === filter) &&
      [o.name, o.email, o.project_type, o.description]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="page-section ecosystem" aria-label="Oportunidades">
      <h2>Pedidos recebidos</h2>
      <p>Conversas sobre projetos, em um espaço privado.</p>
      {error && <p role="alert">{error}</p>}
      <div className="commercial-stats">
        {[
          ["Total", items.length],
          ["Novos", items.filter((o) => o.status === "novo").length],
          [
            "Em andamento",
            items.filter((o) => o.status === "em_conversa").length,
          ],
          [
            "Propostas enviadas",
            items.filter((o) => o.status === "proposta_enviada").length,
          ],
          ["Acompanhamento pendente", overdue.length],
        ].map(([label, value]) => (
          <article className="pub-card" key={label}>
            <span>{label}</span>
            <h2>{loaded ? value : "—"}</h2>
          </article>
        ))}
      </div>
      <div className="commercial-controls">
        <label>
          Buscar
          <input
            value={query}
            maxLength={180}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Status
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(statuses).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!loaded && !error && <p>Carregando…</p>}
      {loaded && !visible.length && <p>Nenhuma oportunidade encontrada.</p>}
      <div className="commercial-list">
        {visible.map((o) => (
          <article className="pub-card" key={o.id}>
            <h2>{o.name}</h2>
            <p>
              {o.project_type} · {statuses[o.status]}
            </p>
            <p>{new Date(o.received_at).toLocaleDateString("pt-BR")}</p>
            <button onClick={() => setSelected({ ...o })}>
              Abrir detalhes
            </button>
          </article>
        ))}
      </div>
      {selected && (
        <article
          className="pub-card commercial-detail"
          aria-label="Detalhes da oportunidade"
        >
          <h2>{selected.name}</h2>
          <p>{selected.description}</p>
          <p>
            {selected.area || "Área não informada"} ·{" "}
            {selected.budget || "Orçamento não informado"}
          </p>
          <p>
            <a href={"mailto:" + selected.email}>Enviar e-mail</a>
            {selected.whatsapp && (
              <>
                {" "}
                ·{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={"https://wa.me/" + selected.whatsapp.replace(/\D/g, "")}
                >
                  Abrir WhatsApp
                </a>
              </>
            )}
          </p>
          <label>
            Status
            <select
              aria-label="Status da oportunidade"
              value={selected.status}
              onChange={(e) =>
                setSelected({ ...selected, status: e.target.value })
              }
            >
              {Object.entries(statuses).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Próximo contato
            <input
              type="datetime-local"
              value={
                selected.next_contact
                  ? new Date(
                      Date.parse(selected.next_contact) -
                        new Date(selected.next_contact).getTimezoneOffset() *
                          60000,
                    )
                      .toISOString()
                      .slice(0, 16)
                  : ""
              }
              onChange={(e) =>
                setSelected({
                  ...selected,
                  next_contact: e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                })
              }
            />
          </label>
          <label>
            Observações privadas
            <textarea
              maxLength={4000}
              value={selected.notes}
              onChange={(e) =>
                setSelected({ ...selected, notes: e.target.value })
              }
            />
          </label>
          <div className="commercial-controls">
            <button disabled={busy} onClick={() => void save()}>
              Salvar
            </button>
            <button disabled={busy} onClick={() => setSelected(null)}>
              Fechar
            </button>
            <button disabled={busy} onClick={() => void save(true)}>
              Excluir
            </button>
          </div>
        </article>
      )}
      <p>
        Até 1.000 registros recentes. Retenção padrão de 365 dias, configurável
        pelo administrador; limpeza ao receber ou consultar oportunidades. Não
        há envio automático de mensagens.
      </p>
    </section>
  );
}
