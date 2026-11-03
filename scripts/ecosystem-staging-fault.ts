// Isolated staging only. Secrets are supplied through process environment, never arguments.
import assert from "node:assert/strict";
import fs from "node:fs";
const lastro = "https://lastro-ecosystem-staging.marioserafim-da.workers.dev",
  studio = "https://studio-ecosystem-staging.marioserafim-da.workers.dev";
const l = await fetch(lastro + "/api/auth/login", {
  method: "POST",
  headers: { Origin: lastro, "Content-Type": "application/json" },
  body: JSON.stringify({ password: process.env.STAGING_LASTRO_PASSWORD }),
});
assert.equal(l.status, 200);
const cookie = l.headers.get("set-cookie")!.split(";")[0];
async function api(path: string, body?: unknown) {
  const r = await fetch(lastro + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: lastro,
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(r.ok, "Staging API failed");
  return r.json() as Promise<any>;
}
async function fault(value: string) {
  const r = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/7bfc908c25ef636aade196a09572a11c/workers/scripts/studio-ecosystem-staging/secrets",
    {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + process.env.STAGING_CF_OAUTH,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "STAGING_FAULT",
        text: value,
        type: "secret_text",
      }),
    },
  );
  assert.ok(r.ok, "Staging fault toggle failed");
  for (let i = 0; i < 30; i++) {
    const check = await fetch(studio + "/integration/v1/catalogue");
    if (check.status === (value === "unavailable" ? 503 : 401)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Staging fault state not propagated");
}
const p = await api("/research-packages", {
  format: "article",
  tone: "analítico",
  audience: "homologação",
  objective: "Retentativa após indisponibilidade de staging",
  notes: "Fixture sintética",
});
const ticket = await api("/research-packages/" + p.id + "/studio-draft", {
  title: "Homologação de recuperação",
  argument: "",
  outline: [],
});
try {
  await fault("unavailable");
  await api("/integrations/reconcile", {});
  const o = await api("/integrations/overview");
  const t = o.tasks.find((t: any) => t.id === ticket.id);
  assert.equal(t.state, "error");
  assert.equal(t.error, "service_unavailable");
} finally {
  await fault("disabled");
}
await api("/integrations/tasks/" + ticket.id + "/retry", {});
await api("/integrations/reconcile", {});
const o = await api("/integrations/overview");
const recovered = o.tasks.find((t: any) => t.id === ticket.id);
assert.equal(recovered.state, "completed");
assert.equal(recovered.attempts, 2);
const result = {
  remote: true,
  fault: "upstream 503",
  stateDuringFailure: "error",
  recovery: "completed",
  attempts: 2,
  taskId: ticket.id,
  faultDisabled: true,
};
fs.writeFileSync(
  ".wrangler/ecosystem-fault-results.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
