// Actual Hono routes + ephemeral D1 + production web build. No browser API mocks.
import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { app } from "../src/index";
import { saveContent } from "../src/ingestion";
import { expireRadar } from "../src/radar-retention";
import { editorialWeek, RETENTION_MS } from "../src/schedule";
import { fixtureSource, fixtureCandidate } from "./fixtures";
import {
  defaultPolicy,
  sourceInputSchema,
  type Source,
} from "../packages/contracts";
import { migrationStatements } from "./migration-statements";
import type { Env } from "../src/env";

const origin = "http://localhost:5196";
const password = randomBytes(24).toString("hex");
let mf: Miniflare, env: Env, server: Server;
let holdFeed: Promise<void> | undefined, releaseFeed: (() => void) | undefined;
let holdSelection: Promise<void> | undefined,
  releaseSelection: (() => void) | undefined;
const refs: { id: string; title: string; kind: string }[] = [];
const evidence = ".wrangler/radar-reading";
const board = (page: Page) =>
  page.getByRole("region", { name: "Mesa editorial", exact: true });

test.beforeAll(async () => {
  mf = new Miniflare(
    await convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("isolated")}}',
      compatibilityDate: "2026-10-01",
      d1Databases: ["DB"],
    }),
  );
  const DB = await mf.getD1Database("DB");
  for (const f of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of migrationStatements(
      await readFile("migrations/" + f, "utf8"),
    ))
      await DB.prepare(sql).run();
  env = {
    DB,
    ENVIRONMENT: "production",
    ALLOWED_ORIGIN: origin,
    OWNER_PASSWORD_SHA256: createHash("sha256").update(password).digest("hex"),
    SESSION_SIGNING_KEY: randomBytes(32).toString("base64url"),
    INGEST_ENABLED: "false",
    SYNOPSIS_ENABLED: "false",
    RADAR_RETENTION_ENABLED: "false",
    INTEGRATION_ENABLED: "false",
    ANALYTICS_ENABLED: "false",
    BRAIN_DRIVE_ENABLED: "false",
  } as Env;
  const at = new Date().toISOString();
  await DB.prepare("INSERT INTO quality_policies VALUES (?,?,1,?)")
    .bind(defaultPolicy.version, JSON.stringify(defaultPolicy), at)
    .run();
  const sources: Source[] = [];
  const {
    id: fixtureId,
    status: fixtureStatus,
    createdAt: fixtureCreated,
    nextFetchAt: fixtureNext,
    synopsisPermissionVersion: fixturePermission,
    ...sourceInput
  } = fixtureSource;
  for (let n = 0; n < 3; n++) {
    const s = {
      ...fixtureSource,
      ...sourceInputSchema.parse({
        ...sourceInput,
        name: `HOMOLOGAÇÃO — Fonte ${n + 1}`,
        url: `https://fixtures.example.test/feed-${n}`,
        country: ["BR", "US", "US"][n],
        languages: [],
        summaryAllowed: false,
        imageAllowed: n === 0,
        rightsNote:
          "Synthetic fixtures authored for isolated homologation only.",
      }),
      id: crypto.randomUUID(),
    } as Source;
    sources.push(s);
    await DB.prepare(
      "INSERT INTO sources(id,name,connector,url,status,config_json,created_at,last_success_at,last_attempt_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        s.id,
        s.name,
        s.connector,
        s.url,
        "approved",
        JSON.stringify(s),
        at,
        at,
        at,
      )
      .run();
  }
  for (let i = 0; i < 46; i++) {
    const s = sources[i % 3],
      kind = i >= 36 && i < 40 ? "paper" : "article";
    const title = `HOMOLOGAÇÃO ${String(i + 1).padStart(2, "0")} — ${i % 3 === 0 ? "Design e cultura visual: uma investigação extensa sobre tipografia, espaços públicos e novas formas de construir identidade" : i % 3 === 1 ? "Design em movimento" : "Arquitetura e objetos do cotidiano"}`;
    const old = i === 40 || i === 41;
    const c = {
      ...fixtureCandidate,
      title,
      kind,
      authors: [{ name: "Autoria sintética", orcid: null, openalex: null }],
      url: `https://fixtures.example.test/homologation-${i}`,
      identifiers: [],
      language: ["pt", "en", "en"][i % 3],
      description: null,
      imageUrl: i % 3 === 0 ? origin + "/fixture.svg" : null,
      publishedAt: new Date(
        Date.now() - (old ? 12 * 86400000 : i * 1000),
      ).toISOString(),
      ...(i === 44
        ? { publishedAt: new Date(Date.now() + 86400000).toISOString() }
        : {}),
    } as typeof fixtureCandidate;
    const id = await saveContent(
      DB,
      c,
      s,
      {
        version: defaultPolicy.version,
        score: 90,
        factors: {
          authority: 90,
          freshness: 90,
          material: 90,
          originality: 90,
          relevance: 90,
        },
        limitations: [],
      },
      i === 42 ? "pending" : "approved",
      undefined,
      "heuristic",
      Date.now(),
      new Date(
        Date.now() - (old || i === 45 ? 12 * 86400000 : 0),
      ).toISOString(),
    );
    refs.push({ id, title, kind });
    await DB.prepare("INSERT INTO radar_seen VALUES (?,?,?)")
      .bind(s.id, c.url, at)
      .run();
    if ([4, 9, 41].includes(i))
      await DB.prepare("INSERT INTO favorites VALUES ('owner',?,?)")
        .bind(id, at)
        .run();
    if ([2, 3].includes(i))
      await DB.prepare("INSERT INTO workshop_selection VALUES ('owner',?,?,?)")
        .bind(id, i, at)
        .run();
    if ([0, 7].includes(i))
      await DB.prepare("INSERT INTO interactions VALUES ('owner',?,'read',1,?)")
        .bind(id, at)
        .run();
    if ([1, 5, 6].includes(i))
      await DB.prepare("INSERT INTO interactions VALUES ('owner',?,'seen',1,?)")
        .bind(id, at)
        .run();
    if (i === 43)
      await DB.prepare(
        "INSERT INTO interactions VALUES ('owner',?,'dismissed',1,?)",
      )
        .bind(id, at)
        .run();
  }
  await DB.prepare("INSERT INTO radar_scheduler(id) VALUES (1)").run();
  await mkdir(evidence, { recursive: true });
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, origin);
      if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
        if (url.pathname === "/api/feed" && holdFeed) await holdFeed;
        if (
          url.pathname === "/api/workshop/selection" &&
          req.method === "PUT" &&
          holdSelection
        )
          await holdSelection;
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const response = await app.fetch(
          new Request(url, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            ...(!["GET", "HEAD"].includes(req.method!)
              ? { body: Buffer.concat(chunks) }
              : {}),
          }),
          env,
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } else if (url.pathname === "/fixture.svg") {
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        res.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#fd7848"/><circle cx="60" cy="60" r="32" fill="#252126"/></svg>',
        );
      } else {
        const root = resolve("dist/web"),
          file = url.pathname.startsWith("/assets/")
            ? resolve(root, "." + url.pathname)
            : resolve(root, "index.html");
        if (!file.startsWith(root + "/") && !file.startsWith(root + "\\"))
          throw Error("invalid static path");
        res.writeHead(200, {
          "Content-Type":
            (
              {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
              } as Record<string, string>
            )[extname(file)] ?? "application/octet-stream",
        });
        res.end(await readFile(file));
      }
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(5196, "localhost", resolve),
  );
});
test.afterAll(async () => {
  releaseFeed?.();
  releaseSelection?.();
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await mf?.dispose();
});
test.beforeEach(async ({ page }) => {
  await env.DB.prepare("DELETE FROM request_budgets").run();
  await page.route("https://api.mymemory.translated.net/**", (route) =>
    route.fulfill({
      json: {
        responseStatus: 200,
        responseData: { translatedText: "Um título traduzido" },
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Senha de acesso").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(board(page).getByTestId("radar-card")).toHaveCount(37);
});

test("real session, 30+ references, responsive themes, provenance and editorial grid", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const b = board(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, theme] of [
    [1440, "dark"],
    [1280, "light"],
    [1024, "dark"],
    [1920, "light"],
    [390, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", {
          name: theme === "light" ? "Ativar tema claro" : "Ativar tema escuro",
        })
        .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: `${evidence}/${width}-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    const columns = await b
      .locator(".radar-grid")
      .evaluate(
        (grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      );
    expect(columns).toBe(width <= 680 ? 1 : width <= 1200 ? 2 : 3);
  }
  await page.getByRole("button", { name: "Abrir menu" }).click();
  const menu = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(menu.getByRole("group", { name: "Ferramentas" })).toBeVisible();
  const navBounds = await menu.boundingBox();
  const mainBounds = await page.getByRole("main").boundingBox();
  expect(navBounds!.y + navBounds!.height).toBeLessThanOrEqual(mainBounds!.y);
  await menu.getByRole("button", { name: "For You", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Abrir menu" })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const card = b.getByTestId("radar-card").first();
  await expect(card.locator(".radar-card-summary")).toContainText("Contexto");
  await expect(card.locator(".radar-card-summary")).toContainText(
    "Autoria sintética",
  );
  const surface = await card.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await card.getByRole("link", { name: "Ler original" }).hover();
  expect(
    await card.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe(surface);
  expect(
    await card.evaluate((element) => getComputedStyle(element).transform),
  ).toBe("none");
  await page.locator("#main").evaluate((el) => (el.scrollTop = 420));
  await page.screenshot({
    path: `${evidence}/country-sections.png`,
    animations: "disabled",
  });
  await page.locator("#main").evaluate((el) => (el.scrollTop = 0));
  await expect(b.getByRole("combobox")).toHaveCount(0);
  await expect(b.getByTestId("radar-card")).toHaveCount(37);
  const trigger = b.getByTestId("radar-card").first().locator(".radar-title");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const d = page.getByRole("dialog");
  await expect(d).toBeVisible();
  await expect(d.getByText("Autoria sintética")).toBeVisible();
  await expect(
    d.getByText("Resumo indisponível", { exact: false }),
  ).toBeVisible();
  await expect(d.getByText("Aprovação editorial")).toBeHidden();
  await d.getByText("Metadados e procedência", { exact: true }).click();
  await expect(d.getByText("Descoberta", { exact: true })).toBeVisible();
  await expect(d.getByText("Aprovação editorial")).toBeVisible();
  await expect(d.getByText("Última coleta da fonte")).toBeVisible();
  await expect(d.getByRole("link", { name: "Ler original" })).toHaveAttribute(
    "href",
    /fixtures\.example\.test/,
  );
  for (let i = 0; i < 12; i++) {
    if (i === 0)
      await page.screenshot({
        path: `${evidence}/1440-details.png`,
        animations: "disabled",
      });
    await page.keyboard.press("Tab");
    expect(
      await d.evaluate((e) => e.contains(document.activeElement)),
    ).toBeTruthy();
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test("global search finds authors, sources, subjects and scientific formats", async ({
  page,
}) => {
  const b = board(page);
  const search = page.getByRole("searchbox", { name: "Buscar no Lastro" });
  await search.fill("Autoria sintética");
  await search.press("Enter");
  await expect(b.getByText("Resultados para")).toContainText(
    "Autoria sintética",
  );
  await expect(b.getByText("Estudo científico", { exact: true })).toHaveCount(
    4,
  );
  const firstPage = await (
    await page.request.get("/api/search?q=Fonte%202&limit=1")
  ).json();
  const secondPage = await (
    await page.request.get(
      `/api/search?q=Fonte%202&limit=1&offset=${firstPage.nextCursor}`,
    )
  ).json();
  expect(firstPage.items).toHaveLength(1);
  expect(secondPage.items).toHaveLength(1);
  expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
  await search.fill("design");
  await search.press("Enter");
  await expect(b.getByText("Resultados para")).toContainText("design");
  await expect(b.locator(`[data-reference-id="${refs[8].id}"]`)).toBeVisible();
  await search.fill("termo-inexistente-123");
  await search.press("Enter");
  await expect(b.getByText(/Nenhum resultado/)).toBeVisible();
  await b.getByRole("button", { name: "Limpar pesquisa" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(b.getByTestId("radar-card")).toHaveCount(37);
});

test("favorite and Workshop persist through API and details reopen", async ({
  page,
}) => {
  const b = board(page),
    c = b.locator(`[data-reference-id="${refs[0].id}"]`);
  await c.getByRole("button", { name: /^Salvar / }).click();
  await expect(b.locator('[data-triage="favorito"]')).toHaveCount(4);
  await page.reload();
  await expect(
    c.getByRole("button", { name: /^Remover dos salvos / }),
  ).toHaveAttribute("aria-pressed", "true");
  await c.locator(".radar-title").click();
  holdSelection = new Promise<void>((resolve) => {
    releaseSelection = resolve;
  });
  await page.getByRole("button", { name: "Enviar para a Oficina" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  releaseSelection!();
  holdSelection = undefined;
  await expect
    .poll(
      async () =>
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM workshop_selection WHERE content_id=?",
        )
          .bind(refs[0].id)
          .first("n"),
    )
    .toBe(1);
  await expect(b.getByRole("status")).toContainText("Enviada para a Oficina.");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await c.locator(".radar-title").click();
  await expect(page.getByRole("dialog")).toContainText(refs[0].title);
  await page.keyboard.press("Escape");
  await c.getByRole("button", { name: /^Remover dos salvos / }).click();
  await c.locator(".radar-title").click();
  await page.getByRole("button", { name: "Remover da Oficina" }).click();
  await expect
    .poll(
      async () =>
        await env.DB.prepare(
          "SELECT COUNT(*) n FROM workshop_selection WHERE content_id=?",
        )
          .bind(refs[0].id)
          .first("n"),
    )
    .toBe(0);
});

test("Workshop database failure never confirms or moves a reference", async ({
  page,
}) => {
  const b = board(page),
    c = b.locator(`[data-reference-id="${refs[8].id}"]`);
  await env.DB.prepare(
    "CREATE TRIGGER fail_workshop BEFORE INSERT ON workshop_selection BEGIN SELECT RAISE(ABORT,'Synthetic storage failure'); END",
  ).run();
  try {
    await c.locator(".radar-title").click();
    await page.getByRole("button", { name: "Enviar para a Oficina" }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "Não foi possível atualizar a Oficina",
    );
    await page.keyboard.press("Escape");
    await expect(
      b.locator(`[data-reference-id="${refs[8].id}"][data-triage="novidade"]`),
    ).toHaveCount(1);
  } finally {
    await env.DB.prepare("DROP TRIGGER fail_workshop").run();
  }
});

test("loading, actual API database error and recovery", async ({ page }) => {
  const b = board(page);
  holdFeed = new Promise<void>((resolve) => {
    releaseFeed = resolve;
  });
  await b.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(b.getByRole("button", { name: "Atualizando…" })).toBeDisabled();
  await expect(b.getByTestId("radar-card")).toHaveCount(37);
  releaseFeed!();
  holdFeed = undefined;
  await expect(b.getByTestId("radar-card")).toHaveCount(37);
  await env.DB.prepare(
    "CREATE TRIGGER fail_snapshot BEFORE INSERT ON feed_snapshots BEGIN SELECT RAISE(ABORT,'Synthetic storage failure'); END",
  ).run();
  try {
    await b.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(b.getByRole("alert")).toBeVisible();
  } finally {
    await env.DB.prepare("DROP TRIGGER fail_snapshot").run();
  }
  await b.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(b.getByTestId("radar-card")).toHaveCount(37);
});

test("visible foreign titles are translated and retain their original in details", async ({
  page,
}) => {
  const title = board(page)
    .locator(`[data-reference-id="${refs[1].id}"]`)
    .locator(".radar-title")
    .first();
  await title.scrollIntoViewIfNeeded();
  await expect(title).toHaveText("Um título traduzido");
  await title.click();
  await expect(
    page.getByRole("dialog").locator(".radar-original-title"),
  ).toContainText("HOMOLOGAÇÃO");
});

test("expiration refresh, saved history and distinct scientific window", async ({
  page,
}) => {
  const id = refs[10].id,
    b = board(page);
  await env.DB.prepare("UPDATE contents SET first_seen_at=? WHERE id=?")
    .bind(new Date(Date.now() - RETENTION_MS).toISOString(), id)
    .run();
  await expireRadar(env.DB);
  await b.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(b.locator(`[data-reference-id="${id}"]`)).toHaveCount(0);
  await expect(b.locator(`[data-reference-id="${refs[41].id}"]`)).toHaveCount(
    1,
  );
  const papers = await page.request.get("/api/feed?scope=scientific&limit=50");
  expect((await papers.json()).items).toHaveLength(4);
  expect(
    (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
  ).toEqual([]);
});
