import { useEffect, useState } from "react";

async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`/api/admin/synopses${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error?.message ?? "Não foi possível concluir.");
  return data;
}
const names: Record<string, string> = {
  pending: "Aguardando geração",
  processing: "Em processamento",
  review: "Revisão necessária",
  validated: "Validada",
  blocked: "Aguardando evidência",
  failed: "Falha de processamento",
};
function SynopsisReview({
  item,
  onChange,
}: {
  item: any;
  onChange: () => void;
}) {
  const evidence = item.evidence_json ? JSON.parse(item.evidence_json) : null;
  const [text, setText] = useState(item.text ?? ""),
    [reason, setReason] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [excerpt, setExcerpt] = useState(""),
    [url, setUrl] = useState(""),
    [rights, setRights] = useState("");
  async function action(kind: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(
        `/${item.content_id}/${kind}`,
        kind === "evidence" ? "PUT" : "POST",
        body,
      );
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="curation-card synopsis-review">
      <small>
        {item.source_name} · {item.language ?? "Idioma desconhecido"} ·{" "}
        {names[item.status]}
      </small>
      <h3>{item.title}</h3>
      {item.kind === "paper" && (
        <p className="curation-warning">
          Estudo científico: conferir o objeto pesquisado; não validar
          resultados ou métodos não verificados.
        </p>
      )}
      <p>{item.validation_note}</p>
      <p>
        {item.validation_mode === "automatic"
          ? "Validação automática com suporte rastreável."
          : item.status === "validated"
            ? "Validação editorial."
            : ""}{" "}
        {item.provider_neurons != null
          ? `Consumo informado pela Cloudflare: ${Number(item.provider_neurons).toFixed(2)} neurônios.`
          : ""}
      </p>
      {item.validation_json && (
        <details>
          <summary>Verificação automática das afirmações</summary>
          <p>
            {JSON.parse(item.validation_json).passed
              ? "Todas as frases passaram nas verificações."
              : "Suporte incompleto: revisão necessária."}
          </p>
          <ul>
            {(JSON.parse(item.validation_json).report?.sentences ?? []).map(
              (s: any) => (
                <li key={s.index}>
                  Frase {s.index + 1}:{" "}
                  {s.supported ? "suporte indicado" : "não confirmada"}
                  {s.quotes?.map((q: string, i: number) => (
                    <blockquote key={i}>{q}</blockquote>
                  ))}
                </li>
              ),
            )}
          </ul>
        </details>
      )}
      {evidence && (
        <details>
          <summary>Evidência e procedência</summary>
          <p>{evidence.text}</p>
          <a
            href={/^https?:\/\//.test(evidence.url) ? evidence.url : undefined}
            target="_blank"
            rel="noreferrer"
          >
            Conferir fonte original
          </a>
          <p>{evidence.rightsNote}</p>
          <small>
            Coletada em {new Date(evidence.retrievedAt).toLocaleString("pt-BR")}{" "}
            · {item.generator_version ?? "Aguardando geração"}
          </small>
        </details>
      )}
      {evidence && (
        <>
          <label>
            Sinopse em português (35–60 palavras)
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
            />
          </label>
          <label>
            Justificativa editorial
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            Conferi cada afirmação na evidência e a autorização de uso; o texto
            não inventa fatos nem reproduz trechos protegidos.
          </label>
          <div className="curation-actions">
            <button
              disabled={busy || !checked || reason.trim().length < 20 || !text}
              onClick={() =>
                void action("validate", {
                  text,
                  reason,
                  evidenceSupported: true,
                })
              }
            >
              Validar sinopse
            </button>
            <button
              disabled={busy || reason.trim().length < 20}
              onClick={() => void action("reject", { reason })}
            >
              Manter fora do feed
            </button>
          </div>
        </>
      )}
      <details>
        <summary>Adicionar evidência autorizada</summary>
        <p>
          Use descrição, abstract licenciado ou notas editoriais conferidas.
          Somente título é insuficiente. Salvar substitui a sinopse e exige nova
          validação.
        </p>
        <label>
          Evidência verificável
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            maxLength={3000}
          />
        </label>
        <label>
          URL da procedência
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label>
          Permissão de processamento e reutilização
          <textarea
            value={rights}
            onChange={(e) => setRights(e.target.value)}
          />
        </label>
        <button
          disabled={
            busy ||
            excerpt.length < 200 ||
            rights.trim().length < 20 ||
            !/^https:\/\//.test(url)
          }
          onClick={() =>
            void action("evidence", {
              text: excerpt,
              url,
              rightsNote: rights,
              retrievedAt: new Date().toISOString(),
              kind: "editorial_evidence",
            })
          }
        >
          Salvar evidência para geração
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
export default function Synopses() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  useEffect(() => {
    let active = true;
    api(`?limit=20&offset=${offset}`)
      .then((d) => {
        if (active) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [offset, revision]);
  async function process() {
    setBusy(true);
    try {
      const r = await api("/process", "POST");
      setResult(names[r.status] ?? r.status);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na geração");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Sinopses editoriais">
      <h3>Sinopses editoriais</h3>
      <p>
        Publicação automática somente com evidência autorizada e suporte
        verificado para todas as frases. Incertezas e estudos científicos seguem
        para revisão.
      </p>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            {data.impact.ready ?? 0} de {data.impact.approved} referências
            prontas · {data.impact.portuguese ?? 0} em português ·{" "}
            {data.impact.international ?? 0} em outros idiomas.
          </p>
          <p>
            {data.impact.publishedLast7Days ?? 0} publicações com sinopse nos
            últimos sete dias ·{" "}
            {data.counts
              .filter((c: any) => ["pending", "processing"].includes(c.status))
              .reduce((n: number, c: any) => n + c.count, 0)}{" "}
            aguardando sinopse ·{" "}
            {data.counts.find((c: any) => c.status === "review")?.count ?? 0} em
            revisão editorial.
          </p>
          <p>
            Bloqueios:{" "}
            {data.counts.reduce((n: number, c: any) => n + (c.rights ?? 0), 0)}{" "}
            por direitos ·{" "}
            {data.counts.reduce(
              (n: number, c: any) => n + (c.evidence ?? 0),
              0,
            )}{" "}
            por evidência insuficiente ·{" "}
            {data.counts.reduce(
              (n: number, c: any) => n + (c.technical ?? 0),
              0,
            )}{" "}
            técnicos ·{" "}
            {data.counts.reduce((n: number, c: any) => n + (c.budget ?? 0), 0)}{" "}
            aguardando orçamento.
          </p>
          <p>
            Reserva de IA hoje: {data.usage?.reserved_neurons ?? 0} /{" "}
            {data.dailyBudget} neurônios · {data.usage?.calls ?? 0} gerações
            iniciadas. Reserva conservadora, não medição de cobrança.
          </p>
          <p>
            Consumo informado pela Cloudflare:{" "}
            {Number(data.measured?.providerNeurons ?? 0).toFixed(2)} neurônios
            em {data.measured?.calls ?? 0} chamadas monitoradas;{" "}
            {data.measured?.unmeasured ?? 0} sem medição disponível. Valores
            anteriores ao monitoramento não estão incluídos.
          </p>
          <p>
            Processamento automático a cada cinco minutos. Última execução:{" "}
            {data.scheduler?.last_finished_at
              ? new Date(data.scheduler.last_finished_at).toLocaleString(
                  "pt-BR",
                )
              : "aguardando primeira execução"}{" "}
            · {data.scheduler?.last_status ?? "—"}.
          </p>
          <p>
            {data.required
              ? "Sinopse obrigatória no For You."
              : "Preparação do acervo; requisito ainda não ativado."}{" "}
            {data.enabled ? "Geração habilitada." : "Geração desativada."}
          </p>
          <div className="curation-actions">
            <button onClick={() => setRevision((v) => v + 1)}>Atualizar</button>
            <button
              disabled={busy || !data.enabled}
              onClick={() => void process()}
            >
              Processar próxima referência
            </button>
          </div>
          {result && <p role="status">{result}</p>}
          {data.items.map((i: any) => (
            <SynopsisReview
              key={`${i.content_id}-${i.updated_at}`}
              item={i}
              onChange={() => setRevision((v) => v + 1)}
            />
          ))}
          <div className="curation-actions">
            <button
              disabled={!offset}
              onClick={() => setOffset((v) => Math.max(0, v - 20))}
            >
              Anterior
            </button>
            <span>Página {offset / 20 + 1}</span>
            <button
              disabled={data.items.length < 20}
              onClick={() => setOffset((v) => v + 20)}
            >
              Próxima
            </button>
          </div>
        </>
      )}
    </section>
  );
}
