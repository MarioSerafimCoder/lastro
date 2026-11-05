import type { HealthMetric } from "../packages/contracts/health";
import type { Env } from "./env";
import { readBounded } from "./connectors";

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

export function quotaLevel(metric: HealthMetric, setting?: string) {
  const values = setting?.split(",").map(Number);
  const [low, high, critical] =
    values?.length === 3 &&
    values.every(
      (value, i) =>
        value > 0 && value <= 100 && (i === 0 || value > values[i - 1]),
    )
      ? values
      : [70, 85, 95];
  if (metric.limit === null || metric.value === null || metric.limit <= 0)
    return 0;
  const percent = (100 * metric.value) / metric.limit;
  return percent >= critical ? 3 : percent >= high ? 2 : percent >= low ? 1 : 0;
}

export async function cloudflareMetrics(
  env: Env,
  clock: number,
): Promise<HealthMetric[]> {
  const now = new Date(clock).toISOString();
  const day = now.slice(0, 10);
  const account = env.HEALTH_CF_ACCOUNT_ID;
  const worker = env.HEALTH_CF_WORKER_NAME;
  const database = env.HEALTH_CF_D1_ID;
  const token = env.HEALTH_CF_ANALYTICS_TOKEN;
  const configured = !!token && /^[a-f0-9]{32}$/i.test(account ?? "");
  async function query(
    fields: string,
    declarations: string,
    variables: object,
  ) {
    if (!configured) return null;
    try {
      const response = await fetch(
        "https://api.cloudflare.com/client/v4/graphql",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `query Health($account: string! ${declarations}) {
            viewer { accounts(filter: {accountTag: $account}) { ${fields} } }
          }`,
            variables: { account, ...variables },
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      return (
        JSON.parse(await readBounded(response, 16_384))?.data?.viewer
          ?.accounts?.[0] ?? null
      );
    } catch {
      return null;
    }
  }
  const [workers, rows, storage] = await Promise.all([
    worker
      ? query(
          `account: workersInvocationsAdaptive(limit: 1, filter: {datetime_geq: $from, datetime_leq: $to}) { sum { requests } }
       lastro: workersInvocationsAdaptive(limit: 1, filter: {scriptName: $name, datetime_geq: $from, datetime_leq: $to}) {
         sum { requests errors } quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 }
       }`,
          "$from: Time!, $to: Time!, $name: string!",
          { from: day + "T00:00:00Z", to: now, name: worker },
        )
      : null,
    query(
      `account: d1AnalyticsAdaptiveGroups(limit: 1, filter: {date_geq: $day, date_leq: $day}) { sum { rowsRead rowsWritten } }
      ${database ? "lastro: d1AnalyticsAdaptiveGroups(limit: 1, filter: {date_geq: $day, date_leq: $day, databaseId: $db}) { sum { rowsRead rowsWritten } }" : ""}`,
      "$day: Date!" + (database ? ", $db: string!" : ""),
      { day, ...(database ? { db: database } : {}) },
    ),
    database
      ? query(
          `lastro: d1StorageAdaptiveGroups(limit: 1, filter: {date_geq: $from, date_leq: $day, databaseId: $db}, orderBy: [date_DESC]) {
        max { databaseSizeBytes } dimensions { date }
      }`,
          "$from: Date!, $day: Date!, $db: string!",
          {
            from: new Date(clock - 2 * 86400000).toISOString().slice(0, 10),
            day,
            db: database,
          },
        )
      : null,
  ]);
  const metric = (
    id: string,
    label: string,
    scope: string,
    unit: string,
    raw: unknown,
    limit: number | null = null,
    detail = "Cloudflare GraphQL · janela de hoje em UTC",
  ): HealthMetric => ({
    id,
    label,
    scope,
    unit,
    value: count(raw),
    limit,
    detail:
      count(raw) !== null
        ? detail
        : configured
          ? "Dataset, cobertura ou permissão indisponível."
          : "Credencial de leitura Cloudflare ainda não configurada.",
  });
  const free = env.HEALTH_CF_FREE_CONFIRMED === "true";
  const items = [
    metric(
      "workers-account",
      "Invocações Workers",
      "Conta compartilhada",
      "invocações",
      workers?.account?.[0]?.sum?.requests,
      null,
      "GraphQL Adaptive · amostra de invocações, sem percentual faturável.",
    ),
    metric(
      "workers-lastro",
      "Invocações Workers",
      "Lastro",
      "invocações",
      workers?.lastro?.[0]?.sum?.requests,
      null,
      "GraphQL Adaptive · janela de hoje em UTC.",
    ),
    metric(
      "workers-errors",
      "Erros Workers",
      "Lastro",
      "erros",
      workers?.lastro?.[0]?.sum?.errors,
    ),
    ...([50, 95, 99] as const).map((p) => {
      const microseconds = count(
        workers?.lastro?.[0]?.quantiles?.[`cpuTimeP${p}`],
      );
      return metric(
        `cpu-${p}`,
        `CPU P${p}`,
        "Lastro",
        "ms",
        microseconds === null ? null : microseconds / 1000,
        null,
        "Percentil de CPU, agregado entre as invocações observadas hoje em UTC.",
      );
    }),
    ...(["account", "lastro"] as const).flatMap((scope) =>
      (["rowsRead", "rowsWritten"] as const).map((field) =>
        metric(
          `d1-${scope}-${field}`,
          field === "rowsRead" ? "Leituras D1" : "Escritas D1",
          scope === "account" ? "Conta compartilhada" : "Banco do Lastro",
          "linhas",
          rows?.[scope]?.[0]?.sum?.[field],
          scope === "account" && free
            ? field === "rowsRead"
              ? 5_000_000
              : 100_000
            : null,
        ),
      ),
    ),
    metric(
      "d1-storage",
      "Armazenamento D1",
      "Banco do Lastro",
      "bytes",
      storage?.lastro?.[0]?.max?.databaseSizeBytes,
      null,
      "Maior tamanho do banco no último dia disponível.",
    ),
  ];
  return items;
}
