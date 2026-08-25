"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Simulation } from "d3-force";
import { buildSimulation, colorOf, linkNodes, radiusOf, retargetForces, type SimLink, type SimNode } from "./layout";
import { paint, pickAt } from "./render";
import { IDENTITY, pan, toWorld, wheelFactor, zoomAt, type Transform } from "./viewport";
import { formatNumber } from "./format";
import { trLabels, type KnowledgeLabels } from "./labels";
import {
  defaultLayout,
  defaultTheme,
  defaultViewport,
  type KnowledgeLayout,
  type KnowledgeLink,
  type KnowledgeNode,
  type KnowledgeTheme,
  type KnowledgeViewport,
} from "./types";

export type KnowledgeMapProps = {
  nodes: KnowledgeNode[];
  links?: KnowledgeLink[];
  /** Counter row under the canvas. Omit for none. */
  stats?: { value: number; label: string; accent?: string }[];
  /** Swatch row above the canvas. Omit for none. */
  legend?: { color: string; label: string }[];
  theme?: Partial<KnowledgeTheme>;
  layout?: Partial<KnowledgeLayout>;
  viewport?: Partial<KnowledgeViewport>;
  labels?: Partial<KnowledgeLabels>;
  locale?: string;
  /** Canvas height. Must be definite — a percentage of an auto-height parent collapses to zero. */
  height?: number | string;
  /** Hide the built-in side panel to render your own from `onSelect`. */
  showPanel?: boolean;
  showSearch?: boolean;
  className?: string;
  onSelect?: (node: KnowledgeNode | null) => void;
  /** Replace the panel body while keeping its frame. */
  renderPanel?: (node: KnowledgeNode) => React.ReactNode;
};

/** Distance in screen px a press may travel and still count as a click, not a drag. */
const CLICK_SLOP = 4;

export function KnowledgeMap({
  nodes,
  links = [],
  stats,
  legend,
  theme: themeProp,
  layout: layoutProp,
  viewport: viewportProp,
  labels: labelsProp,
  locale = "tr-TR",
  height = 560,
  showPanel = true,
  showSearch = true,
  className,
  onSelect,
  renderPanel,
}: KnowledgeMapProps) {
  const theme = useMemo<KnowledgeTheme>(() => ({ ...defaultTheme, ...themeProp }), [themeProp]);
  const layout = useMemo<KnowledgeLayout>(() => ({ ...defaultLayout, ...layoutProp }), [layoutProp]);
  const vp = useMemo<KnowledgeViewport>(() => ({ ...defaultViewport, ...viewportProp }), [viewportProp]);
  const labels = useMemo<KnowledgeLabels>(() => ({ ...trLabels, ...labelsProp }), [labelsProp]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const dataRef = useRef<{ nodes: SimNode[]; links: SimLink[] }>({ nodes: [], links: [] });
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const transformRef = useRef<Transform>(IDENTITY);
  const hoverRef = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const matchRef = useRef<Set<string> | null>(null);

  // Live config for the paint loop, which runs outside React's render cycle.
  const themeRef = useRef(theme);
  const layoutRef = useRef(layout);
  themeRef.current = theme;
  layoutRef.current = layout;

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    if (!q) return null;
    return new Set(
      nodes
        .filter(
          (n) =>
            n.label.toLocaleLowerCase(locale).includes(q) ||
            (n.kind ?? "").toLocaleLowerCase(locale).includes(q) ||
            (n.group ?? "").toLocaleLowerCase(locale).includes(q) ||
            (n.subgroup ?? "").toLocaleLowerCase(locale).includes(q) ||
            (n.search ?? "").toLocaleLowerCase(locale).includes(q) ||
            (n.tags ?? []).some((t) => t.toLocaleLowerCase(locale).includes(q)),
        )
        .map((n) => n.id),
    );
  }, [query, nodes, locale]);

  matchRef.current = matches;
  selectedRef.current = selected?.id ?? null;

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    paint({
      ctx,
      width: sizeRef.current.width,
      height: sizeRef.current.height,
      dpr: sizeRef.current.dpr,
      transform: transformRef.current,
      nodes: dataRef.current.nodes,
      links: dataRef.current.links,
      theme: themeRef.current,
      layout: layoutRef.current,
      active: matchRef.current,
      hovered: hoverRef.current,
      selected: selectedRef.current,
    });
  }, []);

  const resetView = useCallback(() => {
    transformRef.current = IDENTITY;
    setZoomed(false);
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    dataRef.current = linkNodes(nodes, links);
    const { nodes: simNodes } = dataRef.current;

    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      sizeRef.current = { width: rect.width, height: rect.height, dpr };
      return rect;
    };
    const rect = measure();

    const sim = buildSimulation(simNodes, dataRef.current.links, layout, rect.width, rect.height, reduced);
    sim.on("tick", draw);
    simRef.current = sim;

    // ResizeObserver rather than a window listener: the canvas can be resized
    // by a sidebar toggle or a flex reflow that never fires a window resize.
    let lastW = rect.width;
    let lastH = rect.height;
    const ro = new ResizeObserver(() => {
      const r = measure();
      if (r.width === lastW && r.height === lastH) {
        draw(); // dpr-only change, or the observer's initial call
        return;
      }
      lastW = r.width;
      lastH = r.height;
      retargetForces(sim, layoutRef.current, r.width, r.height);
      sim.alpha(0.3).restart();
      draw();
    });
    ro.observe(wrap);

    /* --- interaction ------------------------------------------------------ */

    type Press = {
      pointerId: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      node: SimNode | null;
      moved: boolean;
    };
    let press: Press | null = null;

    const localPoint = (e: PointerEvent | WheelEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    const pickScreen = (sx: number, sy: number): SimNode | null => {
      const [wx, wy] = toWorld(transformRef.current, sx, sy);
      return pickAt(dataRef.current.nodes, layoutRef.current, wx, wy, transformRef.current.k);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const [sx, sy] = localPoint(e);
      const node = pickScreen(sx, sy);
      press = { pointerId: e.pointerId, startX: sx, startY: sy, lastX: sx, lastY: sy, node, moved: false };
      canvas.setPointerCapture(e.pointerId);
      if (node) {
        sim.alphaTarget(0.3).restart();
        const [wx, wy] = toWorld(transformRef.current, sx, sy);
        node.fx = wx;
        node.fy = wy;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const [sx, sy] = localPoint(e);

      if (!press) {
        const hit = pickScreen(sx, sy);
        const id = hit?.id ?? null;
        if (id !== hoverRef.current) {
          hoverRef.current = id;
          canvas.style.cursor = id ? "pointer" : vp.enabled ? "grab" : "default";
          draw();
        }
        return;
      }

      const dx = sx - press.lastX;
      const dy = sy - press.lastY;
      press.lastX = sx;
      press.lastY = sy;
      if (Math.hypot(sx - press.startX, sy - press.startY) > CLICK_SLOP) press.moved = true;

      if (press.node) {
        const [wx, wy] = toWorld(transformRef.current, sx, sy);
        press.node.fx = wx;
        press.node.fy = wy;
        draw();
      } else if (vp.enabled) {
        canvas.style.cursor = "grabbing";
        transformRef.current = pan(transformRef.current, dx, dy);
        setZoomed(true);
        draw();
      }
    };

    const endPress = (e: PointerEvent) => {
      if (!press || press.pointerId !== e.pointerId) return;
      const finished = press;
      press = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

      if (finished.node) {
        sim.alphaTarget(0);
        // Release the pin so the node settles back into the field. Delete these
        // two lines to make dragging permanently place a node instead.
        finished.node.fx = null;
        finished.node.fy = null;
      }
      canvas.style.cursor = hoverRef.current ? "pointer" : vp.enabled ? "grab" : "default";

      if (!finished.moved) {
        const source = finished.node ? nodes.find((n) => n.id === finished.node!.id) ?? null : null;
        setSelected(source);
        onSelect?.(source);
      }
      draw();
    };

    const onWheel = (e: WheelEvent) => {
      if (!vp.enabled) return;
      e.preventDefault();
      const [sx, sy] = localPoint(e);
      transformRef.current = zoomAt(transformRef.current, sx, sy, wheelFactor(e.deltaY, vp), vp);
      setZoomed(transformRef.current.k !== 1 || transformRef.current.x !== 0 || transformRef.current.y !== 0);
      draw();
    };

    const onLeave = () => {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        draw();
      }
    };

    canvas.style.cursor = vp.enabled ? "grab" : "default";
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endPress);
    canvas.addEventListener("pointercancel", endPress);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      sim.stop();
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPress);
      canvas.removeEventListener("pointercancel", endPress);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [nodes, links, layout, vp, draw, onSelect]);

  // Search and selection change what is lit, but not where anything sits.
  useEffect(() => {
    draw();
  }, [matches, selected, theme, draw]);

  return (
    <div className={className ? `km-root ${className}` : "km-root"}>
      {(showSearch || legend) && (
        <div className="km-bar">
          {showSearch && (
            <input
              className="km-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={labels.search}
              aria-label={labels.search}
            />
          )}
          {matches && <span className="km-eyebrow">{labels.matches(formatNumber(matches.size, locale))}</span>}
          {zoomed && vp.enabled && (
            <button type="button" className="km-reset" onClick={resetView}>
              {labels.reset}
            </button>
          )}
          {legend && (
            <div className="km-legend">
              {legend.map((item) => (
                <span key={item.label} className="km-legend-item">
                  <span className="km-swatch" style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }} />
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={showPanel ? "km-body km-body--panel" : "km-body"}>
        <div ref={wrapRef} className="km-canvas-wrap" style={{ height }}>
          <canvas ref={canvasRef} className="km-canvas" />
          {vp.enabled && <span className="km-hint">{labels.hint}</span>}
        </div>

        {showPanel && (
          <Panel
            node={selected}
            theme={theme}
            layout={layout}
            labels={labels}
            locale={locale}
            height={height}
            render={renderPanel}
          />
        )}
      </div>

      {stats && stats.length > 0 && (
        <div className="km-stats">
          {stats.map((s) => (
            <span key={s.label} className="km-stat">
              <b className="km-stat-value" style={s.accent ? { color: s.accent } : undefined}>
                {formatNumber(s.value, locale)}
              </b>
              <span className="km-eyebrow">{s.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Panel({
  node,
  theme,
  layout,
  labels,
  locale,
  height,
  render,
}: {
  node: KnowledgeNode | null;
  theme: KnowledgeTheme;
  layout: KnowledgeLayout;
  labels: KnowledgeLabels;
  locale: string;
  height: number | string;
  render?: (node: KnowledgeNode) => React.ReactNode;
}) {
  if (!node) {
    return (
      <div className="km-panel km-panel--empty">
        <p className="km-muted">{labels.empty}</p>
      </div>
    );
  }

  const accent = colorOf(node, theme);
  const metaRows = Object.entries(node.meta ?? {}).filter(([, v]) => v != null && v !== "");

  return (
    <div className="km-panel" style={{ borderTop: `2px solid ${accent}`, maxHeight: height }}>
      {render ? (
        render(node)
      ) : (
        <>
          <div>
            <p className="km-eyebrow" style={{ color: accent }}>
              {node.kind ?? node.subgroup ?? node.group ?? ""}
              {node.pinned ? ` · ${labels.pinned}` : ""}
            </p>
            <p className="km-label">{node.label}</p>
          </div>

          <dl className="km-fields">
            {node.tags && node.tags.length > 0 && <Field label={labels.tags} value={node.tags.join(" · ")} />}
            {node.weight != null && (
              <Field label={labels.weight} value={`${formatNumber(node.weight, locale)} · r${radiusOf(node, layout).toFixed(1)}`} />
            )}
            {metaRows.map(([k, v]) => (
              <Field key={k} label={k} value={String(v)} />
            ))}
          </dl>

          {node.note && <p className="km-note">{node.note}</p>}
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="km-eyebrow km-field-label">{label}</dt>
      <dd className="km-field-value">{value}</dd>
    </>
  );
}
