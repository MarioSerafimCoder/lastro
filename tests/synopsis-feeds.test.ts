import test from "node:test";
import assert from "node:assert/strict";
import { parseRss } from "../src/connectors";
import { normalizeCandidate } from "../src/normalize";
import { sufficientEvidence } from "../src/synopses";
import { fixtureSource, rss, atom } from "./fixtures";

const licence = "https://creativecommons.org/licenses/by-sa/4.0/" as const;
const licensed = {
  ...fixtureSource,
  summaryAllowed: false,
  synopsisAllowed: true,
  synopsisRightsNote: "Fixture própria sob CC BY-SA 4.0, adaptação autorizada.",
  synopsisLicenseUrl: licence,
};
const text =
  "O ensaio discute escolhas de design em serviços públicos digitais e a construção de protótipos para explorar ideias. Apresenta exemplos de colaboração entre profissionais e maneiras de formular perguntas durante o projeto. O foco está nas decisões de interface, no aprendizado com usuários e nos limites de cada abordagem, sem afirmar resultados experimentais.";
const xml = rss.replace(
  "Não armazenar texto integral",
  `<![CDATA[<p>${text}</p><p>Fragmento incompleto` + "]]>",
);

test("trecho de feed licenciado é usado só na coleta de evidência, sem alterar a ingestão", () => {
  assert.equal(parseRss(xml, licensed)[0].description, null);
  const c = parseRss(xml, licensed, true)[0];
  assert.equal(c.description, text);
  assert.ok(sufficientEvidence(c.description!, c.title));
  assert.equal(
    parseRss(xml, { ...licensed, synopsisAllowed: false }, true)[0].description,
    null,
  );
  assert.equal(
    parseRss(xml, { ...licensed, synopsisLicenseUrl: undefined }, true)[0]
      .description,
    "Resumo de design para teste.",
  );
});

test("restrição específica no item prevalece sobre a licença geral da fonte", () => {
  const restricted = xml.replace(
    "</item>",
    "<dc:rights>All rights reserved. No adaptations.</dc:rights></item>",
  );
  assert.equal(parseRss(restricted, licensed, true)[0].description, null);
  const permitted = xml.replace(
    "</item>",
    `<dc:rights>${licence}</dc:rights></item>`,
  );
  assert.equal(parseRss(permitted, licensed, true)[0].description, text);
});

test("Atom tipado mantém título, autoria, data, idioma e usa content só quando autorizado", () => {
  const typed = atom
    .replace(
      "<title>Design test</title>",
      '<title type="html">Design test</title>',
    )
    .replace(
      "</entry>",
      `<content type="html"><![CDATA[<p>${text}</p>]]></content></entry>`,
    );
  const item = normalizeCandidate(parseRss(typed, licensed, true)[0]);
  assert.equal(item.title, "Design test");
  assert.equal(item.language, "en");
  assert.equal(item.authors[0].name, "Test Author");
  assert.equal(item.publishedAt, "2026-10-19T00:00:00.000Z");
  assert.equal(item.description, text.slice(0, text.indexOf(" O foco")));
  assert.equal(parseRss(typed, licensed)[0].description, null);
});

test("post curto em uma única frase não é arquivado integralmente como evidência", () => {
  const oneSentence = text.replaceAll(".", "") + ".";
  const short = rss
    .replace("Não armazenar texto integral", `<![CDATA[${oneSentence}]]>`)
    .replace("<p>Resumo de design para teste.</p>", oneSentence);
  assert.equal(parseRss(short, licensed, true)[0].description, null);
});
