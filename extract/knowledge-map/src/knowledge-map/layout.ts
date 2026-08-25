import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { KnowledgeLayout, KnowledgeLink, KnowledgeNode, KnowledgeTheme } from "./types";

export type SimNode = KnowledgeNode & SimulationNodeDatum;
export type SimLink = SimulationLinkDatum<SimNode> & { kind?: string };

export function radiusOf(node: KnowledgeNode, layout: KnowledgeLayout): number {
  // Weight drives size, square-root compressed so a heavily-used node reads as
  // bigger without a handful of nodes dominating the field.
  const w = Math.max(0, Math.min(node.weight ?? 0, layout.radius.cap));
  return layout.radius.base + Math.sqrt(w) * layout.radius.scale;
}

export function colorOf(node: KnowledgeNode, theme: KnowledgeTheme): string {
  if (node.pinned) return theme.pinned;
  if (node.subgroup && theme.subgroups[node.subgroup]) return theme.subgroups[node.subgroup];
  if (node.group && theme.groups[node.group]) return theme.groups[node.group];
  return theme.fallback;
}

export function linkColorOf(kind: string | undefined, theme: KnowledgeTheme): string {
  return (kind && theme.linkKinds[kind]) || theme.linkKinds.default || theme.fallback;
}

/**
 * Where a node wants to sit before the other forces argue with it.
 *
 * Clustering on the primary group alone, plus a collide force, packs every node
 * into one uniform disc — wallpaper that carries no information. Giving each
 * subgroup its own vertical band is what lets the topical structure show.
 */
export function anchorOf(
  node: KnowledgeNode,
  layout: KnowledgeLayout,
  width: number,
  height: number,
): [number, number] {
  const gi = node.group ? layout.groupOrder.indexOf(node.group) : -1;
  const gspan = Math.max(layout.groupOrder.length - 1, 1);
  const gx = gi < 0 ? 0.5 : layout.column.start + (gi / gspan) * (layout.column.end - layout.column.start);

  const si = node.subgroup ? layout.subgroupOrder.indexOf(node.subgroup) : -1;
  const sspan = Math.max(layout.subgroupOrder.length - 1, 1);
  const sy = si < 0 ? 0.5 : layout.band.start + (si / sspan) * (layout.band.end - layout.band.start);

  return [width * gx, height * sy];
}

/**
 * (Re)point the size-dependent forces at a new canvas box. Split out so a
 * resize retargets the running simulation instead of rebuilding it — a rebuild
 * would drop every node's velocity and re-fling the whole field.
 */
export function retargetForces(
  sim: Simulation<SimNode, SimLink>,
  layout: KnowledgeLayout,
  width: number,
  height: number,
): void {
  sim.force("center", forceCenter<SimNode>(width / 2, height / 2).strength(layout.centerStrength));
  sim.force("x", forceX<SimNode>((d) => anchorOf(d, layout, width, height)[0]).strength(layout.clusterStrength));
  sim.force("y", forceY<SimNode>((d) => anchorOf(d, layout, width, height)[1]).strength(layout.clusterStrength));
}

export function buildSimulation(
  simNodes: SimNode[],
  simLinks: SimLink[],
  layout: KnowledgeLayout,
  width: number,
  height: number,
  reducedMotion: boolean,
): Simulation<SimNode, SimLink> {
  const sim = forceSimulation<SimNode, SimLink>(simNodes)
    .force("charge", forceManyBody<SimNode>().strength(layout.charge).distanceMax(layout.chargeDistanceMax))
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(layout.linkDistance)
        .strength(layout.linkStrength),
    )
    .force(
      "collide",
      forceCollide<SimNode>((d) => radiusOf(d, layout) + layout.collidePadding).strength(layout.collideStrength),
    )
    // A reduced-motion viewer gets the settled layout, not the drift toward it.
    .alphaDecay(reducedMotion ? 0.08 : layout.alphaDecay)
    .velocityDecay(layout.velocityDecay);

  retargetForces(sim, layout, width, height);
  return sim;
}

export function linkNodes(nodes: KnowledgeNode[], links: KnowledgeLink[]): { nodes: SimNode[]; links: SimLink[] } {
  const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  const simLinks: SimLink[] = links
    .filter((l) => byId.has(l.from) && byId.has(l.to))
    .map((l) => ({ source: byId.get(l.from)!, target: byId.get(l.to)!, kind: l.kind }));
  return { nodes: simNodes, links: simLinks };
}
