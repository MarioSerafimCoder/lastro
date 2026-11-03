import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseDiscovery,
  contextualSuggestion,
  presentContent,
} from "../apps/web/src/experience";
import { contentFixture } from "./fixtures";
test("descoberta só usa aprovados elegíveis e evita repetir quando há alternativa", () => {
  const a = contentFixture(),
    b = contentFixture();
  const bad = contentFixture({ editorialStatus: "rejected" });
  assert.equal(chooseDiscovery([a, b, bad], a.id, () => 0)?.id, b.id);
  assert.equal(chooseDiscovery([bad]), undefined);
  assert.equal(
    chooseDiscovery([contentFixture({ retracted: true })]),
    undefined,
  );
});
test("Jarvis usa contagem verificada e apresentação não inventa tradução", () => {
  const c = {
    area: "curadoria" as const,
    selected: 0,
    saved: 0,
    available: 0,
    pending: 3,
  };
  assert.equal(
    contextualSuggestion(c).body,
    "3 candidatos aguardam revisão editorial.",
  );
  assert.notEqual(
    contextualSuggestion({ ...c, pending: null }).action,
    "queue",
  );
  assert.equal(
    contextualSuggestion({ ...c, area: "oficina", selected: 2 }).action,
    "form",
  );
  assert.equal(
    presentContent(contentFixture()).translationStatus,
    "unavailable",
  );
});

test("Jarvis prioritizes editorial attention, distribution, drafts and ready packages", () => {
  const c = {
    area: "for-you" as const,
    selected: 0,
    saved: 0,
    available: 0,
    pending: null,
    packageReady: true,
  };
  const recommendations = {
    integrationAttention: [{ id: "t" }],
    articleWithoutNewsletter: [{ slug: "article" }],
    continueDraft: [
      {
        id: "draft",
        admin_url: "https://studio.marioserafim.com.br/editor/draft",
      },
    ],
    unusedReferences: [{ content_id: "r" }],
  };
  const ecosystem = {
    recommendations,
  } as unknown as import("../packages/contracts/integration").IntegrationOverview;
  assert.equal(
    contextualSuggestion({ ...c, ecosystem }).action,
    "publications",
  );
  recommendations.integrationAttention = [];
  assert.equal(
    contextualSuggestion({ ...c, ecosystem }).label,
    "Ver publicações",
  );
  recommendations.articleWithoutNewsletter = [];
  assert.equal(
    contextualSuggestion({ ...c, ecosystem }).action,
    "open-studio:draft",
  );
  recommendations.continueDraft = [];
  assert.equal(contextualSuggestion({ ...c, ecosystem }).action, "studio");
  assert.equal(
    contextualSuggestion({ ...c, packageReady: false, ecosystem }).action,
    "workshop",
  );
});
