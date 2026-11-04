import { test, expect, type Page } from "@playwright/test";
import { contentFixture, fixtureSource } from "./fixtures";
import { socialAnswer } from "../packages/contracts/jarvis-social";
const dialogueView = {
  id: "12345678-1234-4234-8234-123456789012",
  revision: 0,
  state: "idle",
  pending: null,
  topic: null,
  metric: "traffic",
  period: null,
  restored: false,
};
import { mkdir } from "node:fs/promises";

async function selectMenu(page: Page, label: string, choice: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: choice, exact: true }).click();
}

async function mockApi(
  page: Page,
  count = 24,
  initialSession = true,
  withImage = false,
  editorial = false,
  radar2 = false,
) {
  const items = Array.from({ length: count }, (_, i) =>
    contentFixture({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      title: `TESTE ${i + 1} — ${i % 2 ? "Tipografia, percepção e novos contextos" : "Design de informação e cultura visual"}`,
      kind: i % 5 === 0 ? "paper" : "article",
      topics: [i % 2 ? "typography" : "design"],
      imageUrl:
        withImage && i === 0
          ? "https://fixtures.example.test/feed-image.svg"
          : null,
      ...(radar2
        ? {
            publishedAt: new Date().toISOString(),
            collectedAt: new Date().toISOString(),
            radar: {
              firstSeenAt: new Date().toISOString(),
              approvedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 9 * 86400000).toISOString(),
              expiredAt: null,
              country: i % 2 ? "GB" : "BR",
              category: "graphic_design" as const,
              level: "metadata" as const,
              triage: "novidade" as const,
            },
          }
        : {}),
      ...(editorial
        ? {
            title: [
              "Quando a tipografia organiza o cotidiano",
              "Projetar para quem perdeu a confiança online",
              "O que sustenta uma cultura de protótipos",
              "Criatividade na era dos arquivos abertos",
            ][i % 4],
            kind: "article" as const,
            sourceName: [
              "Entrelinha",
              "Design in government",
              "Cultura visual",
              "Repertório aberto",
            ][i % 4],
            synopsis: {
              text: "O artigo examina escolhas tipográficas em interfaces do cotidiano. Com exemplos de leitura, discute como o desenho das letras e a organização dos espaços participam da experiência. O enfoque está nas decisões de projeto e nas relações entre informação, contexto e legibilidade.",
              status: "validated" as const,
              evidenceUrl: "https://fixtures.example.test/evidence",
              validatedAt: "2026-10-24T00:00:00Z",
              generatorVersion: "fixture",
            },
          }
        : {}),
    }),
  );
  let authenticated = initialSession;
  let jarvisPreferences = {
    enabled: true,
    proactive: true,
    communication: "discreto",
    area: "for-you",
  };
  const collections: { id: string; name: string }[] = [];
  const members = new Set<string>();
  let selections: string[] = [];
  const calls: string[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    calls.push(`${req.method()} ${p}`);
    const body = req.postDataJSON() ?? {};
    let result: unknown;
    if (p === "/api/jarvis/conversation") result = dialogueView;
    else if (p === "/api/jarvis/state")
      result = {
        preferences: jarvisPreferences,
        notices: [],
        syncedAt: new Date().toISOString(),
        ai: { enabled: false, reason: "Modo determinístico" },
      };
    else if (p === "/api/jarvis/preferences") {
      jarvisPreferences = body;
      result = body;
    } else if (p === "/api/jarvis/actions")
      result = {
        navigation:
          body.kind === "references.open" && body.target === "queue"
            ? "queue"
            : body.kind === "workshop.prepare"
              ? "studio"
              : "workshop",
        action: body,
      };
    else if (p === "/api/auth/session") result = { authenticated };
    else if (p === "/api/auth/login") {
      authenticated = true;
      result = { authenticated };
    } else if (p === "/api/auth/logout") {
      authenticated = false;
      result = {};
    } else if (p === "/api/radar/status") {
      const fresh =
        (u.searchParams.get("since") ?? "") < "2026-10-22T00:00:00Z";
      result = {
        checkedAt: "2026-10-23T13:00:00Z",
        lastEditorialCheck: "2026-10-23T12:00:00Z",
        lastScientificRound: null,
        newApprovals: fresh ? 3 : 0,
        newContentIds: fresh ? items.slice(0, 3).map((item) => item.id) : [],
        recentTopics: fresh ? [{ name: "design", count: 3 }] : [],
      };
    } else if (p === "/api/feed") {
      const offset = Number(u.searchParams.get("cursor") ?? 0),
        limit = Number(u.searchParams.get("limit") ?? 12);
      result = {
        items: items
          .slice(offset, offset + limit)
          .filter((i) => !i.state.dismissed)
          .map((content) => ({
            content,
            explanation: {
              algorithmVersion: "TEST",
              score: 80,
              factors: {},
              reasons: ["TESTE: correspondência temática"],
              exploration: false,
            },
          })),
        nextCursor:
          offset + limit < items.length ? String(offset + limit) : null,
        snapshotId: "TEST",
        expiresAt: "2026-10-22T00:00:00Z",
        candidateLimit: 500,
        algorithmVersion: "TEST",
      };
    } else if (
      p === "/api/search" ||
      p === "/api/favorites" ||
      /^\/api\/collections\/[^/]+\/items$/.test(p)
    ) {
      const filtered = items.filter(
        (i) =>
          (p !== "/api/favorites" || i.state.favorite) &&
          (!p.startsWith("/api/collections/") || members.has(i.id)) &&
          (!u.searchParams.get("q") ||
            i.title.includes(u.searchParams.get("q")!)) &&
          (!u.searchParams.get("kind") ||
            i.kind === u.searchParams.get("kind")) &&
          (!u.searchParams.get("topic") ||
            i.topics.includes(u.searchParams.get("topic")!)),
      );
      const offset = Number(u.searchParams.get("offset") ?? 0),
        limit = Number(u.searchParams.get("limit") ?? 20);
      result = {
        items: filtered.slice(offset, offset + limit),
        nextCursor:
          offset + limit < filtered.length ? String(offset + limit) : null,
      };
    } else if (p === "/api/workshop/selection") {
      if (req.method() === "PUT") selections = body.contentIds;
      items.forEach((i) => (i.state.selected = selections.includes(i.id)));
      result = { items: items.filter((i) => i.state.selected) };
    } else if (p === "/api/collections") {
      if (req.method() === "POST") {
        const c = { id: "TEST-COLLECTION", name: body.name };
        collections.push(c);
        result = c;
      } else result = { items: collections, nextCursor: null };
    } else if (p.startsWith("/api/collections/")) {
      if (req.method() === "PUT") members.add(p.split("/").at(-1)!);
      result = {};
    } else if (p === "/api/research-packages") result = { id: "TEST-PACKAGE" };
    else if (p.endsWith("/prompt"))
      result = {
        id: "TEST-PROMPT",
        text: `TESTE — prompt isolado com ${selections.length} referências e limitações.`,
        packageId: "TEST-PACKAGE",
        version: "prompt-1.0",
      };
    else if (p === "/api/admin/overview")
      result = {
        ingestEnabled: false,
        sources: 1,
        pending: 3,
        approved: count,
        allowedHosts: ["fixtures.example.test"],
      };
    else if (p === "/api/admin/sources")
      result = { items: [fixtureSource], nextCursor: null };
    else if (p === "/api/admin/synopses")
      result = {
        items: [],
        counts: [],
        impact: {
          ready: 16,
          approved: 16,
          portuguese: 8,
          international: 8,
          publishedLast7Days: 0,
        },
        usage: { reserved_neurons: 0, calls: 0 },
        dailyBudget: 4500,
        measured: { providerNeurons: 0, calls: 0, unmeasured: 0 },
        scheduler: null,
        required: true,
        enabled: false,
      };
    else if (p === "/api/integrations/overview")
      result = {
        ...ecosystemFixture(),
        freshness: { last_success: null, error: null },
        tasks: [],
        articles: [],
        recommendations: {
          integrationAttention: [],
          articleWithoutNewsletter: [],
          continueDraft: [],
          unusedReferences: [],
        },
      };
    else if (p === "/api/integrations/weekly")
      result = {
        from: "2026-10-27T12:00:00Z",
        to: "2026-11-03T12:00:00Z",
        metrics: {
          approvedReferences: 0,
          researchPackages: 0,
          publishedArticles: null,
          pendingDrafts: null,
          preparedNewsletters: null,
          integrationFailures: 0,
        },
      };
    else if (p.startsWith("/api/admin/"))
      result = { items: [], nextCursor: null };
    else if (p.startsWith("/api/contents/")) {
      const item = items.find((i) => i.id === p.split("/")[3])!;
      if (p.endsWith("/favorite")) item.state.favorite = req.method() === "PUT";
      if (p.endsWith("/interactions"))
        item.state[body.type as "read"] = body.active;
      if (p.endsWith("/note")) item.state.note = body.text;
      result = item;
    } else throw new Error(`API de teste não prevista: ${p}`);
    await route.fulfill({ json: result });
  });
  return { calls };
}

test("Comparação premium: desktop/mobile, claro/escuro", async ({ page }) => {
  const stage = process.env.LASTRO_CAPTURE_STAGE ?? "after";
  await mkdir(`.wrangler/premium/${stage}`, { recursive: true });
  await mockApi(page, 16, true, false, true);
  for (const theme of ["dark", "light"]) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      await page.addInitScript((theme) => {
        localStorage.setItem("lastro:theme", theme);
        localStorage.setItem("lastro:motion", "full");
        localStorage.setItem("lastro-editorial-visit", "2026-10-20T00:00:00Z");
      }, theme);
      await page.goto("/");
      await expect(page.locator(".content-card")).toHaveCount(16);
      await expect(page.locator(".editorial-pulse")).toBeVisible();
      await page.screenshot({
        path: `.wrangler/premium/${stage}/${width}-${theme}.png`,
        animations: "disabled",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("Refinamento: filtro mantém a leitura enquanto aguarda resultados", async ({
  page,
}) => {
  await mockApi(page, 16, true, false, true);
  let release: (() => void) | undefined;
  const response = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/search?**", async (route) => {
    await response;
    await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto("/");
  await expect(page.locator(".content-card")).toHaveCount(16);
  const firstId = await page
    .locator(".content-card")
    .first()
    .getAttribute("id");
  await selectMenu(page, "Assunto", "Tipografia");
  await expect(
    page.getByText("ATUALIZANDO SELEÇÃO…", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".content-card")).toHaveCount(16);
  await expect(page.locator(".content-card").first()).toHaveAttribute(
    "id",
    firstId!,
  );
  await expect(page.locator(".skeleton")).toHaveCount(0);
  release!();
  await expect(
    page.getByText("Nenhuma referência neste recorte.").first(),
  ).toBeVisible();
});

test("Refinamento: feedback otimista e erro não deslocam os cards", async ({
  page,
}) => {
  await mockApi(page, 16, true, false, true);
  await page.route("**/api/contents/*/favorite", async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "TEST",
          message: "TESTE: tente salvar novamente",
          requestId: "TEST",
        },
      },
    });
  });
  await page.goto("/");
  const card = page.locator(".content-card").first();
  const y = await card.evaluate((e) => (e as HTMLElement).offsetTop);
  await card
    .getByRole("button", { name: "Salvar referência", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Remover dos salvos", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("TESTE: tente salvar novamente", { exact: false }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Salvar referência", exact: true }),
  ).toBeEnabled();
  expect(
    Math.abs((await card.evaluate((e) => (e as HTMLElement).offsetTop)) - y),
  ).toBeLessThan(1);
  expect(
    await page
      .locator(".workspace-feedback")
      .evaluate((e) => getComputedStyle(e).position),
  ).toBe("fixed");
});

test("Refinamento: menus interrompíveis, origem e teclado imediato", async ({
  page,
}) => {
  await mockApi(page, 16, true, false, true);
  await page.goto("/");
  const combo = page.getByRole("combobox", { name: "Assunto", exact: true });
  await combo.click();
  await expect(combo).toHaveAttribute("aria-expanded", "true");
  const origin = await page
    .locator(".select-menu")
    .evaluate((e) => getComputedStyle(e).transformOrigin);
  expect(origin).not.toBe("0px 0px");
  const properties = await page.locator(".select-menu").evaluate((e) =>
    e
      .getAnimations()
      .filter((a) => a.id.startsWith("lastro-"))
      .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes())
      .flatMap((f) => Object.keys(f))
      .filter(
        (k) => !["offset", "computedOffset", "easing", "composite"].includes(k),
      ),
  );
  expect(properties.every((p) => ["transform", "opacity"].includes(p))).toBe(
    true,
  );
  await combo.click();
  await combo.click();
  await expect(
    page.getByRole("listbox", { name: "Assunto", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".select-menu")).toHaveCount(0);
  await expect(combo).toBeFocused();
  await combo.press("ArrowDown");
  await expect(
    page.getByRole("listbox", { name: "Assunto", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) => a.id.startsWith("lastro-") && a.playState === "running",
          ).length,
    ),
  ).toBe(0);
  await page.keyboard.press("Escape");
  const toggle = page.getByRole("button", { name: "Ver lista", exact: true });
  await toggle.focus();
  await toggle.press("Enter");
  await expect(page.locator(".view-list")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.id === "lastro-layout" && a.playState === "running")
          .length,
    ),
  ).toBe(0);
  await page.locator(".content-card").first().hover();
  await expect(page.locator("html")).toHaveAttribute("data-input", "pointer");
});

test("Refinamento: mudança para movimento reduzido interrompe a animação atual", async ({
  page,
}) => {
  await mockApi(page, 16, true, false, true);
  await page.goto("/");
  await page.getByRole("combobox", { name: "Assunto", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(
    page.getByRole("listbox", { name: "Assunto", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === "running")
          .length,
    ),
  ).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".select-menu")).toHaveCount(0);
});

test("Refinamento: toque com alvos de 44px e sem hover de mouse", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await mockApi(page, 16, true, false, true);
    await page.goto("http://127.0.0.1:5175/");
    await expect(page.locator(".content-card")).toHaveCount(16);
    await page.getByRole("combobox", { name: "Assunto", exact: true }).tap();
    await expect(
      page.getByRole("listbox", { name: "Assunto", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("option", { name: "Todos os assuntos", exact: true })
      .tap();
    const button = page
      .getByRole("button", { name: "Salvar referência", exact: true })
      .first();
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await button.tap();
    await expect(
      page
        .getByRole("button", { name: "Remover dos salvos", exact: true })
        .first(),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await page
        .locator(".content-card")
        .first()
        .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a),
    ).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test("Refinamento: Curadoria conserva controles e estados no tema claro", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Curadoria", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Critério antes de volume." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sinopses", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sinopses editoriais", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ativar tema claro", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByText("Geração desativada.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Processar próxima referência",
      exact: true,
    }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Imagem autorizada, link externo e ações persistentes no celular", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://fixtures.example.test/feed-image.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="red"/></svg>',
    }),
  );
  await mockApi(page, 12, true, true);
  await page.goto("/");
  const card = page.locator(".content-card").first();
  await expect(card.locator("img.card-image")).toHaveJSProperty(
    "naturalWidth",
    64,
  );
  await expect(card.locator(".article-link")).toHaveAttribute(
    "target",
    "_blank",
  );
  await card.getByRole("button", { name: "Salvar referência" }).click();
  await card.getByRole("button", { name: "Selecionar para a Oficina" }).click();
  await card.getByRole("button", { name: "Marcar como lido" }).click();
  await page.reload();
  await expect(
    card.getByRole("button", { name: "Remover dos salvos" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    card.getByRole("button", { name: "Remover da Oficina" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    card.getByRole("button", { name: "Marcar como não lido" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const count of [2, 12, 24, 100])
  test(`Radar com ${count} referências, paginação e contexto preservado`, async ({
    page,
  }) => {
    const { calls } = await mockApi(page, count);
    await page.goto("/");
    const cards = page.locator(".content-card");
    await expect(cards).toHaveCount(Math.min(16, count));
    if (count > 16) {
      await page
        .getByRole("button", { name: "Carregar mais referências" })
        .click();
      await expect(cards).toHaveCount(Math.min(32, count));
    }
    const feedCalls = calls.filter((c) => c === "GET /api/feed").length;
    if (count >= 24)
      await page.locator("#main").evaluate((main) => (main.scrollTop = 400));
    await page.getByRole("button", { name: "Salvos", exact: true }).click();
    await page.getByRole("button", { name: "For You", exact: true }).click();
    await expect(cards).toHaveCount(Math.min(count > 16 ? 32 : 16, count));
    if (count >= 24) {
      await expect
        .poll(() => page.locator("#main").evaluate((main) => main.scrollTop))
        .toBe(400);
      await page.getByRole("button", { name: "Salvos", exact: true }).click();
      await page.goBack();
      await expect
        .poll(() => page.locator("#main").evaluate((main) => main.scrollTop))
        .toBe(400);
    }
    expect(calls.filter((c) => c === "GET /api/feed")).toHaveLength(feedCalls);
    await page
      .getByRole("button", { name: "Surpreenda-me", exact: true })
      .click();
    await expect(page.locator(".content-card:focus")).toHaveCount(1);
  });

test("Favorito, leitura, coleção, nota, seleção independente e prompt", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Salvar referência", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Selecionar para a Oficina", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Marcar como lido", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Salvos", exact: true }).click();
  await expect(page.locator(".content-card")).toHaveCount(1);
  await page.getByLabel("Nome da nova coleção").fill("TESTE Projeto");
  await page
    .getByRole("button", { name: "Criar coleção", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "TESTE Projeto", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Todos os salvos", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: /Adicionar TESTE.*à coleção/ })
    .click();
  await page
    .getByRole("option", { name: "TESTE Projeto", exact: true })
    .click();
  await page
    .getByRole("button", { name: "TESTE Projeto", exact: true })
    .click();
  await expect(page.locator(".content-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Editar nota pessoal" }).click();
  await page.getByLabel("Texto da nota pessoal").fill("TESTE nota");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((dialog) => dialog.contains(document.activeElement)),
  ).toBe(true);
  await page.getByRole("button", { name: "Salvar nota", exact: true }).click();
  await expect(page.locator(".saved-note")).toContainText("TESTE nota");
  await page.getByRole("button", { name: "Oficina", exact: true }).click();
  await page
    .getByLabel("Objetivo da publicação", { exact: false })
    .fill("TESTE proposta editorial");
  await page.getByRole("button", { name: "Gerar prompt com 1 fonte" }).click();
  await expect(page.getByLabel("Prompt gerado")).toHaveValue(
    /TESTE — prompt isolado/,
  );
  await page
    .getByRole("button", { name: "Voltar e editar parâmetros" })
    .click();
  await expect(
    page.getByLabel("Objetivo da publicação", { exact: false }),
  ).toHaveValue("TESTE proposta editorial");
});

test("Jarvis: contexto real, uma sugestão, preferências e desativação persistentes", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator(".jarvis-hint")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  await page.getByText("Preferências e contexto", { exact: true }).click();
  await page.getByLabel("Receber sugestões espontâneas").uncheck();
  await page
    .getByRole("button", { name: "Minimizar Jarvis", exact: true })
    .click();
  await expect(page.locator(".jarvis-panel")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  await page.getByText("Preferências e contexto", { exact: true }).click();
  await page
    .getByRole("button", { name: "Desativar Jarvis", exact: true })
    .click();
  await expect(
    page.getByText("Jarvis desativado", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Jarvis desativado", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".jarvis-hint")).toHaveCount(0);
  await page.getByRole("button", { name: "Reativar Jarvis" }).click();
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  await page.getByText("Preferências e contexto", { exact: true }).click();
  await expect(
    page.getByLabel("Receber sugestões espontâneas"),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Curadoria", exact: true }).click();
  await page
    .getByRole("button", { name: "Fila de revisão", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Fila de revisão", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Busca, filtros e estado vazio honestos", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByLabel("Buscar conteúdos").fill("inexistente");
  await expect(
    page.getByText("Ainda não há referências por aqui"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Radar Científico · pesquisas", exact: true })
    .click();
  await expect(page.locator(".content-card")).toHaveCount(5);
  await page
    .getByRole("button", { name: "Radar Diário · artigos", exact: true })
    .click();
  await expect(page.locator(".content-card")).toHaveCount(19);
  await page.getByRole("button", { name: "Ver lista", exact: true }).click();
  await page.reload();
  await expect(page.locator(".content-card")).toHaveCount(19);
  await expect(
    page.getByRole("button", { name: "Ver cards", exact: true }),
  ).toBeVisible();
});

test("Login e erro recuperável de rede", async ({ page }) => {
  await mockApi(page, 0, false);
  await page.goto("/");
  await page.getByLabel("Senha de acesso").fill("TESTE-SENHA-SEM-VALOR");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByText("Nenhuma referência neste recorte.").first(),
  ).toBeVisible();
  await page.route("**/api/feed?**", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "TEST",
          message: "TESTE falha de rede",
          requestId: "TEST",
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(
    page.getByText("TESTE falha de rede", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tentar novamente", exact: false }),
  ).toBeVisible();
});

for (const [width, height] of [
  [1440, 900],
  [1366, 768],
  [768, 1024],
  [390, 844],
  [320, 720],
])
  test(`Responsivo ${width}x${height}, teclado e movimento reduzido`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(page);
    await page.goto("/");
    await expect(page.locator(".content-card")).toHaveCount(16);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const first = await page.locator(".content-card").first().boundingBox();
    expect(first!.y).toBeLessThan(height);
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: `docs/examples/for-you-2-${width}-dark.png`,
        fullPage: false,
      });
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Ir para o conteúdo" }),
    ).toBeFocused();

    await page
      .getByRole("button", { name: "Salvar referência", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Selecionar para a Oficina", exact: true })
      .first()
      .click();
    for (const area of ["Salvos", "Oficina", "Curadoria", "Publicações"]) {
      if (width <= 390)
        await page.getByRole("button", { name: "Abrir menu" }).click();
      await page.getByRole("button", { name: area, exact: true }).click();
      if (area === "Oficina")
        await expect(
          page.getByLabel("Objetivo da publicação", { exact: false }),
        ).toBeVisible();
      if (area === "Curadoria")
        await expect(
          page.getByRole("button", { name: "Fila de revisão", exact: true }),
        ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  });

test("Temas: paleta medida, contraste, ausência de verde e persistência", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const theme of ["dark", "light"]) {
    if (theme === "light")
      await page.getByRole("button", { name: "Ativar tema claro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const palette = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const green = [...document.querySelectorAll("*")]
        .filter((e) => e.getClientRects().length)
        .flatMap((e) => {
          const style = getComputedStyle(e);
          return [style.color, style.backgroundColor, style.borderColor].filter(
            (v) => {
              const c = v.match(/[\d.]+/g)?.map(Number);
              return (
                c &&
                c.length >= 3 &&
                (c.length < 4 || c[3] > 0) &&
                c[1] > c[0] + 8 &&
                c[1] > c[2] + 5
              );
            },
          );
        });
      return {
        accent: root.getPropertyValue("--accent").trim(),
        paper: root.getPropertyValue("--paper").trim(),
        ink: root.getPropertyValue("--ink").trim(),
        muted: root.getPropertyValue("--muted").trim(),
        surface: root.getPropertyValue("--surface").trim(),
        green,
      };
    });
    expect(palette.accent).toBe("#e50914");
    expect(palette.green).toEqual([]);
    const luminance = (hex: string) => {
      const raw = hex.replace("#", "");
      const c = raw.length === 3 ? [...raw].map((v) => v + v).join("") : raw;
      return [0, 2, 4]
        .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    };
    const contrast = (a: string, b: string) => {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    expect(contrast(palette.ink, palette.paper)).toBeGreaterThan(4.5);
    expect(contrast(palette.muted, palette.surface)).toBeGreaterThan(4.5);
    if (theme === "light") {
      await page.waitForTimeout(500);
    }
    if (theme === "light")
      await page.screenshot({ path: "docs/examples/stage04-3-1440-light.png" });
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("Movimento: órbitas reais, intensidade persistente e preferência do sistema", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  const orbit = page.locator(".jarvis-toggle .jarvis-orbit").first();
  const before = await orbit.evaluate((e) => getComputedStyle(e).transform);
  await page.waitForTimeout(150);
  expect(await orbit.evaluate((e) => getComputedStyle(e).transform)).not.toBe(
    before,
  );
  await selectMenu(page, "Intensidade de movimento", "Movimento desativado");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === "running")
          .length,
    ),
  ).toBe(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await selectMenu(page, "Intensidade de movimento", "Movimento reduzido");
  expect(await orbit.evaluate((e) => getComputedStyle(e).animationName)).toBe(
    "none",
  );
  await selectMenu(page, "Intensidade de movimento", "Movimento completo");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  expect(await orbit.evaluate((e) => getComputedStyle(e).animationName)).toBe(
    "none",
  );
  await page
    .getByRole("button", { name: "Surpreenda-me", exact: true })
    .click();
  await expect(page.locator(".is-discovering")).toHaveCount(1);
  expect(
    await page
      .locator(".is-discovering")
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
  await expect(page.locator(".is-discovering")).toHaveCount(0, {
    timeout: 4000,
  });
});

for (const width of [1440, 768, 390])
  test(`Jarvis ${width}: faixa segura, painel sem cobrir conteúdo e seleção`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Selecionar para a Oficina", exact: true })
      .first()
      .click();
    const overlaps = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
    const main = await page.locator("#main").boundingBox(),
      toggle = await page.locator(".jarvis-toggle").boundingBox(),
      selection = await page.locator(".selection-bar").boundingBox();
    expect(overlaps(main!, toggle!)).toBe(false);
    expect(overlaps(selection!, toggle!)).toBe(false);
    await page
      .getByRole("button", { name: "Jarvis Seu próximo caminho" })
      .click();
    await expect(
      page.getByRole("region", { name: "Painel Jarvis" }),
    ).toBeVisible();
    const chatBox = await page.locator(".jarvis-panel").boundingBox();
    expect(chatBox!.x).toBeGreaterThanOrEqual(0);
    expect(chatBox!.y).toBeGreaterThanOrEqual(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".jarvis-panel")).toHaveCount(0);
    await expect(page.locator(".jarvis-toggle")).toBeFocused();
  });

test("Descoberta e cards: abertura editorial, ampliação suave e grid/lista", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator(".content-card")).toHaveCount(16);
  const dimensions = await page
    .locator(".content-card")
    .evaluateAll((cards) =>
      cards.map((card) =>
        [
          Math.round((card as HTMLElement).offsetWidth),
          Math.round((card as HTMLElement).offsetHeight),
        ].join("x"),
      ),
    );
  expect(new Set(dimensions).size).toBeGreaterThan(1);
  await expect(page.locator(".editorial-lead")).toHaveCount(1);
  await expect(page.locator(".editorial-secondary")).toHaveCount(2);
  const card = page.locator(".content-card").first();
  await card.hover();
  await expect
    .poll(() =>
      card.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a),
    )
    .toBeCloseTo(1, 3);
  await expect
    .poll(() =>
      card.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m42),
    )
    .toBeCloseTo(-2, 1);
  await page
    .getByRole("button", { name: "Surpreenda-me", exact: true })
    .click();
  await expect(page.locator(".is-discovering")).toHaveCount(1);
  const animations = await page
    .locator(".is-discovering")
    .evaluate((e) =>
      e.getAnimations().map((a) => (a as CSSAnimation).animationName),
    );
  expect(animations).toContain("discovery-flash");
  await expect(page.locator(".is-discovering")).toHaveCount(0, {
    timeout: 4000,
  });
  await page.getByRole("button", { name: "Ver lista", exact: true }).click();
  await expect(page.locator(".view-list")).toHaveCount(1);
  expect(
    await page.evaluate(() => {
      const r = document.querySelector("footer")!.getBoundingClientRect();
      return (
        document
          .elementFromPoint(r.x + 60, r.y + 30)
          ?.closest(".content-card") === null
      );
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "Ver cards", exact: true }).click();
  await expect(page.locator(".view-grid")).toHaveCount(1);
});

test("Pulso preserva novidades ao recarregar, usa cache e confirma somente ao explorar", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("lastro-editorial-visit"))
      localStorage.setItem("lastro-editorial-visit", "2026-10-01T00:00:00Z");
  });
  const { calls } = await mockApi(page);
  await page.goto("/");
  await expect(
    page.getByText("3 novas referências desde sua última conferência"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Para observar agora" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("3 novas referências desde sua última conferência"),
  ).toBeVisible();
  expect(calls.filter((call) => call === "GET /api/radar/status")).toHaveLength(
    1,
  );
  await page
    .getByRole("button", { name: "Ver novidades", exact: true })
    .click();
  await expect(page.locator(".content-card.is-new")).toHaveCount(3);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("lastro-editorial-visit")),
    )
    .toBe("2026-10-23T13:00:00Z");
});

test("Menus profissionais: teclado, opções em português, seleção e recorte responsivo", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/");
  const subject = page.getByRole("combobox", { name: "Assunto", exact: true });
  await subject.click();
  await expect(
    page.getByRole("listbox", { name: "Assunto", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/examples/stage04-3-menu-dark.png",
    animations: "disabled",
  });
  await subject.press("End");
  await subject.press("Enter");
  await expect(subject).toContainText("Acessibilidade");
  await subject.click();
  await subject.press("Escape");
  await expect(subject).toBeFocused();
  await selectMenu(page, "Assunto", "Todos os assuntos");
  await selectMenu(page, "Formato", "Artigo");
  await expect(page.locator(".content-card")).toHaveCount(19);
  await page.setViewportSize({ width: 390, height: 844 });
  await subject.click();
  const menu = await page
    .getByRole("listbox", { name: "Assunto", exact: true })
    .boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(390);
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(844);
  await subject.press("Escape");
});

for (const viewport of [
  { width: 1440, height: 900, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
  { width: 568, height: 320, theme: "dark" },
]) {
  test(`Acessos rápidos: nova aba e sessão preservada em ${viewport.width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(
      (theme) => localStorage.setItem("lastro:theme", theme),
      viewport.theme,
    );
    const { calls } = await mockApi(page);
    await context.route(
      /^https:\/\/(marioserafim\.com\.br|app\.pagescms\.org)\//,
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<title>Destino externo</title>",
        }),
    );
    await page.goto("/");
    await expect(page.locator(".content-card")).toHaveCount(16);
    if (viewport.width <= 620)
      await page
        .getByRole("button", { name: "Abrir menu", exact: true })
        .click();
    const shortcuts = page.getByRole("group", {
      name: "Acessos rápidos",
      exact: true,
    });
    await expect(shortcuts).toBeVisible();
    const initialUrl = page.url();
    const initialMutations = calls.filter((call) => !call.startsWith("GET "));
    for (const [name, url] of [
      ["Portfólio", "https://marioserafim.com.br/"],
      [
        "Novo artigo",
        "https://app.pagescms.org/MarioSerafimCoder/portfolio-oficial/main/collection/posts/new",
      ],
    ]) {
      const link = shortcuts.getByRole("link", {
        name: `${name} (abre em nova aba)`,
        exact: true,
      });
      await link.scrollIntoViewIfNeeded();
      await page.keyboard.press("Tab");
      await link.focus();
      await expect(link).toBeFocused();
      await expect(link).toHaveCSS("outline-style", "solid");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      const bounds = await link.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      const position = await page
        .locator("#main")
        .evaluate((el) => el.scrollTop);
      const popupPromise = page.waitForEvent("popup");
      await link.press("Enter");
      const popup = await popupPromise;
      await popup.waitForLoadState();
      expect(popup.url()).toBe(url);
      expect(await popup.evaluate(() => window.opener === null)).toBe(true);
      await popup.close();
      expect(page.url()).toBe(initialUrl);
      expect(await page.locator("#main").evaluate((el) => el.scrollTop)).toBe(
        position,
      );
      await expect(page.locator(".content-card")).toHaveCount(16);
    }
    expect(calls.filter((call) => !call.startsWith("GET "))).toEqual(
      initialMutations,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mkdir(".wrangler/quick-access", { recursive: true });
    await page.screenshot({
      path: `.wrangler/quick-access/${viewport.width}.png`,
    });
  });
}

test.describe("Demonstração animada 04.3", () => {
  test.skip(
    !process.env.LASTRO_RECORD_DEMO,
    "Gravação opt-in; execute com LASTRO_RECORD_DEMO=1 e FFmpeg do Playwright instalado.",
  );
  test("gravar experiência real da interface com fixtures isoladas", async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "no-preference",
      recordVideo: {
        dir: ".wrangler/motion-demo",
        size: { width: 1440, height: 900 },
      },
    });
    const page = await context.newPage();
    await mockApi(page);
    const video = page.video()!;
    await page.goto("http://127.0.0.1:5175/");
    await expect(page.locator(".content-card")).toHaveCount(16);
    await page.waitForTimeout(1300);
    for (const index of [0, 1]) {
      await page.locator(".content-card").nth(index).hover();
      await page.waitForTimeout(700);
    }
    await page
      .getByRole("button", { name: "Salvar referência", exact: true })
      .first()
      .click();
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole("button", { name: "Selecionar para a Oficina", exact: true })
        .first()
        .click();
      await page.waitForTimeout(650);
    }
    await page.getByRole("button", { name: "Salvos", exact: true }).click();
    await page.waitForTimeout(850);
    await page.getByRole("button", { name: "Oficina", exact: true }).click();
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: "For You", exact: true }).click();
    await page.waitForTimeout(900);
    await page
      .getByRole("button", { name: "Jarvis Seu próximo caminho" })
      .click();
    await page.waitForTimeout(1700);
    await page
      .getByRole("button", { name: "Minimizar Jarvis", exact: true })
      .click();
    await page.waitForTimeout(650);
    await page
      .getByRole("button", { name: "Surpreenda-me", exact: true })
      .click();
    await page.waitForTimeout(2200);
    await page.getByRole("combobox", { name: "Assunto", exact: true }).click();
    await page.waitForTimeout(900);
    await page
      .getByRole("combobox", { name: "Assunto", exact: true })
      .press("Escape");
    await page.getByRole("button", { name: "Ativar tema claro" }).click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Ver lista", exact: true }).click();
    await page.waitForTimeout(1100);
    await page.getByRole("button", { name: "Ver cards", exact: true }).click();
    await page.waitForTimeout(750);
    await page.getByRole("button", { name: "Ativar tema escuro" }).click();
    await page.waitForTimeout(1200);
    await page.close();
    await context.close();
    await video.saveAs("docs/examples/stage04-3-motion.webm");
  });
});

const ecosystemFixture = () => ({
  version: "ecosystem-1.0",
  enabled: false,
  freshness: { last_success: "2026-11-03T12:00:00Z", error: null },
  tasks: [
    {
      id: "historical",
      kind: "article",
      source_id: "artigo-historico",
      version: "sha",
      state: "intervention",
      error: "backlog_review",
      created_at: "2026-11-03T12:00:00Z",
      updated_at: "2026-11-03T12:00:00Z",
      next_at: 0,
    },
  ],
  studioDrafts: [],
  articles: [
    {
      slug: "agendado",
      title: "Artigo agendado",
      state: "scheduled",
      publish_at: "2026-11-04T13:00:00Z",
    },
  ],
  newsletters: [],
  withoutNewsletter: [],
  recommendations: {
    integrationAttention: [{ id: "historical" }],
    articleWithoutNewsletter: [],
    continueDraft: [],
    unusedReferences: [],
  },
});
for (const width of [1280, 390])
  test(`Ecossistema: snapshot, histórico, calendário e resumo em ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await mockApi(page, 2);
    const overview = ecosystemFixture();
    let approvals = 0;
    await page.route("**/api/integrations/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/weekly"))
        return route.fulfill({
          json: {
            from: "2026-10-27T12:00:00Z",
            to: "2026-11-03T12:00:00Z",
            metrics: {
              approvedReferences: 0,
              researchPackages: 2,
              publishedArticles: null,
              pendingDrafts: null,
              preparedNewsletters: 0,
              integrationFailures: 0,
            },
          },
        });
      if (path.endsWith("/retry")) {
        approvals++;
        return route.fulfill({ json: { id: "historical", state: "pending" } });
      }
      return route.fulfill({ json: overview });
    });
    await page.goto("/publicacoes");
    await expect(
      page.getByRole("heading", { name: "Calendário editorial" }),
    ).toBeVisible();
    await expect(page.getByText("04/11/2026, 10:00").first()).toBeVisible();
    await expect(page.getByText("Indisponível", { exact: true })).toHaveCount(
      2,
    );
    expect(approvals).toBe(0);
    await page
      .getByRole("button", { name: "Aprovar rascunho para este artigo" })
      .click();
    expect(approvals).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Jarvis", exact: false })
      .first()
      .click();
    await expect(page.getByLabel("Consultar o ecossistema")).toBeVisible();
    await page.getByRole("button", { name: "Minimizar Jarvis" }).click();
    await page.route("**/api/integrations/overview", (route) =>
      route.fulfill({ status: 503, json: { error: { message: "Offline" } } }),
    );
    await page.getByRole("button", { name: "Atualizar consulta" }).click();
    await expect(
      page.getByText("Integração indisponível.", { exact: false }),
    ).toBeVisible();
  });
test("Ecossistema: rascunho assíncrono preserva prompt e reutiliza vínculo", async ({
  page,
}) => {
  await mockApi(page, 2, true, false, false, true);
  const overview = ecosystemFixture();
  overview.tasks = [];
  let requests = 0;
  await page.route("**/api/integrations/overview", (route) =>
    route.fulfill({ json: overview }),
  );
  await page.route("**/api/research-packages/*/studio-draft", async (route) => {
    requests++;
    await route.fulfill({
      status: 202,
      json: { id: "draft-task", state: "pending", attempts: 0 },
    });
  });
  await page.goto("/");
  await page.getByTestId("radar-card").first().locator(".radar-title").click();
  await page
    .getByRole("button", { name: "Selecionar / remover da Oficina" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Mesa editorial", exact: true })
      .getByRole("status"),
  ).toContainText("Seleção da Oficina atualizada");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Oficina", exact: true }).click();
  await page
    .getByLabel("Objetivo da publicação", { exact: false })
    .fill("Título editorial");
  await page.getByRole("button", { name: "Gerar prompt com 1 fonte" }).click();
  await page
    .getByRole("button", { name: "Criar rascunho no Studio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Criar rascunho no Studio", exact: true }),
  ).toBeDisabled();
  expect(requests).toBe(1);
  await expect(page.getByLabel("Prompt gerado")).toHaveValue(/TESTE/);
  await page.route("**/api/integrations/overview", (route) =>
    route.fulfill({
      json: {
        ...overview,
        studioDrafts: [
          {
            id: "draft",
            package_id: "TEST-PACKAGE",
            slug: "titulo",
            admin_url: "https://studio.marioserafim.com.br/editor/draft",
          },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: "Consultar estado" }).click();
  await expect(
    page.getByRole("link", { name: "Abrir no Studio" }),
  ).toHaveAttribute("href", "https://studio.marioserafim.com.br/editor/draft");
});

for (const width of [1280, 390])
  test(`commercial panels remain private, editable and responsive at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, 0);
    let item = {
      id: "12345678-1234-4234-8234-123456789012",
      name: "Contato sintético",
      email: "synthetic@example.invalid",
      whatsapp: "5511999999999",
      project_type: "Branding",
      area: "Design",
      budget: "A combinar",
      description: "Solicitação sintética para homologação privada.",
      received_at: "2026-11-01T12:00:00Z",
      status: "novo",
      notes: "",
      next_contact: null as string | null,
    };
    await page.route("**/api/opportunities**", async (route) => {
      const req = route.request();
      if (req.method() === "PATCH") {
        item = { ...item, ...req.postDataJSON() };
        await route.fulfill({ json: { updated: true } });
      } else if (req.method() === "DELETE") {
        await route.fulfill({ json: { deleted: true } });
      } else await route.fulfill({ json: { items: [item] } });
    });
    await page.route("**/api/newsletters?*", (route) =>
      route.fulfill({
        json: {
          analytics: {
            status: "available",
            freshness: { fetchedAt: "2026-11-03T12:00:00Z", stale: false },
            error: null,
            data: {
              reports: [
                {
                  dimension: "sessionCampaignName",
                  rows: [
                    {
                      sessionCampaignName: "edicao-sintetica",
                      sessions: 2,
                      screenPageViews: 3,
                      engagementRate: 0.5,
                    },
                  ],
                },
                { dimension: "pagePath", rows: [] },
                { dimension: "date", rows: [] },
              ],
            },
          },
          crm: null,
        },
      }),
    );
    await page.goto("/oportunidades");
    await expect(
      page.getByRole("heading", { name: "Oportunidades", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Abrir detalhes" }).click();
    await page
      .getByLabel("Observações privadas")
      .fill("Acompanhar proposta sintética");
    await page
      .getByLabel("Status da oportunidade", { exact: true })
      .last()
      .selectOption("em_conversa");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Branding · Em conversa")).toBeVisible();
    expect(item.notes).toBe("Acompanhar proposta sintética");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.goto("/newsletters");
    await expect(
      page.getByRole("heading", { name: "Comparar campanhas" }),
    ).toBeVisible();
    await expect(
      page.getByRole("rowheader", { name: "edicao-sintetica" }),
    ).toBeVisible();
    await expect(
      page.getByText("Informações do CRM indisponíveis."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

for (const width of [1280, 390])
  test(`Jarvis 2 answers, clarification and supervised navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, 0);
    const preferences = {
      enabled: true,
      proactive: true,
      communication: "discreto",
      area: "for-you",
    };
    const notice = {
      id: "a".repeat(64),
      priority: 95,
      text: "Há uma oportunidade com acompanhamento atrasado.",
      changedAt: new Date().toISOString(),
      action: {
        kind: "opportunity.open",
        target: "12345678-1234-4234-8234-123456789012",
      },
    };
    let dismissed = false,
      questions = 0;
    await page.route("**/api/jarvis/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname,
        body = request.method() === "GET" ? {} : request.postDataJSON();
      let result: unknown = {};
      if (path.endsWith("/state"))
        result = {
          preferences,
          notices: dismissed ? [] : [notice],
          syncedAt: new Date().toISOString(),
          ai: { enabled: false, reason: "Modo determinístico" },
        };
      if (path.endsWith("/notices")) {
        if (body.operation === "dismiss") dismissed = true;
        result = { allowed: true };
      }
      if (path.endsWith("/preferences")) result = body;
      if (path.endsWith("/conversation") && request.method() !== "POST")
        return route.fulfill({ json: dialogueView });
      if (path.endsWith("/conversation")) {
        questions++;
        result = {
          conversation: { ...dialogueView, revision: body.revision + 1 },
          text:
            body.text === "as atrasadas"
              ? "Há uma oportunidade atrasada."
              : "Qual consulta deseja fazer?",
          source: "D1 · oportunidades",
          period: {
            label: "Estado atual",
            from: null,
            to: new Date().toISOString(),
            days: null,
          },
          syncedAt: new Date().toISOString(),
          incomplete: false,
          stale: false,
          ai: { enabled: false, reason: "Modo determinístico" },
          ...(body.text === "as atrasadas"
            ? { action: notice.action }
            : {
                choices: [
                  {
                    intent: "opportunities.overdue",
                    label: "Acompanhamentos atrasados",
                  },
                ],
              }),
        };
      }
      if (path.endsWith("/actions"))
        result = { navigation: "opportunities", action: notice.action };
      await route.fulfill({ json: result });
    });
    await page.route("**/api/opportunities", (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: notice.action.target,
              name: "Contato sintético",
              email: "synthetic@example.invalid",
              whatsapp: "",
              project_type: "Branding",
              area: "Design",
              budget: "",
              description: "Teste isolado de navegação supervisionada.",
              received_at: new Date().toISOString(),
              status: "novo",
              next_contact: null,
              notes: "",
            },
          ],
        },
      }),
    );
    await page.goto("/");
    await expect(page.getByText(notice.text).first()).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Painel Jarvis" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Dispensar sugestão", exact: true })
      .click();
    await expect.poll(() => dismissed).toBe(true);
    await page
      .getByRole("button", { name: "Jarvis Seu próximo caminho", exact: true })
      .click();
    await page.getByLabel("Consultar o ecossistema").fill("oportunidades");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(
      page.getByText("Qual consulta deseja fazer?", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Consultar o ecossistema").fill("as atrasadas");
    await page.getByLabel("Consultar o ecossistema").press("Enter");
    await expect(
      page.getByText("Há uma oportunidade atrasada.", { exact: true }),
    ).toBeVisible();
    expect(questions).toBe(2);
    await page
      .getByRole("button", { name: "Revisar ação", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Oportunidades", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Detalhes da oportunidade" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

test("Jarvis defers balloons while editing and shares initial state requests", async ({
  page,
}) => {
  await mockApi(page, 0);
  let states = 0,
    shown = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/jarvis/**", async (route) => {
    if (route.request().url().endsWith("/conversation"))
      return route.fulfill({ json: dialogueView });
    if (route.request().method() === "GET") {
      states++;
      await gate;
      await route.fulfill({
        json: {
          preferences: {
            enabled: true,
            proactive: true,
            communication: "formal",
            area: "for-you",
          },
          notices: [
            {
              id: "b".repeat(64),
              priority: 90,
              text: "Há um pedido de orçamento aguardando atendimento.",
              changedAt: new Date().toISOString(),
              action: { kind: "opportunity.open" },
            },
          ],
          syncedAt: new Date().toISOString(),
          ai: { enabled: false, reason: "Modo determinístico" },
        },
      });
    } else {
      shown++;
      await route.fulfill({ json: { allowed: true } });
    }
  });
  await page.goto("/");
  await page
    .getByLabel("Pesquisa", { exact: true })
    .fill("trabalho em andamento");
  release();
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  await expect(page.getByLabel("Consultar o ecossistema")).toBeVisible();
  expect(states).toBe(1);
  expect(shown).toBe(0);
  await expect(
    page.getByRole("button", { name: "Dispensar sugestão" }),
  ).toHaveCount(0);
});

for (const width of [1280])
  test(`Jarvis conversation keyboard, errors, clearing and logout ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, 0);
    let queries: string[] = [];
    let fail = true;
    let hold = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/jarvis/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/state"))
        return route.fulfill({
          json: {
            preferences: {
              enabled: true,
              proactive: false,
              communication: "formal",
              area: "for-you",
            },
            notices: [],
            syncedAt: new Date().toISOString(),
            ai: { enabled: false, reason: "Determinístico" },
          },
        });
      if (path.endsWith("/conversation") && route.request().method() !== "POST")
        return route.fulfill({ json: dialogueView });
      if (path.endsWith("/conversation")) {
        const body = route.request().postDataJSON();
        queries.push(body.text);
        if (hold) await gate;
        if (fail) {
          fail = false;
          await route.fulfill({ status: 503, json: { error: "unavailable" } });
          return;
        }
        try {
          await route.fulfill({
            json: {
              conversation: { ...dialogueView, revision: body.revision + 1 },
              text: "Há duas oportunidades aguardando acompanhamento.",
              action: { kind: "article.open", target: "teste" },
              source: "D1 · oportunidades",
              period: { label: "Estado atual" },
              syncedAt: "2026-11-03T20:00:00Z",
              incomplete: false,
              stale: false,
              ai: { enabled: false, reason: "Determinístico" },
            },
          });
        } catch {}
        return;
      }
      await route.fulfill({
        json: path.endsWith("/actions")
          ? {
              navigation: "publications",
              url: "https://marioserafim.com.br/blog/teste",
            }
          : { allowed: true },
      });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Jarvis Seu próximo caminho" })
      .click();
    const input = page.getByLabel("Consultar o ecossistema");
    await expect(input).toBeFocused();
    await input.fill("primeira linha");
    await input.press("Shift+Enter");
    await input.press("x");
    await expect(input).toHaveValue("primeira linha\nx");
    expect(queries.length).toBe(0);
    await input.press("Enter");
    await expect(
      page.getByText(
        "A consulta está indisponível. Nenhuma ação foi executada.",
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Tentar novamente", exact: true })
      .click();
    await expect(
      page.getByText("Há duas oportunidades aguardando acompanhamento."),
    ).toBeVisible();
    await expect(
      page.getByText("D1 · oportunidades · Estado atual"),
    ).toBeVisible();
    expect(queries.length).toBe(2);
    await page.screenshot({ path: `.wrangler/jarvis-chat-${width}.png` });
    await page
      .getByRole("button", { name: "Revisar ação", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Abrir destino revisado ↗" }),
    ).toHaveAttribute("href", "https://marioserafim.com.br/blog/teste");
    await page.getByRole("button", { name: "Limpar conversa" }).click();
    await expect(
      page.getByText("Há duas oportunidades aguardando acompanhamento."),
    ).toHaveCount(0);
    await expect(input).toBeFocused();
    hold = true;
    await input.fill("consulta privada pendente");
    await input.press("Enter");
    await expect(page.locator(".jarvis-loading[role=status]")).toContainText(
      "Consultando",
    );
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    release();
    await expect(page.getByLabel("Senha de acesso")).toBeVisible();
    await expect(page.getByText("consulta privada pendente")).toHaveCount(0);
  });

test("Jarvis clears private conversation when the session expires", async ({
  page,
}) => {
  await mockApi(page, 0);
  await page.route("**/api/jarvis/**", async (route) => {
    if (
      route.request().url().endsWith("/conversation") &&
      route.request().method() === "GET"
    )
      return route.fulfill({ json: dialogueView });
    if (route.request().method() === "GET")
      await route.fulfill({
        json: {
          preferences: {
            enabled: true,
            proactive: false,
            communication: "formal",
            area: "for-you",
          },
          notices: [],
          syncedAt: new Date().toISOString(),
          ai: { enabled: false },
        },
      });
    else await route.fulfill({ status: 401, json: { error: "unauthorized" } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  await page
    .getByLabel("Consultar o ecossistema")
    .fill("consulta confidencial da sessão");
  await page.getByLabel("Consultar o ecossistema").press("Enter");
  await expect(page.getByLabel("Senha de acesso")).toBeVisible();
  await expect(page.getByText("consulta confidencial da sessão")).toHaveCount(
    0,
  );
  await expect(page.getByRole("log")).toHaveCount(0);
});
for (const width of [1440, 1280, 390])
  test(`Jarvis social local and stable layout ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, 0);
    let queries = 0;
    await page.route("**/api/jarvis/**", async (route) => {
      if (
        route.request().url().endsWith("/conversation") &&
        route.request().method() !== "POST"
      )
        return route.fulfill({ json: dialogueView });
      if (route.request().url().endsWith("/conversation")) {
        const body = route.request().postDataJSON();
        const social = socialAnswer(body.text, body.revision, "discreto");
        if (social)
          return route.fulfill({
            json: {
              ...social,
              conversation: { ...dialogueView, revision: body.revision + 1 },
            },
          });
        queries++;
        await route.fulfill({
          json: {
            conversation: { ...dialogueView, revision: body.revision + 1 },
            text: "Uma consulta operacional.",
            source: "D1",
            period: {
              label: "Estado atual",
              from: null,
              to: new Date().toISOString(),
              days: null,
            },
            syncedAt: null,
            incomplete: true,
            stale: false,
            ai: { enabled: false, reason: "Teste" },
          },
        });
      } else
        await route.fulfill({
          json: {
            preferences: {
              enabled: true,
              proactive: false,
              communication: "discreto",
              area: "for-you",
            },
            notices: [],
            ai: { enabled: false, reason: "Teste" },
          },
        });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Jarvis Seu próximo caminho", exact: true })
      .click();
    const input = page.getByLabel("Consultar o ecossistema");
    await expect(input).toBeFocused();
    await page.locator(".jarvis-chat").evaluate(async (el) => {
      await Promise.all(
        el.getAnimations().map((a) => a.finished.catch(() => {})),
      );
    });
    const heading = page.locator(".jarvis-chat .jarvis-heading");
    const before = await heading.boundingBox();
    const composer = await input.boundingBox();
    let bodyCount = 0;
    for (const text of [
      "olá Jarvis está por ai?",
      "Quem é você?",
      "Obrigado",
      "Até mais",
      "Oi",
      "Como vai?",
    ]) {
      await input.fill(text);
      await input.press("Enter");
      await expect(
        page.getByRole("button", { name: "Enviar", exact: true }),
      ).toBeDisabled();
      await expect
        .poll(() =>
          page
            .getByRole("article", { name: "Resposta do Jarvis", exact: true })
            .count(),
        )
        .toBeGreaterThan(bodyCount++);
    }
    await expect(
      page.getByRole("article", { name: "Resposta do Jarvis" }),
    ).toHaveCount(6);
    expect(queries).toBe(0);
    await expect(
      page.getByText("Sincronização:", { exact: false }),
    ).toHaveCount(0);
    expect((await heading.boundingBox())!.y).toBeCloseTo(before!.y, 0);
    expect((await input.boundingBox())!.y).toBeCloseTo(composer!.y, 0);
    await input.fill("Bom dia, Jarvis. Tenho clientes pendentes?");
    await input.press("Enter");
    await expect.poll(() => queries).toBe(1);
    await input.fill("x".repeat(500));
    await input.press("Enter");
    await expect.poll(() => queries).toBe(2);
    expect(
      await page.locator(".jarvis-chat").evaluate((el) =>
        [el, ...el.querySelectorAll("*")]
          .filter((e) => e.clientWidth > 0 && !e.classList.contains("sr-only"))
          .filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => ({
            tag: e.tagName,
            class: e.className,
            width: e.clientWidth,
            scroll: e.scrollWidth,
          })),
      ),
    ).toEqual([]);
    await page.getByText("Preferências e contexto", { exact: true }).click();
    expect((await input.boundingBox())!.y).toBeCloseTo(composer!.y, 0);
    const log = page.getByRole("log");
    await log.focus();
    await page.keyboard.press("Home");
    await page.screenshot({ path: `.wrangler/jarvis-21-${width}.png` });
    await input.focus();
    await input.press("Escape");
    await expect(
      page.getByRole("button", {
        name: "Jarvis Seu próximo caminho",
        exact: true,
      }),
    ).toBeFocused();
  });

test("Jarvis Brain: selective memory management, correction, archive and exact deletion confirmation", async ({
  page,
}) => {
  await mockApi(page);
  let memories: any[] = [];
  await page.route("**/api/jarvis/drive", (route) =>
    route.fulfill({
      json: { enabled: false, connected: false, message: "Drive desativado." },
    }),
  );
  await page.route("**/api/jarvis/brain**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const state = new URL(request.url()).searchParams.get("state");
      await route.fulfill({
        json: {
          memories: memories.filter((m) =>
            state ? m.state === state : m.state !== "arquivada",
          ),
        },
      });
    } else {
      const input = request.postDataJSON();
      if (request.method() === "POST")
        memories.push({
          ...input.draft,
          id: input.id,
          state: input.state,
          version: 1,
          createdAt: "2026-11-04T12:00:00Z",
          updatedAt: "2026-11-04T12:00:00Z",
          driveId: null,
          driveVersion: null,
          sync: "local",
        });
      else {
        const id = new URL(request.url()).pathname.split("/").pop();
        const memory = memories.find((m) => m.id === id);
        expect(input.version).toBe(memory.version);
        if (input.operation === "excluir") {
          expect(input.confirmation).toBe(`EXCLUIR ${id}`);
          memories = memories.filter((m) => m.id !== id);
        } else
          Object.assign(memory, input.draft ?? {}, {
            version: memory.version + 1,
            ...(input.operation === "arquivar" ? { state: "arquivada" } : {}),
          });
      }
      await route.fulfill({ json: memories.at(-1) ?? null });
    }
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  const memory = page.locator(".jarvis-memory");
  await memory.locator("summary").click();
  await expect(memory.getByText("Nenhuma memória neste filtro.")).toBeVisible();
  await memory
    .getByRole("button", { name: "Adicionar memória", exact: true })
    .click();
  await memory
    .getByRole("textbox", { name: "Título", exact: true })
    .fill("Direção do portfólio");
  await memory
    .getByRole("textbox", { name: "Resumo", exact: true })
    .fill("Usar identidade minimalista no portfólio.");
  await memory
    .locator(".jarvis-memory-form")
    .getByRole("combobox", { name: "Tipo", exact: true })
    .selectOption("decisao");
  await memory
    .locator(".jarvis-memory-form")
    .getByRole("combobox", { name: "Natureza", exact: true })
    .selectOption("fato");
  await memory
    .locator(".jarvis-memory-form")
    .getByRole("textbox", { name: "Projeto", exact: true })
    .fill("Portfólio");
  await memory
    .getByRole("button", { name: "Salvar memória confirmada", exact: true })
    .click();
  await expect(memory.locator("article")).toContainText(
    "Usar identidade minimalista",
  );
  await memory.getByRole("button", { name: "Corrigir", exact: true }).click();
  await memory
    .getByRole("textbox", { name: "Resumo", exact: true })
    .fill("Identidade minimalista aprovada; revisar na próxima fase.");
  await memory
    .getByRole("button", { name: "Salvar correção", exact: true })
    .click();
  await expect(memory.locator("article")).toContainText("versão 2");
  await page.screenshot({
    path: ".wrangler/jarvis-brain-desktop.png",
  });
  await memory.getByRole("button", { name: "Arquivar", exact: true }).click();
  await expect(memory.locator("article")).toHaveCount(0);
  await memory
    .getByRole("combobox", { name: "Estado", exact: true })
    .selectOption("arquivada");
  await memory
    .getByRole("button", { name: "Buscar / atualizar", exact: true })
    .click();
  await expect(memory.locator("article")).toContainText("arquivada");
  const id = memories[0].id;
  await memory.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(
    memory.getByRole("button", { name: "Confirmar exclusão", exact: true }),
  ).toBeDisabled();
  await memory.locator("form").last().getByRole("textbox").fill("sim");
  await expect(
    memory.getByRole("button", { name: "Confirmar exclusão", exact: true }),
  ).toBeDisabled();
  await memory
    .locator("form")
    .last()
    .getByRole("textbox")
    .fill(`EXCLUIR ${id}`);
  await memory
    .getByRole("button", { name: "Confirmar exclusão", exact: true })
    .click();
  await expect(memory.locator("article")).toHaveCount(0);
});

test("Jarvis Brain: revoked Google access preserves the authenticated Lastro chat", async ({
  page,
}) => {
  await mockApi(page);
  const m = {
    id: "12345678-1234-4234-8234-123456789099",
    type: "preferencia",
    certainty: "preferencia",
    title: "Preferência de teste",
    summary: "Usar humor seco.",
    keywords: [],
    project: null,
    origin: "Proprietário",
    state: "confirmada",
    version: 1,
    createdAt: "2026-11-04T12:00:00Z",
    updatedAt: "2026-11-04T12:00:00Z",
    driveId: "mock-drive-id",
    driveVersion: 1,
    sync: "sincronizada",
  };
  await page.route("**/api/jarvis/drive", (route) =>
    route.fulfill({
      json: { enabled: true, connected: true, message: "Teste de conexão." },
    }),
  );
  await page.route("**/api/jarvis/brain**", (route) =>
    route.request().url().includes("/document")
      ? route.fulfill({
          status: 401,
          json: {
            error: {
              code: "drive_authorization",
              message: "Reconecte o Drive.",
            },
          },
        })
      : route.fulfill({ json: { memories: [m] } }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  const memory = page.locator(".jarvis-memory");
  await memory.locator("summary").click();
  await memory
    .getByRole("button", { name: "Ler documento", exact: true })
    .click();
  await expect(memory.getByRole("alert")).toHaveText("Reconecte o Drive.");
  await expect(
    memory.getByRole("button", {
      name: "Reconectar Google Drive",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Painel Jarvis" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sair", exact: true }),
  ).toBeVisible();
});

test("Radar 2: países, 32 cards, triagem, filtros, detalhes e Oficina", async ({
  page,
}) => {
  await mockApi(page, 40, true, false, false, true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const board = page.getByRole("region", {
    name: "Mesa editorial",
    exact: true,
  });
  await expect(board.getByTestId("radar-card")).toHaveCount(32);
  const first = board.getByTestId("radar-card").first();
  const title = await first.locator("h4").innerText();
  await first
    .getByRole("button", { name: `Avaliar ${title}`, exact: true })
    .click();
  await expect(board.locator('[data-triage="para_avaliar"]')).toHaveCount(1);
  await board
    .locator('[data-triage="para_avaliar"]')
    .getByRole("button", { name: `Favoritar ${title}`, exact: true })
    .click();
  await expect(board.locator('[data-triage="favorito"]')).toHaveCount(1);
  await page.reload();
  await expect(board.locator('[data-triage="favorito"]')).toHaveCount(1);
  await board
    .getByRole("combobox", { name: "País", exact: true })
    .selectOption("GB");
  await board
    .getByRole("combobox", { name: "Idioma", exact: true })
    .selectOption("pt");
  await board.getByLabel("Pesquisa", { exact: true }).fill("inexistente");
  await expect(board.getByTestId("radar-card")).toHaveCount(0);
  await board
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await expect(board.getByTestId("radar-card")).toHaveCount(32);
  const trigger = board
    .getByTestId("radar-card")
    .first()
    .getByRole("button")
    .first();
  const openedTitle = await trigger.innerText();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Selecionar / remover da Oficina" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    board.getByRole("button", { name: openedTitle, exact: true }),
  ).toBeFocused();
  await mkdir(".wrangler/radar-country-mock", { recursive: true });
  await page.screenshot({
    path: ".wrangler/radar-country-mock/desktop-dark.png",
    fullPage: true,
  });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.screenshot({
    path: ".wrangler/radar-country-mock/desktop-light.png",
    fullPage: true,
  });
  await expect(
    board.getByRole("region", { name: "Brasil", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(board).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("Radar 2: falha da API e recuperação", async ({ page }) => {
  await mockApi(page, 24, true, false, false, true);
  let fail = true;
  await page.route("**/api/feed?**", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { error: { message: "Serviço indisponível" } },
        })
      : route.fallback(),
  );
  await page.goto("/");
  const board = page.getByRole("region", {
    name: "Mesa editorial",
    exact: true,
  });
  await expect(board.getByRole("alert")).toBeVisible();
  fail = false;
  await board.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(board.getByTestId("radar-card")).toHaveCount(19);
});

test("Radar 2: expiração em nove dias preserva favorito e descarte é efetivo", async ({
  page,
}) => {
  await page.clock.install({ time: new Date() });
  await mockApi(page, 24, true, false, false, true);
  await page.goto("/");
  const board = page.getByRole("region", {
    name: "Mesa editorial",
    exact: true,
  });
  await expect(board.getByTestId("radar-card")).toHaveCount(19);
  await board
    .getByTestId("radar-card")
    .first()
    .getByRole("button", { name: /^Favoritar / })
    .click();
  await expect(board.locator('[data-triage="favorito"]')).toHaveCount(1);
  await page.clock.fastForward(9 * 86400000 + 60001);
  await expect(board.getByTestId("radar-card")).toHaveCount(1);
  await board
    .getByTestId("radar-card")
    .first()
    .getByRole("button", { name: /^Descartar / })
    .click();
  await expect(board.getByTestId("radar-card")).toHaveCount(0);
  await board
    .getByRole("combobox", { name: "Recorte", exact: true })
    .selectOption("scientific");
  await expect(board.getByTestId("radar-card")).toHaveCount(5);
  await expect(
    board.getByRole("combobox", { name: "Período", exact: true }),
  ).toHaveValue("all");
});
