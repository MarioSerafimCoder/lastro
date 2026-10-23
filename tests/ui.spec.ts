import { test, expect, type Page } from "@playwright/test";
import { contentFixture, fixtureSource } from "./fixtures";

async function selectMenu(page: Page, label: string, choice: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: choice, exact: true }).click();
}

async function mockApi(
  page: Page,
  count = 24,
  initialSession = true,
  withImage = false,
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
    }),
  );
  let authenticated = initialSession;
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
    if (p === "/api/auth/session") result = { authenticated };
    else if (p === "/api/auth/login") {
      authenticated = true;
      result = { authenticated };
    } else if (p === "/api/auth/logout") {
      authenticated = false;
      result = {};
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
  await expect(page.locator(".jarvis-hint")).toBeVisible();
  await page.getByRole("button", { name: "Dispensar sugestão" }).click();
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  await page.getByLabel("Receber sugestões espontâneas").uncheck();
  await page
    .getByRole("button", { name: "Minimizar Jarvis", exact: true })
    .click();
  await expect(page.locator(".jarvis-panel")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  await page
    .getByRole("button", { name: "Desativar Jarvis", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByText("Jarvis desativado", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".jarvis-hint")).toHaveCount(0);
  await page.getByRole("button", { name: "Reativar Jarvis" }).click();
  await page
    .getByRole("button", { name: "Jarvis Seu próximo caminho" })
    .click();
  await expect(
    page.getByLabel("Receber sugestões espontâneas"),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Curadoria", exact: true }).click();
  await expect(
    page.getByText("3 candidatos aguardam revisão editorial."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revisar candidatos", exact: true })
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
    page.getByText("Ainda não há referências por aqui"),
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
    expect(
      overlaps(
        (await page.locator("#main").boundingBox())!,
        (await page.locator(".jarvis-panel").boundingBox())!,
      ),
    ).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".jarvis-panel")).toHaveCount(0);
    await expect(page.locator(".jarvis-toggle")).toBeFocused();
  });

test("Descoberta e cards: tamanho uniforme, ampliação suave e grid/lista", async ({
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
  expect(new Set(dimensions).size).toBe(1);
  const card = page.locator(".content-card").first();
  await card.hover();
  await expect
    .poll(() =>
      card.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a),
    )
    .toBeCloseTo(1.025, 3);
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
