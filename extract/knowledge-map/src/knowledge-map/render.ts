import { colorOf, linkColorOf, radiusOf, type SimLink, type SimNode } from "./layout";
import type { KnowledgeLayout, KnowledgeTheme } from "./types";
import type { Transform } from "./viewport";

/**
 * Canvas rather than SVG: at a thousand-plus nodes with a live force
 * simulation, per-node DOM is the difference between a calm drift and a
 * stuttering one.
 */

export type Frame = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  transform: Transform;
  nodes: SimNode[];
  links: SimLink[];
  theme: KnowledgeTheme;
  layout: KnowledgeLayout;
  /** null = nothing is filtered, everything lit. */
  active: Set<string> | null;
  hovered: string | null;
  selected: string | null;
};

/** `#rrggbb` + 0..1 → `#rrggbbaa`. Non-hex colours are returned untouched. */
function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${color}${a}`;
}

export function paint(frame: Frame): void {
  const { ctx, width, height, dpr, transform: t, nodes, links, theme, layout, active, hovered, selected } = frame;

  // Clear in device space, then paint in world space. Line widths are divided
  // by k so strokes keep their on-screen weight at any zoom.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

  // Links first, so nodes sit on top of them.
  ctx.lineWidth = 0.7 / t.k;
  for (const link of links) {
    const s = link.source as SimNode;
    const target = link.target as SimNode;
    if (s.x == null || s.y == null || target.x == null || target.y == null) continue;
    const lit = !active || (active.has(s.id) && active.has(target.id));
    const base = linkColorOf(link.kind, theme);
    const strong = link.kind && link.kind !== "default" && theme.linkKinds[link.kind];
    ctx.strokeStyle = withAlpha(base, lit ? (strong ? 0.65 : 0.28) : strong ? 0.05 : 0.03);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
  }

  for (const node of nodes) {
    if (node.x == null || node.y == null) continue;
    const lit = !active || active.has(node.id);
    const isHovered = hovered === node.id;
    const isSelected = selected === node.id;
    const r = radiusOf(node, layout) * (isHovered || isSelected ? 1.5 : 1);
    const color = colorOf(node, theme);

    ctx.globalAlpha = lit ? 1 : 0.12;

    if (lit && (node.pinned || isHovered || isSelected)) {
      const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 4);
      glow.addColorStop(0, withAlpha(color, 0.33));
      glow.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (isHovered || isSelected) {
      ctx.strokeStyle = isSelected ? "#ffffff" : "#e9eef6";
      ctx.lineWidth = (isSelected ? 1.6 : 1.2) / t.k;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Hit-testing is a linear scan over node positions. At this scale it costs
 * nothing and avoids a quadtree that would need rebuilding every tick.
 * `slack` widens the target in screen pixels, so small nodes stay clickable
 * when zoomed out.
 */
export function pickAt(
  nodes: SimNode[],
  layout: KnowledgeLayout,
  wx: number,
  wy: number,
  k: number,
  slack = 6,
): SimNode | null {
  let best: SimNode | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (n.x == null || n.y == null) continue;
    const d = (n.x - wx) ** 2 + (n.y - wy) ** 2;
    const hit = (radiusOf(n, layout) + slack / k) ** 2;
    if (d < hit && d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}
