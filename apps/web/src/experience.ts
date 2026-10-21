import type { Content } from "../../../packages/contracts";

export type Area =
  "for-you" | "salvos" | "oficina" | "publicacoes" | "curadoria";
export type Suggestion = {
  title: string;
  body: string;
  action: string;
  label: string;
};
export type JarvisContext = {
  area: Area;
  selected: number;
  available: number;
  saved: number;
  pending: number | null;
};
// Future intelligence providers can return this same Suggestion type.
export function contextualSuggestion(c: JarvisContext): Suggestion {
  if (c.area === "curadoria" && c.pending !== null && c.pending > 0)
    return {
      title: "Um olhar faz diferença.",
      body: `${c.pending} candidatos aguardam revisão editorial.`,
      action: "queue",
      label: "Revisar candidatos",
    };
  if (c.area === "oficina")
    return c.selected
      ? {
          title: "Dê uma direção ao repertório.",
          body: `${c.selected} referências selecionadas. Escolha um formato e defina o objetivo.`,
          action: "form",
          label: "Definir a proposta",
        }
      : {
          title: "Toda ideia tem um ponto de partida.",
          body: "Selecione referências no Radar para preparar seu próximo conteúdo.",
          action: "radar",
          label: "Explorar o Radar",
        };
  if (c.selected >= 2)
    return {
      title: "O que acontece entre essas ideias?",
      body: `${c.selected} referências já podem compor uma proposta. Você define a conexão na Oficina.`,
      action: "workshop",
      label: "Combinar na Oficina",
    };
  if (c.area === "salvos" && c.saved > 0)
    return {
      title: "Dê um lugar às suas ideias.",
      body: "Uma coleção pode reunir as referências de um projeto ou assunto.",
      action: "collection",
      label: "Criar uma coleção",
    };
  if (c.area === "for-you" && c.available > 0)
    return {
      title: "Um desvio pode abrir um caminho.",
      body: "Explore outra referência aprovada entre as que você já carregou.",
      action: "surprise",
      label: "Surpreenda-me",
    };
  return {
    title: "Repertório se constrói com critério.",
    body: "As referências aparecem depois da coleta e da aprovação editorial. Você pode acompanhar esse processo na Curadoria.",
    action: "curation",
    label: "Ver Curadoria",
  };
}
export function discoveryPool(items: Content[]) {
  return items.filter(
    (c) =>
      c.editorialStatus === "approved" && !c.retracted && !c.state.dismissed,
  );
}
export function chooseDiscovery(
  items: Content[],
  previous?: string,
  random = Math.random,
): Content | undefined {
  const eligible = discoveryPool(items);
  const alternatives = eligible.filter((c) => c.id !== previous);
  const pool = alternatives.length ? alternatives : eligible;
  return pool[Math.floor(random() * pool.length)];
}
export type EditorialPresentation = {
  originalTitle: string;
  translatedTitle?: string;
  sourceLanguage: string | null;
  translationStatus: "unavailable" | "available";
  interpretation?: string;
  limitations: string[];
};
export function presentContent(c: Content): EditorialPresentation {
  return {
    originalTitle: c.title,
    sourceLanguage: c.language,
    translationStatus: "unavailable",
    limitations: c.quality.limitations,
  };
}
