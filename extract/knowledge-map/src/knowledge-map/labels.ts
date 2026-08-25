/**
 * Every user-visible string, in one object. The original hard-wired Turkish
 * copy from a project-wide `copy.ts`; here it is a prop with Turkish defaults,
 * so a second project can pass its own without touching the component.
 */

export type KnowledgeLabels = {
  search: string;
  matches: (n: string) => string;
  empty: string;
  noMatch: string;
  reset: string;
  tags: string;
  weight: string;
  pinned: string;
  hint: string;
};

export const trLabels: KnowledgeLabels = {
  search: "Haritada ara…",
  matches: (n) => `${n} eşleşme`,
  empty: "Bir düğüme tıkla.",
  noMatch: "Eşleşen düğüm yok.",
  reset: "Görünümü sıfırla",
  tags: "Etiketler",
  weight: "Ağırlık",
  pinned: "Kalıcı",
  hint: "Tekerlek ile yakınlaş · sürükleyerek gez",
};

export const enLabels: KnowledgeLabels = {
  search: "Search the map…",
  matches: (n) => `${n} matches`,
  empty: "Pick a node.",
  noMatch: "No nodes match.",
  reset: "Reset view",
  tags: "Tags",
  weight: "Weight",
  pinned: "Pinned",
  hint: "Scroll to zoom · drag to pan",
};
