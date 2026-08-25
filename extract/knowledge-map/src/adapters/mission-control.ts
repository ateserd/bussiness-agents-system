import { formatAgo, formatDate } from "../knowledge-map/format";
import type { KnowledgeLink, KnowledgeNode } from "../knowledge-map/types";

/**
 * Mission Control → KnowledgeMap.
 *
 * The generic component knows nothing about branches, departments or memory
 * scopes. This is the one file that does, so dropping the package back into
 * Mission Control is a one-line change at the call site and nothing else.
 *
 * Mirrors `BrainNode` from `src/lib/data.ts` in the Mission Control repo.
 */
export type BrainNode = {
  id: string;
  kind: string;
  content: string;
  scopes: string[];
  branch: string;
  department: string | null;
  confidence: number;
  permanent: boolean;
  useCount: number;
  sourceAgentId: string | null;
  sourceAgentName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  supersedes: string | null;
};

const MEMORY_KIND_TR: Record<string, string> = {
  fact: "gerçek",
  decision: "karar",
  preference: "tercih",
  client_context: "müşteri bağlamı",
  lesson: "ders",
  metric_snapshot: "ölçüm",
};

export function toKnowledgeNode(m: BrainNode, locale = "tr-TR"): KnowledgeNode {
  return {
    id: m.id,
    label: m.content,
    kind: MEMORY_KIND_TR[m.kind] ?? m.kind,
    group: m.branch,
    subgroup: m.department,
    tags: m.scopes,
    weight: m.useCount,
    pinned: m.permanent,
    search: m.sourceAgentName ?? "",
    meta: {
      Kapsam: m.scopes.join(" · "),
      Yazan: m.sourceAgentName ?? "—",
      Güven: m.confidence.toFixed(2),
      Kullanım: `${m.useCount}×`,
      Yazıldı: formatDate(m.createdAt, locale),
      "Son kullanım": formatAgo(m.lastUsedAt, locale),
    },
    note: m.supersedes ? `Şunun yerine geçti: ${m.supersedes.slice(0, 8)}…` : undefined,
  };
}

export function toKnowledgeNodes(rows: BrainNode[], locale = "tr-TR"): KnowledgeNode[] {
  return rows.map((m) => toKnowledgeNode(m, locale));
}

export function toKnowledgeLinks(links: { from: string; to: string; kind: string }[]): KnowledgeLink[] {
  return links.map((l) => ({ from: l.from, to: l.to, kind: l.kind }));
}
