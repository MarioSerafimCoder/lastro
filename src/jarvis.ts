import { socialAnswer } from "../packages/contracts/jarvis-social";
import { z } from "zod";
import type { Env } from "./env";
import { first, rows, stmt, OWNER } from "./db";
import { ApiFault } from "./errors";
import { integrationOverview, weeklySummary } from "./integration";
import {
  actionSchema,
  preferencesSchema,
  type JarvisPreferences,
  type JarvisAction,
  type Answer,
  type Notice,
  type Intent,
  type Period,
} from "../packages/contracts/jarvis";
import {
  interpretQuestion,
  resolvePeriod,
} from "../packages/contracts/jarvis-intents";
import type { AnalyticsData } from "../packages/contracts/analytics";
export const aiPolicy = {
  enabled: false as const,
  reason:
    "Modo determinístico. Gratuidade, modelo e orçamento compartilhado da IA ainda não foram homologados; nenhuma inferência é permitida.",
};
const defaults: JarvisPreferences = {
  enabled: true,
  proactive: true,
  communication: "discreto",
  area: "for-you",
};
type CacheRow = {
  body_json: string | null;
  fetched_at: number;
  error: string | null;
};
type Opportunity = {
  id: string;
  status: string;
  received_at: string;
  next_contact: string | null;
  updated_at: string;
};
type Snapshot = {
  ecosystem: Awaited<ReturnType<typeof integrationOverview>>;
  opportunities: Opportunity[];
  analytics: CacheRow | null;
  newsletter: CacheRow | null;
  loadedAt: string;
};
const cache = new WeakMap<
  object,
  { until: number; pending: Promise<Snapshot> }
>();
export function invalidateJarvis(env: Env) {
  cache.delete(env.DB);
}
async function snapshot(env: Env): Promise<Snapshot> {
  const old = cache.get(env.DB);
  if (old && old.until > Date.now()) return old.pending;
  const pending = Promise.all([
    integrationOverview(env),
    rows<Opportunity>(
      env.DB,
      "SELECT id,status,received_at,next_contact,updated_at FROM opportunities ORDER BY received_at DESC LIMIT 1001",
    ),
    first<CacheRow>(
      env.DB,
      "SELECT body_json,fetched_at,error FROM analytics_cache WHERE id='analytics-v2-30'",
    ),
    first<CacheRow>(
      env.DB,
      "SELECT body_json,fetched_at,error FROM analytics_cache WHERE id='newsletter-v2-30'",
    ),
  ]).then(([ecosystem, opportunities, analytics, newsletter]) => ({
    ecosystem,
    opportunities,
    analytics,
    newsletter,
    loadedAt: new Date().toISOString(),
  }));
  cache.set(env.DB, { until: Date.now() + 300000, pending });
  try {
    return await pending;
  } catch (e) {
    cache.delete(env.DB);
    throw e;
  }
}
export async function jarvisPreferences(env: Env) {
  const row = await first<{ body_json: string }>(
    env.DB,
    "SELECT body_json FROM jarvis_preferences WHERE owner=?",
    OWNER,
  );
  return row ? preferencesSchema.parse(JSON.parse(row.body_json)) : defaults;
}
export async function saveJarvisPreferences(env: Env, value: unknown) {
  const p = preferencesSchema.parse(value);
  await stmt(
    env.DB,
    "INSERT INTO jarvis_preferences VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET body_json=excluded.body_json,updated_at=excluded.updated_at",
    OWNER,
    JSON.stringify(p),
    new Date().toISOString(),
  ).run();
  return p;
}
async function cleanup(env: Env) {
  const clock = Date.now();
  await env.DB.batch([
    stmt(env.DB, "DELETE FROM jarvis_memory WHERE expires_at<?", clock),
    stmt(
      env.DB,
      "DELETE FROM jarvis_memory WHERE kind='action' AND id NOT IN (SELECT id FROM jarvis_memory WHERE kind='action' ORDER BY created_at DESC,id LIMIT 100)",
    ),
    stmt(
      env.DB,
      "DELETE FROM jarvis_budgets WHERE day<?",
      new Date(clock - 7 * 86400000).toISOString().slice(0, 10),
    ),
  ]);
}
const iso = (clock: number) => new Date(clock).toISOString();
const fresh = (row: CacheRow | null) =>
  !!row?.body_json && !row.error && Date.now() - row.fetched_at <= 43200000;
function data(row: CacheRow | null): AnalyticsData | null {
  try {
    return row?.body_json ? JSON.parse(row.body_json) : null;
  } catch {
    return null;
  }
}
const bounded = (date: string, period: Period) =>
  !period.from || (date >= period.from && date < period.to);
export async function answerJarvis(
  env: Env,
  input: { text: string; area: string; choice?: Intent; allowAI?: boolean },
): Promise<Answer> {
  const social = !input.choice && socialAnswer(input.text);
  if (social) return social;
  const p = resolvePeriod(input.text),
    interpreted = interpretQuestion(input.text, input.area, input.choice);
  const base: Answer = {
    text: "Qual consulta deseja fazer?",
    source: "Motor determinístico Jarvis",
    period: p,
    syncedAt: null,
    incomplete: true,
    stale: false,
    ai: aiPolicy,
  };
  if (!interpreted.intent)
    return {
      ...base,
      text: interpreted.unsupportedTime
        ? "Esse período ainda não está disponível. Use hoje, semana ou últimos 7/30 dias."
        : interpreted.prohibitedWrite
          ? "Não executo envios, publicações ou exclusões pela conversa. Posso consultar os dados e ajudar você a revisar o próximo passo."
          : interpreted.entities.length
            ? "Para eu consultar os dados certos: você quer saber sobre " +
              interpreted.choices
                .map((c) => c.label.toLowerCase())
                .join(" ou ") +
              "? Pode me responder por aqui."
            : "Ainda não entendi como relacionar isso ao Lastro. Posso ajudar com oportunidades, artigos, newsletters e o andamento do ecossistema. O que você gostaria de saber sobre eles?",
      choices:
        !interpreted.unsupportedTime &&
        !interpreted.prohibitedWrite &&
        interpreted.entities.length
          ? interpreted.choices
          : undefined,
    };
  const prefs = await jarvisPreferences(env);
  await saveJarvisPreferences(env, { ...prefs, area: input.area });
  const s = await snapshot(env),
    intent = interpreted.intent,
    e = s.ecosystem;
  const answer = (
    text: string,
    source: string,
    action?: JarvisAction,
  ): Answer => ({
    ...base,
    text,
    intent,
    source,
    action,
    syncedAt: s.loadedAt,
    incomplete: false,
  });
  if (intent.startsWith("opportunities.")) {
    const overdue = intent === "opportunities.overdue";
    const candidates = s.opportunities.filter((o) =>
      overdue
        ? ["novo", "em_conversa", "proposta_enviada"].includes(o.status) &&
          !!o.next_contact &&
          o.next_contact <= p.to &&
          bounded(o.next_contact, p)
        : o.status === "novo" && bounded(o.received_at, p),
    );
    const capped = s.opportunities.length > 1000;
    const response = answer(
      `${capped ? "Pelo menos " : ""}${candidates.length} ${overdue ? "oportunidades com acompanhamento atrasado" : "pedidos de orçamento ainda no status Novo"}.`,
      "D1 · oportunidades",
      { kind: "opportunity.open", target: candidates[0]?.id },
    );
    response.incomplete = capped;
    if (
      !overdue &&
      candidates.length &&
      (await jarvisPreferences(env)).communication === "discreto"
    )
      response.text += " Uma resposta costuma ser bem recebida.";
    return response;
  }
  if (intent === "articles.top" || intent === "newsletters.performance") {
    const days = p.days || 7;
    const row = await first<CacheRow>(
      env.DB,
      "SELECT body_json,fetched_at,error FROM analytics_cache WHERE id=?",
      `${intent === "articles.top" ? "analytics-v2" : "newsletter-v2"}-${days}`,
    );
    const d = data(row),
      report = d?.reports.find(
        (r) =>
          r.dimension ===
          (intent === "articles.top" ? "pagePath" : "sessionCampaignName"),
      );
    const actual = {
      label: `Últimos ${days} dias completos · fuso da propriedade GA4`,
      from: null,
      to: p.to,
      days,
    };
    const a = answer(
      "Snapshot indisponível. Abra o painel para consultar a sincronização.",
      "Snapshot GA4 existente",
      {
        kind: intent === "articles.top" ? "analytics.open" : "newsletters.open",
      },
    );
    a.period = actual;
    a.syncedAt = row?.fetched_at ? iso(row.fetched_at) : null;
    a.stale = !fresh(row);
    a.incomplete =
      !report ||
      !!row?.error ||
      !!report?.limited ||
      !!report?.privacyFiltered ||
      (!!p.from && !p.days);
    if (report) {
      const ordered = (
        intent === "articles.top"
          ? report.rows.filter((r) =>
              /^\/(?:en\/|pt\/)?blog\/[a-z0-9-]+\/?$/.test(r.pagePath || ""),
            )
          : [...report.rows]
      ).sort((a, b) => b.screenPageViews - a.screenPageViews);
      a.text = !ordered.length
        ? "O snapshot não contém resultados atribuídos. Ausência de linhas não comprova zero visitas."
        : intent === "articles.top"
          ? `Página mais acessada no snapshot: ${ordered[0].pagePath}, com ${ordered[0].screenPageViews} visualizações.`
          : `${ordered.length} campanhas com tráfego atribuído no snapshot; a primeira tem ${ordered[0].sessions} sessões e ${ordered[0].screenPageViews} visualizações.`;
      if (p.from && !p.days)
        a.text +=
          " Esse recorte exige dados que o snapshot não oferece; exibido o período de 7 dias.";
      if (
        intent === "articles.top" &&
        ordered[0]?.pagePath?.match(/^\/(?:en\/)?blog\/[a-z0-9-]+\/?$/)
      )
        a.action = {
          kind: "article.open",
          target: ordered[0].pagePath.split("/").filter(Boolean).at(-1)!,
        };
    }
    return a;
  }
  if (intent === "ecosystem.weekly") {
    const weekly = await weeklySummary(env);
    return {
      ...answer(
        `Resumo das integrações observadas: ${weekly.metrics.researchPackages ?? "indisponível"} pacotes, ${weekly.metrics.publishedArticles ?? "indisponível"} artigos publicados e ${weekly.metrics.integrationFailures ?? "indisponível"} eventos de falha.`,
        "D1 · resumo editorial",
        { kind: "integration.review" },
      ),
      period: {
        label: "Últimos 7 dias corridos · integrações observadas",
        from: weekly.from,
        to: weekly.to,
        days: 7,
      },
      syncedAt: weekly.lastSync,
      incomplete: true,
      stale:
        !weekly.lastSync || Date.now() - Date.parse(weekly.lastSync) > 43200000,
    };
  }
  if (intent === "editorial.prepare")
    return answer(
      "Posso abrir a Oficina para você definir objetivo, formato e referências. Nenhum briefing será salvo ou enviado sem sua revisão.",
      "Oficina · formulário existente",
      { kind: "workshop.prepare" },
    );
  let count = 0,
    action: JarvisAction | undefined = { kind: "integration.review" },
    text = "";
  if (intent === "drafts.pending") {
    const list = e.recommendations.continueDraft as { id: string }[];
    count = list.length;
    action = list[0]
      ? { kind: "studio.continue", target: list[0].id }
      : undefined;
    text = `${count} rascunhos aguardam continuação no catálogo observado.`;
  }
  if (intent === "articles.without_newsletter") {
    const list = e.withoutNewsletter as { slug: string; publish_at?: string }[];
    const chosen = list.filter(
      (a) => !p.from || (!!a.publish_at && bounded(a.publish_at, p)),
    );
    count = chosen.length;
    action = { kind: "article.open", target: chosen[0]?.slug };
    text = `${count} artigos publicados sem newsletter vinculada no snapshot observado.`;
  }
  if (intent === "research.unused") {
    count = e.recommendations.unusedReferences.length;
    action = { kind: "references.open" };
    text = `${count} referências da seleção ainda não foram vinculadas a um rascunho Studio.`;
  }
  if (intent === "integrations.failures") {
    count = (e.tasks as { state: string; updated_at: string }[]).filter(
      (t) => t.state === "error" && bounded(t.updated_at, p),
    ).length;
    action = { kind: "integration.review" };
    text = `${count} tarefas atualmente em erro no recorte observado. Pendências históricas de aprovação não são tratadas como falha crítica.`;
  }
  const sync = e.freshness?.last_success || null,
    stale = !sync || Date.now() - Date.parse(sync) > 43200000;
  return {
    ...answer(
      sync
        ? text
        : "Catálogo ainda sem sincronização confirmada; a contagem está indisponível.",
      "Snapshot D1 · integrações editoriais",
      action,
    ),
    syncedAt: sync,
    stale,
    incomplete:
      stale ||
      e.tasks.length >= 100 ||
      e.articles.length >= 100 ||
      !!e.freshness?.error ||
      (!!p.from &&
        (intent === "drafts.pending" || intent === "research.unused")),
    period:
      intent === "drafts.pending" || intent === "research.unused"
        ? {
            label: "Estoque atual do snapshot · sem recorte histórico",
            from: null,
            to: s.loadedAt,
            days: null,
          }
        : p,
  };
}
async function noticeId(entity: string, version: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`jarvis-2:${entity}:${version}`),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function jarvisNotices(env: Env): Promise<Notice[]> {
  const s = await snapshot(env),
    list: Notice[] = [];
  const add = async (
    entity: string,
    version: string,
    changedAt: string,
    priority: Notice["priority"],
    text: string,
    action: JarvisAction,
  ) => {
    if (
      !Number.isFinite(Date.parse(changedAt)) ||
      Date.now() - Date.parse(changedAt) > 30 * 86400000
    )
      return;
    list.push({
      id: await noticeId(entity, version),
      priority,
      text,
      action,
      changedAt,
    });
  };
  for (const o of s.opportunities) {
    if (
      ["novo", "em_conversa", "proposta_enviada"].includes(o.status) &&
      o.next_contact &&
      o.next_contact < iso(Date.now())
    )
      await add(
        o.id,
        o.status + o.next_contact,
        o.updated_at,
        95,
        "Há uma oportunidade com acompanhamento atrasado.",
        { kind: "opportunity.open", target: o.id },
      );
    else if (o.status === "novo")
      await add(
        o.id,
        o.status + o.received_at,
        o.received_at,
        90,
        "Há um pedido de orçamento aguardando atendimento.",
        { kind: "opportunity.open", target: o.id },
      );
  }
  const e = s.ecosystem;
  for (const t of e.tasks as {
    id: string;
    state: string;
    version: string;
    updated_at: string;
  }[])
    if (t.state === "error")
      await add(
        t.id,
        t.version + ":error",
        t.updated_at,
        100,
        "Uma integração registrou falha. Revise o diagnóstico antes de continuar.",
        { kind: "integration.review", target: t.id },
      );
  if (e.freshness?.error)
    await add(
      "catalogue",
      e.freshness.error,
      e.freshness.last_success || s.loadedAt,
      100,
      "A sincronização do catálogo precisa de atenção.",
      { kind: "integration.review" },
    );
  if (
    e.freshness?.last_success &&
    !e.freshness.error &&
    Date.now() - Date.parse(e.freshness.last_success) < 43200000
  ) {
    for (const a of e.withoutNewsletter as {
      slug: string;
      sha: string;
      publish_at: string | null;
      checked_at: string;
    }[])
      await add(
        a.slug,
        a.sha,
        a.publish_at || a.checked_at,
        75,
        "Há um artigo publicado sem newsletter vinculada.",
        { kind: "article.open", target: a.slug },
      );
    for (const d of e.recommendations.continueDraft as {
      id: string;
      updated_at: string;
      revision: number;
    }[])
      if (Date.now() - Date.parse(d.updated_at) > 3 * 86400000)
        await add(
          d.id,
          String(d.revision),
          d.updated_at,
          60,
          "Um rascunho está parado há pelo menos três dias.",
          { kind: "studio.continue", target: d.id },
        );
  }
  // Only equivalent complete adjacent windows with at least 100 sessions each qualify.
  const a = data(s.analytics),
    daily = a?.reports.find((r) => r.dimension === "date");
  if (fresh(s.analytics) && daily && !daily.limited && !daily.privacyFiltered) {
    const series = [...daily.rows]
      .filter((r) => /^\d{8}$/.test(r.date || ""))
      .sort((a, b) => a.date!.localeCompare(b.date!))
      .slice(-14);
    const timestamp = (v: string) =>
      Date.parse(
        v.slice(0, 4) +
          "-" +
          v.slice(4, 6) +
          "-" +
          v.slice(6, 8) +
          "T00:00:00Z",
      );
    if (
      series.length === 14 &&
      series[13].date ===
        new Date(Date.parse(resolvePeriod("hoje").from!) - 86400000)
          .toISOString()
          .slice(0, 10)
          .replaceAll("-", "") &&
      series.every(
        (r, i) =>
          i === 0 ||
          timestamp(r.date!) - timestamp(series[i - 1].date!) === 86400000,
      )
    ) {
      const old = series.slice(0, 7).reduce((sum, r) => sum + r.sessions, 0),
        recent = series.slice(7).reduce((sum, r) => sum + r.sessions, 0);
      if (
        old >= 100 &&
        recent >= 100 &&
        series
          .slice(0, 7)
          .some((r) => Number.isFinite(r.activeUsers) && r.activeUsers >= 50) &&
        series
          .slice(7)
          .some((r) => Number.isFinite(r.activeUsers) && r.activeUsers >= 50) &&
        Math.abs(recent / old - 1) >= 0.3
      )
        await add(
          "audience",
          series[13].date! + ":" + Math.round((recent / old) * 10),
          iso(s.analytics!.fetched_at),
          45,
          `As sessões variaram ${Math.round(Math.abs(recent / old - 1) * 100)}% entre duas janelas completas de sete dias.`,
          { kind: "analytics.open" },
        );
    }
  }
  return list
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, 100);
}
export async function jarvisState(env: Env) {
  await cleanup(env);
  const preferences = await jarvisPreferences(env);
  if (!preferences.enabled)
    return {
      preferences,
      notices: [],
      syncedAt: iso(Date.now()),
      ai: aiPolicy,
    };
  const candidates = await jarvisNotices(env),
    memory = await rows<{ id: string; state: string; until_at: number }>(
      env.DB,
      "SELECT id,state,until_at FROM jarvis_memory WHERE kind='notice'",
    );
  return {
    preferences,
    notices: candidates.filter(
      (n) =>
        !memory.some(
          (m) =>
            m.id === n.id &&
            (m.state === "dismissed" || m.until_at > Date.now()),
        ),
    ),
    syncedAt: iso(Date.now()),
    ai: aiPolicy,
  };
}
export async function markNotice(
  env: Env,
  id: string,
  operation: "shown" | "dismiss" | "snooze",
) {
  await cleanup(env);
  const notice = (await jarvisNotices(env)).find((n) => n.id === id);
  if (!notice)
    throw new ApiFault(
      409,
      "notice_obsolete",
      "Alerta não está mais disponível.",
    );
  const capacity = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) n FROM jarvis_memory WHERE kind='notice'",
  );
  if (
    capacity!.n >= 500 &&
    !(await first(env.DB, "SELECT id FROM jarvis_memory WHERE id=?", id))
  )
    return { allowed: false };
  const clock = Date.now(),
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
    }).format(clock),
    cooldown = notice.priority >= 90 ? 3600000 : 21600000;
  if (operation === "shown") {
    const prefs = await jarvisPreferences(env);
    if (!prefs.enabled || !prefs.proactive) return { allowed: false };
    await stmt(
      env.DB,
      "INSERT OR IGNORE INTO jarvis_budgets(day) VALUES (?)",
      day,
    ).run();
    const result = await stmt(
      env.DB,
      `UPDATE jarvis_budgets SET count=count+1,last_shown=? WHERE day=? AND count<2 AND last_shown<=? AND NOT EXISTS(SELECT 1 FROM jarvis_memory WHERE id=? AND (state='dismissed' OR until_at>?))`,
      clock,
      day,
      clock - cooldown,
      id,
      clock,
    ).run();
    if (result.meta.changes !== 1) return { allowed: false };
  }
  await stmt(
    env.DB,
    "INSERT INTO jarvis_memory SELECT ?,'notice',?,?,?,? WHERE (SELECT COUNT(*) FROM jarvis_memory WHERE kind='notice')<500 OR EXISTS(SELECT 1 FROM jarvis_memory WHERE id=?) ON CONFLICT(id) DO UPDATE SET state=CASE WHEN jarvis_memory.state='dismissed' THEN jarvis_memory.state ELSE excluded.state END,until_at=excluded.until_at",
    id,
    operation === "dismiss" ? "dismissed" : operation,
    operation === "dismiss"
      ? 0
      : clock + (operation === "snooze" ? 86400000 : cooldown),
    clock,
    clock + 90 * 86400000,
    id,
  ).run();
  await cleanup(env);
  return { allowed: true };
}
export async function resolveAction(env: Env, input: unknown) {
  const action = actionSchema.parse(input),
    s = await snapshot(env);
  let navigation = "",
    url: string | undefined;
  switch (action.kind) {
    case "opportunity.open":
      if (action.target && !s.opportunities.some((o) => o.id === action.target))
        throw new ApiFault(
          404,
          "action_target_missing",
          "Oportunidade não disponível.",
        );
      navigation = "opportunities";
      break;
    case "analytics.open":
      navigation = "analytics";
      break;
    case "newsletters.open":
      navigation = "newsletters";
      break;
    case "integration.review":
      if (
        action.target &&
        !(s.ecosystem.tasks as { id: string }[]).some(
          (t) => t.id === action.target,
        )
      )
        throw new ApiFault(
          404,
          "action_target_missing",
          "Tarefa não disponível.",
        );
      navigation = "publications";
      break;
    case "references.open":
      if (action.target && action.target !== "queue")
        throw new ApiFault(400, "invalid_target", "Destino inválido.");
      navigation = action.target === "queue" ? "queue" : "workshop";
      break;
    case "workshop.prepare":
      navigation = "studio";
      break;
    case "article.open":
      if (
        action.target &&
        !s.ecosystem.articles.some(
          (a) => a.slug === action.target && a.state === "available",
        )
      )
        throw new ApiFault(
          404,
          "action_target_missing",
          "Artigo não disponível.",
        );
      navigation = "publications";
      if (action.target)
        url = "https://marioserafim.com.br/blog/" + action.target;
      break;
    case "studio.continue":
      if (
        !action.target ||
        !s.ecosystem.studioDrafts.some(
          (d) =>
            d.id === action.target &&
            /^https:\/\/studio\.marioserafim\.com\.br\/editor\/[a-f0-9-]+$/.test(
              d.admin_url,
            ),
        )
      )
        throw new ApiFault(
          404,
          "action_target_missing",
          "Rascunho não disponível.",
        );
      navigation = "open-studio:" + action.target;
      url = s.ecosystem.studioDrafts.find(
        (d) => d.id === action.target,
      )!.admin_url;
      break;
  }
  await stmt(
    env.DB,
    "INSERT INTO jarvis_memory VALUES (?,'action',?,0,?,?)",
    crypto.randomUUID(),
    action.kind,
    Date.now(),
    Date.now() + 30 * 86400000,
  ).run();
  await cleanup(env);
  return { navigation, action, url };
}
