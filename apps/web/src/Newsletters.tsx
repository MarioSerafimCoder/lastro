import { useEffect, useState } from "react";
import { commercialApi } from "./Opportunities";
import type { AnalyticsOverview } from "../../../packages/contracts/analytics";
type Summary = {
  analytics: AnalyticsOverview;
  crm: null | {
    campaigns: Array<{
      id: string;
      subject: string;
      campaignSlug: string;
      sentAt: string | null;
      recipients: number | null;
    }>;
    limited: boolean;
    fetchedAt: number;
  };
};
export default function Newsletters() {
  const [days, setDays] = useState(7),
    [data, setData] = useState<Summary | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    commercialApi("newsletters?days=" + days)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [days]);
  const report = (dimension: string) =>
    data?.analytics.data?.reports.find((r) => r.dimension === dimension);
  const campaigns = report("sessionCampaignName");
  return (
    <section
      className="page-section ecosystem analytics"
      aria-label="Newsletters"
    >
      <h2>Desempenho das newsletters</h2>
      <p>
        Tráfego atribuído a mais_um_cafezinho / email. Aberturas e cliques da
        Buttondown não são consultados.
      </p>
      <label>
        Período
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 dias completos</option>
          <option value={30}>30 dias completos</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Carregando…</p>}
      {data && (
        <>
          <p>
            {data.analytics.freshness.fetchedAt
              ? "Snapshot: " +
                new Date(data.analytics.freshness.fetchedAt).toLocaleString(
                  "pt-BR",
                )
              : "Dados ainda indisponíveis."}
            {data.analytics.freshness.stale ? " · Dados desatualizados." : ""}
          </p>
          {data.analytics.error && (
            <p role="alert">
              Relatório indisponível; o último snapshot pode estar
              desatualizado.
            </p>
          )}
          <article className="pub-card">
            <h2>Comparar campanhas</h2>
            {!campaigns ? (
              <p>Indisponível.</p>
            ) : !campaigns.rows.length ? (
              <p>
                Nenhuma sessão atribuída neste período. Isso não confirma
                ausência de visitas: consentimento e marcação dos links afetam a
                medição.
              </p>
            ) : (
              <div className="analytics-table">
                <table>
                  <thead>
                    <tr>
                      <th>Campanha</th>
                      <th>Sessões</th>
                      <th>Visualizações</th>
                      <th>Engajamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.rows.map((r, i) => (
                      <tr key={i}>
                        <th scope="row">{r.sessionCampaignName}</th>
                        <td>{r.sessions}</td>
                        <td>{r.screenPageViews}</td>
                        <td>{(r.engagementRate * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {campaigns?.limited && <p>Primeiros 100 resultados.</p>}
          </article>
          {["pagePath", "date"].map((d) => (
            <article className="pub-card" key={d}>
              <h2>
                {d === "pagePath"
                  ? "Artigos acessados"
                  : "Evolução por campanha"}
              </h2>
              {!report(d) ? (
                <p>Indisponível.</p>
              ) : (
                <div className="analytics-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{d === "date" ? "Data" : "Página"}</th>
                        <th>Campanha</th>
                        <th>Sessões</th>
                        <th>Visualizações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report(d)!.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{d === "date" ? r.date : r.pagePath}</td>
                          <td>{r.sessionCampaignName}</td>
                          <td>{r.sessions}</td>
                          <td>{r.screenPageViews}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report(d)!.limited && (
                    <p>
                      Resultados limitados; totais por campanha vêm do relatório
                      agregado.
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}
          <article className="pub-card">
            <h2>Envios no CRM</h2>
            {data.crm?.fetchedAt && (
              <p>
                Snapshot CRM:{" "}
                {new Date(data.crm.fetchedAt).toLocaleString("pt-BR")}
              </p>
            )}
            {!data.crm ? (
              <p>Informações do CRM indisponíveis.</p>
            ) : !data.crm.campaigns.length ? (
              <p>Nenhuma campanha enviada disponível.</p>
            ) : (
              data.crm.campaigns.map((c) => (
                <p key={c.id}>
                  <strong>{c.subject}</strong> ({c.campaignSlug}) ·{" "}
                  {c.sentAt
                    ? new Date(c.sentAt).toLocaleDateString("pt-BR")
                    : "Data indisponível"}{" "}
                  ·{" "}
                  {c.recipients === null
                    ? "Quantidade de destinatários indisponível"
                    : c.recipients + " destinatários"}
                </p>
              ))
            )}
            {data.crm?.limited && (
              <p>Exibindo a página mais recente de envios.</p>
            )}
            <p>
              Campanhas antigas sem UTMs são não rastreadas por esta
              identificação. Assuntos do CRM e slugs Analytics são apresentados
              separadamente para evitar associações incorretas.
            </p>
          </article>
        </>
      )}
    </section>
  );
}
