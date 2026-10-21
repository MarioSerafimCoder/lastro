import { test, expect, type Page } from "@playwright/test";
import { contentFixture, fixtureSource } from "./fixtures";

async function mockApi(page: Page, count = 24, initialSession = true) {
  const items = Array.from({ length: count }, (_, i) =>
    contentFixture({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      title: `TESTE ${i + 1} — ${i % 2 ? "Tipografia, percepção e novos contextos" : "Design de informação e cultura visual"}`,
      kind: i % 5 === 0 ? "paper" : "article",
      topics: [i % 2 ? "typography" : "design"],
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

for (const count of [2, 12, 24, 100])
  test(`Radar com ${count} referências, paginação e contexto preservado`, async ({
    page,
  }) => {
    const { calls } = await mockApi(page, count);
    await page.goto("/");
    const cards = page.locator(".content-card");
    await expect(cards).toHaveCount(Math.min(12, count));
    if (count > 12) {
      await page
        .getByRole("button", { name: "Carregar mais referências" })
        .click();
      await expect(cards).toHaveCount(24);
    }
    const feedCalls = calls.filter((c) => c === "GET /api/feed").length;
    await page.getByRole("button", { name: "Salvos", exact: true }).click();
    await page.getByRole("button", { name: "For You", exact: true }).click();
    await expect(cards).toHaveCount(count > 12 ? 24 : count);
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
    .getByLabel(/Adicionar TESTE.*à coleção/)
    .selectOption("TEST-COLLECTION");
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
    await expect(page.locator(".content-card")).toHaveCount(12);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const first = await page.locator(".content-card").first().boundingBox();
    expect(first!.y).toBeLessThan(height);
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: `docs/examples/stage04-${width}.png`,
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
      if (width === 390)
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
