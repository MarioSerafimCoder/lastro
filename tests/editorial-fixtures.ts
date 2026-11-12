import type { SourceEvidence } from "../src/editorial-sources";
import { captureEvidence, captureStatement } from "../src/synopsis-evidence";
import { fixtureSource } from "./fixtures";

export function editorialFixtures(at = Date.now() - 3600000) {
  const publishedAt = new Date(at).toISOString();
  const entries = [
    [
      "Tipografia de rua e memória de bairro",
      "As placas pintadas dos comércios de bairro são o objeto do ensaio.",
      "O autor descreve fachadas com letras largas e irregulares, comenta sua relação com a escala das vitrines e chama atenção para o espaço entre caracteres. O percurso de observação passa por esquinas, toldos, calçadas, marquises e pontos de ônibus.",
    ],
    [
      "Tipografia digital e o desenho da leitura",
      "O relato descreve experimentos com famílias tipográficas adaptáveis.",
      "A equipe discute formas que mudam de largura quando a área de leitura diminui. O projeto apresenta variações para telas e compara a disposição de títulos, legendas e chamadas em interfaces. A conversa inclui alinhamento, espaço interno e contraste.",
    ],
    [
      "Tipografia de acervo e seleção de cartazes",
      "O texto apresenta a seleção de cartazes para um acervo comunitário.",
      "A curadoria aproxima peças feitas com carimbos, composições montadas com recortes e impressos produzidos em oficinas locais. A descrição trata dos critérios de seleção, da conservação das folhas e de como identificar peças cuja autoria ficou sem registro.",
    ],
  ];
  return entries.map(
    (
      [title, quote, description],
      index,
    ): SourceEvidence & { quote: string } => ({
      reference: {
        contentId: `20000000-0000-4000-8000-00000000000${index + 1}`,
        sourceId: `30000000-0000-4000-8000-00000000000${index + 1}`,
        title,
        publication: `Publicação ${index + 1}`,
        url: `https://source${index + 1}.example.org/editorial`,
        publishedAt,
        kind: "authorized_feed_description",
      },
      quote,
      text: quote + " " + description,
      materialKey: "fixture",
      topics: ["tipografia"],
      quality: 80,
      authority: 80,
      originality: 70,
      evergreen: false,
    }),
  );
}
export async function seedEditorial(
  db: D1Database,
  sources: ReturnType<typeof editorialFixtures>,
) {
  for (const { reference, text, topics } of sources) {
    const source = {
      ...fixtureSource,
      id: reference.sourceId,
      name: reference.publication,
      url: new URL("/feed", reference.url).href,
      synopsisAllowed: true,
      synopsisPermissionVersion: 1,
      synopsisLicenseUrl:
        "https://creativecommons.org/licenses/by/4.0/" as const,
      synopsisRightsNote:
        "Trecho autorizado para o cenário de teste editorial.",
    };
    const at = reference.publishedAt;
    await db
      .prepare(
        `INSERT INTO sources(id,name,connector,url,status,config_json,created_at)
      VALUES (?,?,'rss',?,'approved',?,?)`,
      )
      .bind(source.id, source.name, source.url, JSON.stringify(source), at)
      .run();
    await db
      .prepare(
        `INSERT INTO contents(id,source_id,canonical_url,title,metadata_json,published_at,collected_at,
      kind,language,editorial_status,quality_score,quality_json) VALUES (?,?,?,?,?,?,?,'article','pt','approved',80,?)`,
      )
      .bind(
        reference.contentId,
        source.id,
        reference.url,
        reference.title,
        JSON.stringify({ topics }),
        at,
        at,
        JSON.stringify({ factors: { originality: 70 } }),
      )
      .run();
    const evidence = captureEvidence(source, reference.url, text, null, at);
    if (!evidence) throw Error("missing_fixture_evidence");
    await captureStatement(db, source, [evidence], at).run();
  }
}

const paragraphs = [
  "Uma letra pode caber perfeitamente no retângulo que lhe deram e ainda assim parecer que caiu ali de paraquedas. O problema, nesse caso, talvez esteja na maneira de medir. A régua alcança o tamanho da palavra, mas deixa escapar a relação entre a palavra e a situação em que ela aparece.",
  "Um ensaio toma como assunto as letreiras pintadas no comércio de bairro [S1]. Imagino a diferença entre escolher um desenho de letra com a mão pousada sobre a mesa e imaginá-lo do outro lado da calçada. Nesse exercício, o espaço vazio em volta da palavra ganha tanta importância quanto o traço. O sinal mais interessante pode ser justamente aquele cuja solução seria considerada um erro num arquivo isolado.",
  "A lógica ganha outra forma no relato sobre o teste de famílias de letras que se adaptam [S2]. Seria tentador reduzir esse esforço à procura de uma forma que ocupe menos espaço. Prefiro pensar em uma escolha entre prioridades de leitura. Um título e uma legenda pedem atenções diferentes, mesmo que a interface os trate como peças alinhadas numa fila bastante disciplinada. Alinhamento pode ajudar. A hierarquia continua sendo uma decisão.",
  "A seleção de cartazes para um acervo organizado pela comunidade fornece um terceiro ponto de observação [S3]. É possível imaginar o dilema de quem precisa registrar o trabalho de origem incerta sem preencher a lacuna com um palpite. Nesse caso, o cuidado gráfico pode aparecer na legenda, e o gesto editorial mais preciso talvez seja admitir que falta um pedaço da história. Uma ficha de acervo também tem decisões de leitura.",
  "As situações convidam a tratar contexto como parte do material do projeto. Tirar uma placa da rua, guardar uma tela como imagem ou isolar o cartaz dentro de uma ficha ajuda a olhar de perto. Também muda aquilo que se consegue perguntar sobre o trabalho. Uma família adaptável vista num quadro estático, por exemplo, vira apenas um desenho agradável ou desagradável. Some justamente a escolha que justificaria examiná-la.",
];
export const editorialDraft = {
  title: "Onde a letra precisa agir",
  summary:
    "Placas, interfaces e acervos abrem uma discussão sobre como o contexto muda o julgamento de uma escolha tipográfica.",
  argument:
    "O contexto em que a letra atua deve fazer parte da avaliação e do registro de um projeto gráfico.",
  markdown: paragraphs.join("\n\n"),
};
export function editorialReport(sources: ReturnType<typeof editorialFixtures>) {
  return {
    portuguese: true,
    coherent: true,
    blocks: [
      editorialDraft.title,
      editorialDraft.summary,
      editorialDraft.argument,
      ...paragraphs,
    ].map((block, index) => {
      const source = Number(/\[S([1-3])\]/.exec(block)?.[1]);
      return {
        index,
        verdict: source ? "supported" : "interpretation",
        quotes: source ? [{ source, text: sources[source - 1].quote }] : [],
      };
    }),
  };
}
