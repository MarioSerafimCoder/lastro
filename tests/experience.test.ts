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
