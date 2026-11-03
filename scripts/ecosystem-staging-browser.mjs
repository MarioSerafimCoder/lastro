// Isolated staging only. Secrets are supplied through process environment, never arguments.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
const lastro = "https://lastro-ecosystem-staging.marioserafim-da.workers.dev",
  studio = "https://studio-ecosystem-staging.marioserafim-da.workers.dev";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
try {
  const login = await context.request.post(lastro + "/api/auth/login", {
    headers: { Origin: lastro },
    data: { password: process.env.STAGING_LASTRO_PASSWORD },
  });
  expect(login.status()).toBe(200);
  const studioLogin = await context.request.post(
    studio + "/api/auth/sign-in/email",
    {
      headers: { Origin: studio },
      data: {
        email: "marioserafim.da@gmail.com",
        password: process.env.STAGING_STUDIO_PASSWORD,
      },
    },
  );
  expect(studioLogin.status()).toBe(200);
  await page.goto(lastro + "/oficina");
  await page
    .getByLabel("Objetivo da publicação", { exact: false })
    .fill("Homologação remota da Oficina");
  await page.getByRole("button", { name: "Gerar prompt com 1 fonte" }).click();
  await expect(page.getByLabel("Prompt gerado")).toBeVisible();
  await page
    .getByRole("button", { name: "Criar rascunho no Studio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Criar rascunho no Studio", exact: true }),
  ).toBeDisabled();
  const processed = await context.request.post(
    lastro + "/api/integrations/reconcile",
    { headers: { Origin: lastro } },
  );
  expect(processed.status()).toBe(200);
  await page.getByRole("button", { name: "Consultar estado" }).click();
  await expect(
    page.getByRole("link", { name: "Abrir no Studio" }),
  ).toBeVisible();
  const next = context.waitForEvent("page");
  await page.getByRole("link", { name: "Abrir no Studio" }).click();
  const editor = await next;
  await editor.waitForLoadState("domcontentloaded");
  expect(editor.url()).toContain(studio + "/editor/");
  await expect(editor.locator('[contenteditable="true"]').first()).toBeVisible({
    timeout: 30000,
  });
  await editor.close();
  await page.getByRole("button", { name: "Publicações", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Calendário editorial" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Resumo de sete dias" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Abrir no CRM" }),
  ).toHaveAttribute(
    "href",
    /^https:\/\/crm-ecosystem-staging\.pages\.dev\/editor\//,
  );
  await page.screenshot({
    path: ".wrangler/ecosystem-staging-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Jarvis", exact: false })
    .first()
    .click();
  await expect(page.locator(".jarvis-suggestion button")).toBeVisible();
  await page.getByRole("button", { name: "Minimizar Jarvis" }).click();
  await expect(page.locator(".jarvis-panel")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".wrangler/ecosystem-staging-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.route("**/api/integrations/overview", (route) =>
    route.abort("failed"),
  );
  await page.getByRole("button", { name: "Atualizar consulta" }).click();
  await expect(
    page.getByText("Integração indisponível.", { exact: false }),
  ).toBeVisible();
  const result = {
    remote: true,
    oficinaStudio: "passed",
    privateEditorOpened: true,
    publications: true,
    jarvis: true,
    calendar: "America/Fortaleza",
    weekly: true,
    desktop: true,
    mobile390: true,
    apiUnavailableFeedback: true,
  };
  fs.writeFileSync(
    ".wrangler/ecosystem-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
