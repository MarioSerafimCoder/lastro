// Operator-only bootstrap. Tokens stay in process memory then Worker Secrets.
// Downloaded client/code files are consumed and removed after successful upload.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { runAnalyticsReports, ANALYTICS_SCOPE } from "../src/analytics";
const [clientPath, authorizationPath] = process.argv.slice(2);
const worker = "lastro-ecosystem-staging";
let stage = "client_validation";
try {
  if (!clientPath || !authorizationPath)
    throw Error(
      "Provide downloaded OAuth client and authorization files, never token literals.",
    );
  const client = JSON.parse(
    fs.readFileSync(clientPath, "utf8").replace(/^\uFEFF/, ""),
  ).web;
  const authorization = JSON.parse(
    fs.readFileSync(authorizationPath, "utf8").replace(/^\uFEFF/, ""),
  );
  const redirect =
    "https://lastro-ecosystem-staging.marioserafim-da.workers.dev/api/analytics/oauth/callback";
  if (
    !client?.client_secret ||
    !client?.client_id ||
    !client.redirect_uris?.includes(redirect) ||
    authorization.redirectUri !== redirect
  )
    throw Error("Client/callback mismatch.");
  stage = "oauth_exchange";
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      client_secret: client.client_secret,
      code: authorization.code,
      code_verifier: authorization.verifier,
      redirect_uri: redirect,
    }),
  });
  if (!r.ok) {
    stage += "_" + r.status;
    throw Error("OAuth exchange failed");
  }
  stage = "grant_validation";
  const token = (await r.json()) as any;
  if (
    !token.refresh_token ||
    !token.access_token ||
    token.scope !== ANALYTICS_SCOPE
  )
    throw Error("Expected offline read-only grant was not received.");
  stage = "worker_secrets";
  const uploaded = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "secret",
      "bulk",
      "--name",
      worker,
    ],
    {
      input: JSON.stringify({
        GOOGLE_OAUTH_CLIENT_SECRET: client.client_secret,
        GA4_REFRESH_TOKEN: token.refresh_token,
      }),
      encoding: "utf8",
    },
  );
  if (uploaded.status !== 0)
    throw Error(
      "Worker Secret upload failed. No token was written to local storage.",
    );
  fs.unlinkSync(clientPath);
  fs.unlinkSync(authorizationPath);
  stage = "run_report";
  const data = await runAnalyticsReports(token.access_token);
  fs.mkdirSync(".wrangler", { recursive: true });
  fs.writeFileSync(
    ".wrangler/analytics-first-report.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        worker,
        refreshTokenExpiresIn: token.refresh_token_expires_in ?? null,
        ...data,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      authenticated: true,
      propertyId: data.propertyId,
      reports: data.reports.map((r) => ({
        dimension: r.dimension,
        rows: r.rows.length,
        limited: r.limited,
      })),
      secrets: "configured",
      temporaryCredentialFiles: "removed",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: "Analytics provisioning failed",
      stage,
      code:
        typeof (error as any)?.code === "string" &&
        /^analytics_/.test((error as any).code)
          ? (error as any).code
          : null,
    }),
  );
  process.exitCode = 1;
}
