"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { copy, fmt } from "@/lib/copy";
import { addBrainNote, deleteBrainMemory } from "@/lib/actions";
import type { BrainNode } from "@/lib/data";

/**
 * The shared memory as a drifting constellation.
 *
 * Canvas rather than SVG: at a thousand-plus nodes with a live force
 * simulation, per-node DOM is the difference between a calm drift and a
 * stuttering one. Hit-testing is a linear scan over node positions, which at
 * this scale costs nothing and avoids a quadtree that would need rebuilding
 * every tick.
 */

type Sim = BrainNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<Sim> & { kind: string };

const DEPT_COLOR: Record<string, string> = {
  outreach: "#ff4d6d",
  sales: "#4dd6ff",
  delivery: "#3ddc84",
  build: "#3ddc84",
  content: "#a06cff",
  shared: "#ffb84d",
};

const BRANCH_COLOR: Record<string, string> = {
  web: "#4dd6ff",
  automation: "#ffb84d",
  global: "#8ea3bd",
};

function colorOf(node: BrainNode): string {
  if (node.permanent) return "#f5c451";
  if (node.department) return DEPT_COLOR[node.department] ?? BRANCH_COLOR[node.branch] ?? "#8ea3bd";
  return BRANCH_COLOR[node.branch] ?? "#8ea3bd";
}

function radiusOf(node: BrainNode): number {
  // Retrieval count drives size, compressed so a heavily-used memory reads as
  // bigger without a handful of nodes dominating the field.
  return 3 + Math.sqrt(Math.min(node.useCount, 60)) * 1.5;
}

export function Constellation({
  nodes,
  links,
  counts,
}: {
  nodes: BrainNode[];
  links: { from: string; to: string; kind: string }[];
  counts: { memories: number; facts: number; clients: number; links: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<Sim, SimLink> | null>(null);
  const dataRef = useRef<{ nodes: Sim[]; links: SimLink[] }>({ nodes: [], links: [] });
  const hoverRef = useRef<string | null>(null);
  const matchRef = useRef<Set<string> | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<BrainNode | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    if (!q) return null;
    return new Set(
      nodes
        .filter(
          (n) =>
            n.content.toLocaleLowerCase("tr-TR").includes(q) ||
            n.scopes.some((s) => s.toLocaleLowerCase("tr-TR").includes(q)) ||
            (n.sourceAgentName ?? "").toLocaleLowerCase("tr-TR").includes(q) ||
            n.kind.includes(q),
        )
        .map((n) => n.id),
    );
  }, [query, nodes]);

  matchRef.current = matches;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { width, height } = canvas.getBoundingClientRect();
    const { nodes: simNodes, links: simLinks } = dataRef.current;
    const active = matchRef.current;

    ctx.clearRect(0, 0, width, height);

    // links first, so nodes sit on top
    ctx.lineWidth = 0.7;
    for (const link of simLinks) {
      const s = link.source as Sim;
      const t = link.target as Sim;
      if (s.x == null || t.x == null) continue;
      const lit = !active || (active.has(s.id) && active.has(t.id));
      ctx.strokeStyle =
        link.kind === "supersedes"
          ? `rgba(245,196,81,${lit ? 0.65 : 0.05})`
          : `rgba(142,163,189,${lit ? 0.28 : 0.03})`;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y!);
      ctx.lineTo(t.x, t.y!);
      ctx.stroke();
    }

    for (const node of simNodes) {
      if (node.x == null || node.y == null) continue;
      const lit = !active || active.has(node.id);
      const hovered = hoverRef.current === node.id;
      const r = radiusOf(node) * (hovered ? 1.5 : 1);
      const color = colorOf(node);

      ctx.globalAlpha = lit ? 1 : 0.12;

      if (lit && (node.permanent || hovered)) {
        const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 4);
        glow.addColorStop(0, `${color}55`);
        glow.addColorStop(1, `${color}00`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();

      if (hovered) {
        ctx.strokeStyle = "#e9eef6";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const simNodes: Sim[] = nodes.map((n) => ({ ...n }));
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = links
      .filter((l) => byId.has(l.from) && byId.has(l.to))
      .map((l) => ({ source: byId.get(l.from)!, target: byId.get(l.to)!, kind: l.kind }));
    dataRef.current = { nodes: simNodes, links: simLinks };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      return rect;
    };
    const rect = resize();

    // Cluster by (branch, department) rather than branch alone. Branch-only
    // clustering plus a collide force packs every node into a uniform disc,
    // which looks like wallpaper and says nothing; giving each department its
    // own anchor lets the topical structure actually show.
    const DEPTS = ["outreach", "sales", "delivery", "build", "content"];
    const anchor = (d: Sim): [number, number] => {
      const col =
        d.branch === "web" ? rect.width * 0.26 : d.branch === "automation" ? rect.width * 0.74 : rect.width * 0.5;
      const idx = d.department ? DEPTS.indexOf(d.department) : -1;
      // Departments fan vertically; unscoped branch memories sit mid-height.
      const band = idx < 0 ? 0.5 : 0.18 + (idx / (DEPTS.length - 1)) * 0.64;
      return [col, rect.height * band];
    };

    const sim = forceSimulation<Sim, SimLink>(simNodes)
      .force("charge", forceManyBody<Sim>().strength(-96).distanceMax(340))
      .force(
        "link",
        forceLink<Sim, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(62)
          .strength(0.42),
      )
      .force("center", forceCenter(rect.width / 2, rect.height / 2).strength(0.04))
      .force("x", forceX<Sim>((d) => anchor(d)[0]).strength(0.055))
      .force("y", forceY<Sim>((d) => anchor(d)[1]).strength(0.055))
      .force("collide", forceCollide<Sim>((d) => radiusOf(d) + 1.5).strength(0.7))
      .alphaDecay(reduced ? 0.08 : 0.016)
      .velocityDecay(0.36);

    sim.on("tick", draw);
    simRef.current = sim;

    const onResize = () => {
      const r = resize();
      sim.force("center", forceCenter(r.width / 2, r.height / 2));
      sim.alpha(0.3).restart();
    };
    window.addEventListener("resize", onResize);

    const pick = (e: MouseEvent): Sim | null => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      let best: Sim | null = null;
      let bestDist = Infinity;
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const d = (n.x - mx) ** 2 + (n.y - my) ** 2;
        const hit = (radiusOf(n) + 6) ** 2;
        if (d < hit && d < bestDist) {
          best = n;
          bestDist = d;
        }
      }
      return best;
    };

    const onMove = (e: MouseEvent) => {
      const hit = pick(e);
      const id = hit?.id ?? null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        canvas.style.cursor = id ? "pointer" : "default";
        draw();
      }
    };
    const onClick = (e: MouseEvent) => {
      const hit = pick(e);
      if (hit) setSelected(nodes.find((n) => n.id === hit.id) ?? null);
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);

    return () => {
      sim.stop();
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    };
  }, [nodes, links, draw]);

  useEffect(() => {
    draw();
  }, [matches, draw]);

  return (
    <div className="flex flex-col gap-4 px-7 pb-8">
      <div className="flex flex-wrap items-center gap-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={copy.brain.search}
          className="min-w-[240px] flex-1 rounded border px-4 py-2.5 text-[14px]"
          style={{
            borderColor: "var(--line)",
            background: "rgba(11,19,35,.7)",
            color: "var(--ink)",
            maxWidth: 420,
          }}
        />
        {matches && (
          <span className="mc-eyebrow" style={{ fontSize: 10 }}>
            {fmt.number(matches.size)} eşleşme
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-4">
          <Legend color="#f5c451" label={copy.brain.permanent} />
          <Legend color="#4dd6ff" label={copy.branch.webFull} />
          <Legend color="#ffb84d" label={copy.branch.automationFull} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div
          ref={wrapRef}
          className="relative h-[560px] overflow-hidden rounded"
          style={{ border: "1px solid var(--line)", background: "rgba(6,11,22,.45)" }}
        >
          <canvas ref={canvasRef} className="block h-full w-full" />
        </div>

        <MemoryPanel node={selected} onDeleted={() => setSelected(null)} />
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2 pt-1">
        <Counter n={counts.memories} label={copy.brain.memories} />
        <Counter n={counts.facts} label={copy.brain.facts} accent="var(--gold)" />
        <Counter n={counts.clients} label={copy.brain.clients} />
        <Counter n={counts.links} label={copy.brain.links} />
      </div>
    </div>
  );
}

function MemoryPanel({ node, onDeleted }: { node: BrainNode | null; onDeleted: () => void }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  // A freshly picked node starts clean — no leftover confirm-state or draft
  // note from whatever was selected before.
  useEffect(() => {
    setConfirming(false);
    setNoteText("");
    setFlash(null);
  }, [node?.id]);

  if (!node) {
    return (
      <div
        className="grid h-full min-h-[200px] place-items-center rounded p-6 text-center"
        style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
      >
        <p className="m-0 text-[13px]" style={{ color: "var(--dim)" }}>
          {copy.brain.pick}
        </p>
      </div>
    );
  }

  const handleDelete = () => {
    startTransition(async () => {
      const res = await deleteBrainMemory(node.id);
      if (res.ok) onDeleted();
      else setFlash(res.message);
    });
  };

  const handleAddNote = () => {
    startTransition(async () => {
      const res = await addBrainNote(node.scopes, noteText);
      setFlash(res.message);
      if (res.ok) setNoteText("");
    });
  };

  return (
    <div
      className="flex flex-col gap-5 overflow-y-auto rounded p-6"
      style={{
        border: "1px solid var(--line)",
        borderTop: `2px solid ${colorOf(node)}`,
        background: "var(--panel)",
        maxHeight: 560,
      }}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <p className="mc-eyebrow" style={{ color: colorOf(node), fontSize: 9.5 }}>
            {copy.memoryKind[node.kind] ?? node.kind}
            {node.permanent ? ` · ${copy.brain.permanent}` : ""}
          </p>
          {!node.permanent &&
            (!confirming ? (
              <button
                disabled={pending}
                onClick={() => setConfirming(true)}
                className="flex-none rounded border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] disabled:opacity-40"
                style={{ borderColor: "var(--line)", color: "var(--dim)" }}
              >
                {copy.brain.delete}
              </button>
            ) : (
              <div className="flex flex-none items-center gap-1.5">
                <button
                  disabled={pending}
                  onClick={handleDelete}
                  className="rounded border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] disabled:opacity-40"
                  style={{ borderColor: "rgba(255,77,109,.5)", color: "var(--crit)" }}
                >
                  {pending ? copy.common.loading : copy.brain.deleteConfirm}
                </button>
                <button
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                  className="rounded border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] disabled:opacity-40"
                  style={{ borderColor: "var(--line)", color: "var(--dim)" }}
                >
                  {copy.brain.deleteCancel}
                </button>
              </div>
            ))}
        </div>
        <p className="mb-0 mt-2.5 text-[14px] leading-relaxed">{node.content}</p>
      </div>

      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12px]">
        <Field label={copy.brain.scope} value={node.scopes.join(" · ")} />
        <Field label={copy.brain.writtenBy} value={node.sourceAgentName ?? copy.common.none} />
        <Field label={copy.brain.confidence} value={node.confidence.toFixed(2)} />
        <Field label={copy.brain.used} value={`${node.useCount}×`} />
        <Field label={copy.brain.created} value={fmt.date(node.createdAt)} />
        <Field label={copy.brain.lastUsed} value={fmt.ago(node.lastUsedAt)} />
      </dl>

      {node.supersedes && (
        <p
          className="m-0 rounded px-3 py-2 font-mono text-[11px]"
          style={{ border: "1px solid rgba(245,196,81,.3)", color: "var(--gold)" }}
        >
          {copy.brain.supersedes}: {node.supersedes.slice(0, 8)}…
        </p>
      )}

      <div className="flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <p className="mc-eyebrow mb-0" style={{ fontSize: 9.5 }}>
          {copy.brain.addNote}
        </p>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder={copy.brain.notePlaceholder}
          rows={3}
          maxLength={600}
          className="resize-none rounded border px-3 py-2 text-[12.5px] leading-relaxed"
          style={{ borderColor: "var(--line)", background: "rgba(11,19,35,.7)", color: "var(--ink)" }}
        />
        <button
          disabled={pending || !noteText.trim()}
          onClick={handleAddNote}
          className="self-start rounded px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] disabled:opacity-40"
          style={{ background: colorOf(node), color: "var(--void)" }}
        >
          {pending ? copy.common.loading : copy.brain.noteSubmit}
        </button>
        {flash && (
          <p className="m-0 font-mono text-[11px] leading-relaxed" style={{ color: "var(--gold)" }}>
            {flash}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="mc-eyebrow" style={{ fontSize: 9, whiteSpace: "nowrap" }}>
        {label}
      </dt>
      <dd className="m-0 break-words font-mono text-[11px]" style={{ color: "var(--haze)" }}>
        {value}
      </dd>
    </>
  );
}

function Counter({ n, label, accent }: { n: number; label: string; accent?: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <b className="mc-num text-[19px] font-semibold" style={{ color: accent ?? "var(--ink)" }}>
        {fmt.number(n)}
      </b>
      <span className="mc-eyebrow" style={{ fontSize: 9.5 }}>
        {label}
      </span>
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: "var(--haze)" }}>
      <span
        className="inline-block h-[7px] w-[7px] rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {label}
    </span>
  );
}
