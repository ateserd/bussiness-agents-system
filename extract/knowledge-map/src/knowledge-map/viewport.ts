import type { KnowledgeViewport } from "./types";

/**
 * Zoom/pan transform. World coordinates are what the force simulation produces;
 * screen coordinates are CSS pixels inside the canvas. Device pixel ratio is
 * applied separately at paint time and never enters this math.
 */
export type Transform = { k: number; x: number; y: number };

export const IDENTITY: Transform = { k: 1, x: 0, y: 0 };

export function toWorld(t: Transform, sx: number, sy: number): [number, number] {
  return [(sx - t.x) / t.k, (sy - t.y) / t.k];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Zoom by `factor`, keeping whatever world point sits under (sx, sy) pinned
 * under the cursor. Without the pin, zooming drifts the field away from what
 * the user was pointing at, which is the single thing that makes a canvas map
 * feel broken.
 */
export function zoomAt(
  t: Transform,
  sx: number,
  sy: number,
  factor: number,
  vp: KnowledgeViewport,
): Transform {
  const k = clamp(t.k * factor, vp.min, vp.max);
  if (k === t.k) return t;
  const [wx, wy] = toWorld(t, sx, sy);
  return { k, x: sx - wx * k, y: sy - wy * k };
}

export function pan(t: Transform, dx: number, dy: number): Transform {
  return { k: t.k, x: t.x + dx, y: t.y + dy };
}

/** Wheel delta → multiplicative zoom factor. */
export function wheelFactor(deltaY: number, vp: KnowledgeViewport): number {
  return Math.exp(-deltaY * vp.speed);
}
