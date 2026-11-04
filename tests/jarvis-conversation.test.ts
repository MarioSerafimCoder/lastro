import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { migrationStatements } from "./migration-statements";
import { app } from "../src/index";
import {
  loadDialogue,
  advanceDialogue,
  resetDialogue,
  dialogueScope,
  type Scope,
} from "../src/jarvis-dialogue";
import { issueSession } from "../src/auth";
import { localDay, shiftDay } from "../packages/contracts/jarvis-periods";
import type { Env } from "../src/env";
import type { DialogueView } from "../packages/contracts/jarvis-dialogue";
let mf: Miniflare, env: Env;
const realFetch = globalThis.fetch;
before(async () => {
  mf = new Miniflare(
    await convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-10-01",
      d1Databases: { DB: "dialogue-test" },
    }),
  );
  env = {
    DB: await mf.getD1Database("DB"),
    ENVIRONMENT: "development",
    DEV_TOKEN: "dialogue-local-secret-".repeat(3),
  } as Env;
  for (const f of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      await readFile(new URL("../migrations/" + f, import.meta.url), "utf8"),
    ))
      await env.DB.prepare(sql).run();
});
beforeEach(async () => {
  globalThis.fetch = async () => {
    throw Error("External requests forbidden in dialogue");
  };
  for (const table of [
    "jarvis_conversations",
    "analytics_cache",
    "request_budgets",
  ])
    await env.DB.prepare("DELETE FROM " + table).run();
  await seed();
});
after(async () => {
  globalThis.fetch = realFetch;
  await mf.dispose();
});
const scope = (id = "a"): Scope => ({
  hash: id.repeat(64),
  expires: Date.now() + 3600000,
});
async function seed() {
  const today = localDay(Date.now());
  for (const days of [7, 30]) {
    const values = {
      activeUsers: days === 7 ? 20 : 40,
      sessions: days * 10,
      screenPageViews: days * 20,
      engagementRate: 0.5,
      userEngagementDuration: days * 120,
    };
    const report = (dimension: string, rows: unknown[]) => ({
      dimension,
      rows,
      rowCount: rows.length,
      limited: false,
      privacyFiltered: false,
    });
    const data = {
      version: "analytics-1.0",
      propertyId: "560757639",
      timeZone: "America/Fortaleza",
      range: { start: `${days}daysAgo`, end: "yesterday" },
      effectiveRange: {
        start: shiftDay(today, -days),
        end: shiftDay(today, -1),
      },
      reports: [
        report("total", [values]),
        report(
          "date",
          Array.from({ length: days }, (_, i) => ({
            ...values,
            activeUsers: 8,
            sessions: 10,
            screenPageViews: 20,
            userEngagementDuration: 120,
            date: shiftDay(today, -days + i).replaceAll("-", ""),
          })),
        ),
        report("pagePath", [{ ...values, pagePath: "/blog/artigo-publico" }]),
        report("sessionCampaignName", [
          { ...values, sessionCampaignName: "campanha-publica" },
        ]),
      ],
    };
    for (const prefix of ["analytics-v2", "newsletter-v2"])
      await env.DB.prepare(
        "INSERT OR REPLACE INTO analytics_cache(id,body_json,fetched_at) VALUES (?,?,?)",
      )
        .bind(`${prefix}-${days}`, JSON.stringify(data), Date.now())
        .run();
  }
}
async function conversation(s = scope()) {
  let view = (await loadDialogue(env, s)).conversation;
  return {
    get view() {
      return view;
    },
    async send(text: string) {
      const answer = await advanceDialogue(env, s, {
        text,
        area: "for-you",
        conversationId: view.id,
        revision: view.revision,
      });
      view = answer.conversation;
      return answer;
    },
  };
}
test("Analytics: 15-message real D1 dialogue, no external requests, exact metrics and limitations", async () => {
  const chat = await conversation();
  assert.equal((await chat.send("Olá, Jarvis")).kind, "social");
  assert.equal(
    (await chat.send("quantos acessos teve meu site?")).conversation.state,
    "awaiting_period",
  );
  assert.equal((await chat.send("sim")).conversation.state, "awaiting_period");
  assert.match(
    (await chat.send("sete")).text,
    /70 sessões e 140 visualizações/,
  );
  assert.match((await chat.send("sessões")).text, /70 sessões/);
  assert.match((await chat.send("e antes?")).text, /70 sessões/);
  assert.match(
    (await chat.send("usuários ativos")).text,
    /não tem total deduplicado/,
  );
  assert.match((await chat.send("sete")).text, /20 usuários ativos/);
  assert.match((await chat.send("engajamento")).text, /50%/);
  assert.match((await chat.send("e os artigos?")).text, /artigo-publico/);
  assert.equal(
    (await chat.send("semana passada")).conversation.state,
    "awaiting_period",
  );
  assert.match((await chat.send("trinta")).text, /600 visualizações/);
  assert.match(
    (await chat.send("acessos do site nessa última semana")).text,
    /70 sessões e 140 visualizações/,
  );
  assert.equal((await chat.send("hoje")).conversation.state, "awaiting_period");
  assert.match(
    (await chat.send("ontem")).text,
    /10 sessões e 20 visualizações/,
  );
});
test("F: 12-message session lifecycle, reload, isolation, logout, expiration and no transcript", async () => {
  const prod = {
    ...env,
    ENVIRONMENT: "production",
    OWNER_PASSWORD_SHA256: "0".repeat(64),
    SESSION_SIGNING_KEY: "a".repeat(43),
  };
  const authCookie = (await issueSession(prod)).split(";")[0];
  const req = (cookie: string) =>
    new Request("https://lastro.example/api/jarvis/conversation", {
      headers: { Cookie: cookie },
    });
  const s = (await dialogueScope(req(authCookie)))!;
  const cookie = authCookie + "; " + s.cookie!.split(";")[0];
  const chat = await conversation(s);
  const inputs = [
    "olá",
    "acessos do site",
    "sete",
    "sessões",
    "antes",
    "artigos",
    "trinta",
    "newsletters",
    "assunto anterior",
    "oportunidades",
    "novas",
    "obrigado",
  ];
  for (const text of inputs) await chat.send(text);
  const reload = await loadDialogue(env, (await dialogueScope(req(cookie)))!);
  assert.equal(reload.conversation.revision, 12);
  assert.equal(reload.conversation.topic, "opportunities");
  const different = (await dialogueScope(req(authCookie)))!;
  assert.notEqual(different.hash, s.hash);
  assert.equal((await loadDialogue(env, different)).conversation.revision, 0);
  const record = await env.DB.prepare(
    "SELECT snapshot_json FROM jarvis_conversations WHERE session_hash=?",
  )
    .bind(s.hash)
    .first<{ snapshot_json: string }>();
  assert.ok(!record!.snapshot_json.includes("acessos do site"));
  assert.ok(!record!.snapshot_json.includes("authorization"));
  const logout = await app.request(
    "https://lastro.example/api/auth/logout",
    {
      method: "POST",
      headers: { Origin: "https://lastro.example", Cookie: cookie },
    },
    prod,
  );
  assert.equal(logout.status, 200);
  assert.equal(
    await env.DB.prepare(
      "SELECT count(*) n FROM jarvis_conversations WHERE session_hash=?",
    )
      .bind(s.hash)
      .first("n"),
    0,
  );
  const expiredCookie = cookie.replace(/v1\.\d+\./, "v1.1000000000.");
  const denied = await app.request(
    "https://lastro.example/api/jarvis/conversation",
    { headers: { Cookie: expiredCookie } },
    prod,
  );
  assert.equal(denied.status, 401);
  await env.DB.prepare("UPDATE jarvis_conversations SET expires_at=0").run();
  assert.equal((await loadDialogue(env, different)).conversation.revision, 0);
});
test("H: 12 turns across reloaded clients; concurrent replies and reset never overwrite a newer revision", async () => {
  const s = scope();
  let current = (await loadDialogue(env, s)).conversation;
  for (let i = 0; i < 10; i++) {
    const recovered = (await loadDialogue(env, s)).conversation;
    assert.equal(recovered.revision, current.revision);
    current = (
      await advanceDialogue(env, s, {
        text: i === 0 ? "acessos do site" : i === 1 ? "sete" : "sessões",
        area: "for-you",
        conversationId: recovered.id,
        revision: recovered.revision,
      })
    ).conversation;
  }
  const race = await Promise.allSettled(
    ["visualizações", "usuários ativos"].map((text) =>
      advanceDialogue(env, s, {
        text,
        area: "for-you",
        conversationId: current.id,
        revision: current.revision,
      }),
    ),
  );
  assert.equal(race.filter((v) => v.status === "fulfilled").length, 1);
  assert.equal(
    (race.find((v) => v.status === "rejected") as PromiseRejectedResult).reason
      .status,
    409,
  );
  current = (await loadDialogue(env, s)).conversation;
  assert.equal(current.revision, 11);
  const stale = { ...current };
  current = (
    await advanceDialogue(env, s, {
      text: "engajamento",
      area: "for-you",
      conversationId: current.id,
      revision: current.revision,
    })
  ).conversation;
  await assert.rejects(() => resetDialogue(env, s, stale.id, stale.revision), {
    status: 409,
  });
  const clean = await resetDialogue(env, s, current.id, current.revision);
  assert.notEqual(clean.id, current.id);
  await assert.rejects(
    () =>
      advanceDialogue(env, s, {
        text: "sim",
        area: "for-you",
        conversationId: current.id,
        revision: current.revision,
      }),
    { status: 409 },
  );
});
test("bad coverage, missing timezone and no rows never become invented zeros", async () => {
  for (const mutation of [
    "missing-zone",
    "privacy",
    "missing-day",
    "negative",
  ]) {
    await seed();
    const all = await env.DB.prepare(
      "SELECT id,body_json FROM analytics_cache",
    ).all<{ id: string; body_json: string }>();
    for (const r of all.results) {
      const d = JSON.parse(r.body_json);
      if (mutation === "missing-zone") delete d.timeZone;
      else if (mutation === "privacy")
        d.reports.forEach((r: any) => (r.privacyFiltered = true));
      else if (mutation === "missing-day") {
        d.reports.find((r: any) => r.dimension === "date").rows = [];
        d.reports.find((r: any) => r.dimension === "total").rows = [];
      } else
        d.reports.forEach((r: any) =>
          r.rows.forEach((v: any) => (v.sessions = -1)),
        );
      await env.DB.prepare("UPDATE analytics_cache SET body_json=? WHERE id=?")
        .bind(JSON.stringify(d), r.id)
        .run();
    }
    const chat = await conversation(scope(mutation[0]));
    const a = await chat.send("acessos do site últimos sete dias");
    assert.equal(a.conversation.state, "awaiting_period", mutation);
    assert.ok(!/^0 sessões/.test(a.text));
  }
});
