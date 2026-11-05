import type {
  HealthItem,
  HealthMetric,
  HealthOverview,
  HealthSnapshot,
} from "../packages/contracts/health";
import { first, stmt } from "./db";
import type { Env } from "./env";
import { cloudflareMetrics, quotaLevel } from "./health-metrics";
import { localDay } from "../packages/contracts/jarvis-periods";

const interval = 30 * 60000;
const iso = (time: number) => new Date(time).toISOString();
type Cache = {
  snapshot_json: string | null;
  next_at: number;
  refresh_failed: number;
};
type Activity = {
  lastSuccess?: string | null;
  lastAttempt?: string | null;
  nextRun?: string | null;
  pending?: number | null;
  failures?: number | null;
  consecutiveFailures?: number | null;
  stale?: number;
};

async function collect(
  env: Env,
  clock: number,
  previous: HealthSnapshot | null,
): Promise<HealthSnapshot> {
  const started = Date.now();
  const [radar, tasks, catalogue, analytics, local] = await env.DB.batch<
    Record<string, unknown>
  >([
    stmt(
      env.DB,
      `SELECT s.connector,MAX(last_success_at) lastSuccess,MAX(last_attempt_at) lastAttempt,
      MIN(MAX(COALESCE(next_fetch_at,''),COALESCE(retry_at,''))) nextRun,
      MAX(consecutive_failures) consecutiveFailures,SUM(consecutive_failures>0) failures,
      SUM(CASE WHEN connector='rss' THEN COALESCE(last_success_at,created_at)<? ELSE COALESCE(next_fetch_at,?)<? END) stale,
      SUM((SELECT COUNT(*) FROM ingestion_queue q WHERE q.source_id=s.id)) pending
      FROM sources s WHERE status='approved' AND json_extract(config_json,'$.metadataAllowed')=1 GROUP BY connector`,
      iso(clock - 48 * 3600000),
      iso(clock),
      iso(clock - 48 * 3600000),
    ),
    stmt(
      env.DB,
      `SELECT kind,MAX(CASE WHEN state='completed' THEN updated_at END) lastSuccess,MAX(updated_at) lastAttempt,
      SUM(state IN ('pending','processing')) pending,SUM(state='error' OR (state='intervention' AND COALESCE(error,'')<>'backlog_review')) failures,
      SUM(state='intervention' AND error='backlog_review') held,MIN(CASE WHEN state='error' THEN next_at END) nextRetry,
      SUM(state='processing' AND lease_until<?) blocked
      FROM integration_tasks GROUP BY kind`,
      clock,
    ),
    stmt(
      env.DB,
      "SELECT last_success,error,next_at FROM integration_control WHERE id='catalogue'",
    ),
    stmt(
      env.DB,
      `SELECT id, fetched_at, next_at, error, json_extract(body_json,'$.quota.daily.consumed') dailyUsed,
      json_extract(body_json,'$.quota.daily.remaining') dailyRemaining FROM analytics_cache
      WHERE id IN ('analytics-v2-7','analytics-v2-30','newsletter-crm-v1','gsc-7','gsc-28','gsc-90')`,
    ),
    stmt(
      env.DB,
      `SELECT
      (SELECT MAX(received_at) FROM opportunities) lastIntake,
      COALESCE(brain.drivePending,0) drivePending,COALESCE(brain.driveFailures,0) driveFailures,
      COALESCE(brain.driveSynced,0) driveSynced,
      (SELECT retry_at FROM jarvis_brain_drive WHERE owner='owner') driveRetry
      FROM (SELECT SUM(sync='pendente') drivePending,SUM(sync='erro') driveFailures,
        SUM(sync='sincronizada') driveSynced FROM jarvis_brain WHERE owner='owner') brain`,
    ),
  ]);
  const dbDuration = Date.now() - started;
  const checkedAt = iso(clock);
  const lookup = (prefix: string) =>
    analytics.results
      .filter((row) => String(row.id).startsWith(prefix))
      .sort((a, b) => Number(b.fetched_at) - Number(a.fetched_at))[0];
  const ga4 = lookup("analytics-");
  const crm = lookup("newsletter-crm");
  const gsc = lookup("gsc-");
  const stats = local.results[0];
  const catalog = catalogue.results[0];
  const connected = stats.driveRetry !== null;
  const integrations = env.INTEGRATION_ENABLED === "true";
  const cacheItem = (
    id: string,
    label: string,
    row: Record<string, unknown> | undefined,
    enabled: boolean,
    auth: HealthItem["auth"],
    hours: number,
    href: string,
  ): HealthItem => {
    const fetched = Number(row?.fetched_at) || 0;
    const error = typeof row?.error === "string" ? row.error : "";
    const renew = /reauthorization|forbidden|unauthorized/.test(error);
    const old = fetched > 0 && clock - fetched > hours * 3600000;
    return {
      id,
      label,
      kind: "integration",
      href,
      state: !enabled
        ? "disabled"
        : renew || error
          ? "failed"
          : old
            ? "warning"
            : fetched
              ? "healthy"
              : "unknown",
      detail: !enabled
        ? "Coleta desativada na configuração."
        : renew
          ? "Autorização ou permissão precisa de revisão."
          : error
            ? "A última tentativa falhou. Consulte a integração."
            : old
              ? "Snapshot mais antigo que a janela esperada."
              : fetched
                ? "Última leitura de dados concluída."
                : "Aguardando a primeira leitura de dados.",
      auth: !enabled
        ? undefined
        : renew
          ? "reauthorize"
          : fetched && !error
            ? "verified"
            : auth,
      lastSuccess: fetched ? iso(fetched) : undefined,
      nextRun: Number(row?.next_at) > 0 ? iso(Number(row?.next_at)) : undefined,
    };
  };
  const ga4Item = cacheItem(
    "ga4",
    "Google Analytics 4",
    ga4,
    env.ANALYTICS_ENABLED === "true",
    env.GA4_REFRESH_TOKEN && env.GOOGLE_OAUTH_CLIENT_SECRET
      ? "configured"
      : "missing",
    24,
    "/analytics",
  );
  const crmItem = cacheItem(
    "crm-sync",
    "Leitura de campanhas do CRM",
    crm,
    integrations,
    env.CRM_INTEGRATION_SECRET ? "configured" : "missing",
    24,
    "/newsletters",
  );
  const gscItem = cacheItem(
    "gsc",
    "Google Search Console",
    gsc,
    env.SEARCH_CONSOLE_ENABLED === "true",
    env.SEARCH_CONSOLE_CLIENT_ID && env.SEARCH_CONSOLE_CLIENT_SECRET
      ? "configured"
      : "missing",
    48,
    "/analytics",
  );
  const service = (
    id: string,
    label: string,
    href: string,
    evidence?: string,
  ): HealthItem => ({
    id,
    label,
    kind: "service",
    href,
    state: evidence ? "healthy" : "unknown",
    detail: evidence
      ? "Há uma operação autenticada recente."
      : "Sem operação autenticada recente para confirmar a disponibilidade.",
    lastSuccess: evidence,
  });
  const recent = (value?: string) =>
    value && clock - Date.parse(value) < 24 * 3600000 ? value : undefined;
  const radarItems = (["rss", "openalex"] as const).map((id): HealthItem => {
    const a = radar.results.find((row) => row.connector === id) as
      Activity | undefined;
    const enabled = env.INGEST_ENABLED === "true";
    const failures = a?.consecutiveFailures ?? 0;
    return {
      id,
      label: id === "rss" ? "Radar Editorial" : "Radar Científico",
      kind: "integration",
      href: "/",
      state: !enabled
        ? "disabled"
        : failures >= 3
          ? "failed"
          : failures > 0 || a?.stale
            ? "warning"
            : a?.lastSuccess
              ? "healthy"
              : "unknown",
      detail: !enabled
        ? "Coleta desligada."
        : failures
          ? "Uma ou mais fontes falharam."
          : a?.stale
            ? "Há coleta atrasada em relação à cadência da fonte."
            : a?.lastSuccess
              ? "Coleta verificada. Um ciclo sem novidades é válido."
              : "Nenhuma coleta bem-sucedida registrada.",
      lastSuccess: a?.lastSuccess ?? undefined,
      lastAttempt: a?.lastAttempt ?? undefined,
      nextRun: a?.nextRun || undefined,
      pending: a?.pending ?? undefined,
      failures: a?.failures ?? undefined,
      consecutiveFailures: a?.consecutiveFailures ?? undefined,
    };
  });
  const taskItems = (["studio", "article"] as const).map((kind): HealthItem => {
    const a = tasks.results.find((row) => row.kind === kind) as
      | (Activity & { held: number; blocked: number; nextRetry: number | null })
      | undefined;
    const previousPending =
      previous?.items.find((row) => row.id === `tasks-${kind}`)?.pending ?? 0;
    const lastSuccess = a?.lastSuccess ?? undefined;
    const grew =
      (a?.pending ?? 0) > previousPending &&
      previousPending > 0 &&
      previous?.items.find((row) => row.id === `tasks-${kind}`)?.lastSuccess ===
        lastSuccess;
    return {
      id: `tasks-${kind}`,
      label: kind === "studio" ? "Oficina → Studio" : "Blog → CRM",
      kind: "integration",
      href: "/publicacoes",
      state: !integrations
        ? "disabled"
        : a?.failures || a?.blocked
          ? "failed"
          : grew || a?.held
            ? "warning"
            : lastSuccess
              ? "healthy"
              : "unknown",
      detail: !integrations
        ? "Reconciliação desligada."
        : a?.blocked
          ? "Há tarefas com lease vencida."
          : a?.failures
            ? "Há tarefas com falha. Abra Publicações para consultar ou retentar."
            : grew
              ? "A fila cresceu desde o snapshot anterior sem novo processamento confirmado."
              : a?.held
                ? "Artigos anteriores à ativação aguardam revisão individual."
                : lastSuccess
                  ? "Há tarefas processadas com sucesso."
                  : "Aguardando a primeira conclusão.",
      pending: a?.pending ?? 0,
      failures: a?.failures ?? 0,
      lastAttempt: a?.lastAttempt ?? undefined,
      lastSuccess,
      nextRun: a?.nextRetry ? iso(a.nextRetry) : undefined,
    };
  });
  const driveEnabled =
    env.BRAIN_DRIVE_ENABLED === "true" &&
    env.BRAIN_DRIVE_FREE_CONFIRMED === "true";
  const catalogueSuccess =
    typeof catalog?.last_success === "string"
      ? catalog.last_success
      : undefined;
  const catalogueStale =
    catalogueSuccess && clock - Date.parse(catalogueSuccess) > 2 * 3600000;
  const items: HealthItem[] = [
    {
      id: "lastro",
      label: "Lastro",
      kind: "service",
      state: "healthy",
      detail: "Leituras operacionais do D1 concluídas.",
      lastSuccess: checkedAt,
      lastAttempt: checkedAt,
      durationMs: dbDuration,
      href: "/",
    },
    ...radarItems,
    service(
      "studio",
      "Studio Editorial",
      "https://studio.marioserafim.com.br/",
      recent(catalogueSuccess),
    ),
    service(
      "crm",
      "CRM",
      "https://crm.marioserafim.com.br/",
      recent(crmItem.lastSuccess),
    ),
    service("portfolio", "Blog e Portfólio", "https://marioserafim.com.br/"),
    {
      id: "catalogue",
      label: "Catálogo do Studio",
      kind: "integration",
      href: "/publicacoes",
      state: !integrations
        ? "disabled"
        : catalog?.error
          ? "failed"
          : catalogueStale
            ? "warning"
            : catalogueSuccess
              ? "healthy"
              : "unknown",
      detail: !integrations
        ? "Sincronização desativada."
        : catalog?.error
          ? "Falha na última sincronização."
          : catalogueStale
            ? "Sincronização atrasada."
            : catalogueSuccess
              ? "Catálogo sincronizado."
              : "Aguardando a primeira leitura.",
      lastSuccess: catalogueSuccess,
      nextRun:
        Number(catalog?.next_at) > 0 ? iso(Number(catalog.next_at)) : undefined,
    },
    ...taskItems,
    {
      id: "intake",
      label: "Portfólio → Oportunidades",
      kind: "integration",
      href: "/oportunidades",
      state: !env.PORTFOLIO_INTEGRATION_SECRET
        ? "disabled"
        : stats.lastIntake
          ? "healthy"
          : "unknown",
      detail: stats.lastIntake
        ? "Há recebimento autenticado registrado. O fluxo depende de novos contatos."
        : "Nenhum recebimento registrado.",
      lastSuccess:
        typeof stats.lastIntake === "string" ? stats.lastIntake : undefined,
    },
    ga4Item,
    crmItem,
    gscItem,
    {
      id: "jarvis",
      label: "Jarvis",
      kind: "service",
      state: "healthy",
      detail: "Armazenamento de preferências acessível no D1.",
    },
    {
      id: "brain",
      label: "Jarvis-Brain",
      kind: "service",
      state: "healthy",
      detail: "Leitura do armazenamento de memória concluída.",
      lastSuccess: checkedAt,
    },
    {
      id: "drive",
      label: "Google Drive do Jarvis",
      kind: "integration",
      state: !driveEnabled
        ? "disabled"
        : Number(stats.driveFailures)
          ? "failed"
          : Number(stats.drivePending) || Number(stats.driveRetry) > clock
            ? "warning"
            : connected && Number(stats.driveSynced)
              ? "healthy"
              : "unknown",
      detail: !driveEnabled
        ? "Integração desativada."
        : !connected
          ? "Autorização ainda não registrada."
          : Number(stats.driveFailures)
            ? "Há documentos com erro de sincronização."
            : Number(stats.drivePending)
              ? "Há documentos aguardando sincronização."
              : Number(stats.driveSynced)
                ? "Há documentos com sincronização confirmada no D1."
                : "Autorização registrada. Aguardando sincronização de documento.",
      auth: connected ? "configured" : "missing",
      pending: Number(stats.drivePending),
      failures: Number(stats.driveFailures),
      nextRun:
        Number(stats.driveRetry) > clock
          ? iso(Number(stats.driveRetry))
          : undefined,
    },
  ];
  const portfolio = items.find((row) => row.id === "portfolio")!;
  const metricsPromise = cloudflareMetrics(env, clock);
  try {
    const start = Date.now();
    const response = await fetch("https://marioserafim.com.br/", {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    portfolio.durationMs = Date.now() - start;
    portfolio.lastAttempt = checkedAt;
    if (response.ok)
      portfolio.detail =
        "A página pública respondeu. A entrega do formulário é monitorada separadamente.";
    else throw Error("portfolio_unavailable");
  } catch {
    portfolio.state = "warning";
    portfolio.detail = "A sondagem HTTP da página pública não foi concluída.";
  }
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const used = number(ga4?.dailyUsed),
    remaining = number(ga4?.dailyRemaining);
  const ga4Current =
    ga4Item.state === "healthy" &&
    Number(ga4?.fetched_at) > clock - 12 * 3600000 &&
    localDay(Number(ga4.fetched_at), "America/Los_Angeles") ===
      localDay(clock, "America/Los_Angeles");
  const metrics: HealthMetric[] = [
    ...(await metricsPromise),
    {
      id: "ga4-quota",
      label: "Tokens GA4 Data API",
      scope: "Propriedade GA4",
      unit: "tokens",
      value: ga4Current ? used : null,
      limit:
        ga4Current && used !== null && remaining !== null
          ? used + remaining
          : null,
      detail:
        "Cota diária informada pelo último snapshot GA4. Pode estar indisponível se não houver leitura recente.",
    },
    {
      id: "gsc-quota",
      label: "Cota Search Console",
      scope: "Projeto Google",
      unit: "requisições",
      value: null,
      limit: null,
      detail:
        "A resposta Search Analytics não informa o consumo total nem o orçamento de carga.",
    },
    {
      id: "drive-quota",
      label: "Cota Google Drive",
      scope: "Projeto Google",
      unit: "requisições",
      value: null,
      limit: null,
      detail:
        "A API usada pelo Brain não informa o consumo do projeto nas respostas.",
    },
  ];
  for (const metric of metrics) {
    const level = quotaLevel(metric, env.HEALTH_QUOTA_THRESHOLDS);
    if (level)
      items.push({
        id: `quota-${metric.id}`,
        label: `${metric.label} · ${metric.scope}`,
        kind: "integration",
        state: level === 3 ? "failed" : "warning",
        detail: `Cota confirmada · ${["", "Atenção", "Atenção elevada", "Crítico"][level]}.`,
      });
  }
  const changes = items.flatMap(({ id, label, state, detail }) => {
    const old = previous?.items.find((row) => row.id === id);
    return (old?.state === state &&
      (state !== "warning" || old.detail === detail)) ||
      (!old && !["failed", "warning"].includes(state))
      ? []
      : [{ id, label, state, at: checkedAt, detail }];
  });
  const recovered =
    previous?.items
      .filter(
        (row) =>
          row.id.startsWith("quota-") &&
          !items.some((item) => item.id === row.id),
      )
      .filter((row) =>
        metrics.some(
          (metric) =>
            `quota-${metric.id}` === row.id &&
            metric.value !== null &&
            metric.limit !== null,
        ),
      )
      .map(({ id, label }) => ({
        id,
        label,
        state: "healthy" as const,
        at: checkedAt,
        detail: "Consumo voltou para abaixo do primeiro limite de alerta.",
      })) ?? [];
  const events = [...changes, ...recovered, ...(previous?.events ?? [])]
    .filter((event) => Date.parse(event.at) >= clock - 30 * 86400000)
    .slice(0, 80);
  return { checkedAt, items, metrics, events };
}

export async function ecosystemHealth(
  env: Env,
  refresh = false,
  clock = Date.now(),
): Promise<HealthOverview> {
  if (env.ECOSYSTEM_HEALTH_ENABLED !== "true")
    return {
      enabled: false,
      snapshot: null,
      nextRefresh: null,
      stale: false,
      refreshFailed: false,
    };
  const read = () =>
    first<Cache>(
      env.DB,
      "SELECT snapshot_json,next_at,refresh_failed FROM ecosystem_health WHERE id=1",
    );
  let row = await read();
  if (refresh && row && row.next_at <= clock) {
    const lease = crypto.randomUUID();
    const lock = await stmt(
      env.DB,
      `UPDATE ecosystem_health SET lease=?,lease_until=? WHERE id=1 AND lease_until<=? AND next_at<=?`,
      lease,
      clock + 60000,
      clock,
      clock,
    ).run();
    if (lock.meta.changes) {
      try {
        const snapshot = await collect(
          env,
          clock,
          row.snapshot_json ? JSON.parse(row.snapshot_json) : null,
        );
        await stmt(
          env.DB,
          "UPDATE ecosystem_health SET snapshot_json=?,next_at=?,refresh_failed=0,lease=NULL,lease_until=0 WHERE id=1 AND lease=?",
          JSON.stringify(snapshot),
          clock + interval,
          lease,
        ).run();
      } catch {
        await stmt(
          env.DB,
          "UPDATE ecosystem_health SET next_at=?,refresh_failed=1,lease=NULL,lease_until=0 WHERE id=1 AND lease=?",
          clock + 15 * 60000,
          lease,
        ).run();
      }
      row = await read();
    }
  }
  const snapshot = row?.snapshot_json
    ? (JSON.parse(row.snapshot_json) as HealthSnapshot)
    : null;
  return {
    enabled: true,
    snapshot,
    nextRefresh: row?.next_at ? iso(row.next_at) : null,
    refreshFailed: row?.refresh_failed === 1,
    stale: !!snapshot && clock - Date.parse(snapshot.checkedAt) >= 2 * interval,
  };
}
