"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { copy } from "@/lib/copy";
import type { AgentNode } from "@/lib/data";
import { cableFor, layout, NODE, nodeSize } from "./layout";
import { nodeTypes, type TreeNodeData } from "./nodes";
import { edgeTypes } from "./cable";
import { NodeDrawer } from "./drawer";

/**
 * The org tree.
 *
 * xyflow supplies only the viewport — pan, scroll-zoom, fitView. Positions come
 * from layout.ts, node chrome from nodes.tsx, cables from cable.tsx. Keeping
 * xyflow at arm's length is what lets the deck look like a deck rather than a
 * flow-chart editor.
 */

export type BranchFilter = "all" | "web" | "automation";

const TINT: Record<string, string> = {
  web: "#4dd6ff",
  automation: "#ffb84d",
  shared: "#f5c451",
};

function Tree({
  crew,
  ownerName,
  ticker,
  filter,
}: {
  crew: AgentNode[];
  ownerName: string;
  ticker: string[];
  filter: BranchFilter;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  const placed = useMemo(
    () =>
      layout(
        crew.map((a) => ({
          id: a.id,
          branch: a.branch,
          department: a.department,
          tier: a.tier,
          reportsTo: a.reportsTo,
        })),
      ),
    [crew],
  );

  const isDimmed = useCallback(
    (branch: string) => {
      if (filter === "all") return false;
      // Shared services serve both branches, so they stay lit in either view.
      if (branch === "shared") return false;
      return branch !== filter;
    },
    [filter],
  );

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = [];

    const owner = placed.get("__owner");
    if (owner) {
      out.push({
        id: "__owner",
        type: "owner",
        position: { x: owner.x - NODE.owner.w / 2, y: owner.y },
        data: { label: ownerName },
        draggable: false,
        selectable: false,
      });
    }

    for (const agent of crew) {
      const spot = placed.get(agent.id);
      if (!spot) continue;
      // Shared services render as their own compact card type, beside the COS.
      const isShared = agent.branch === "shared" && agent.tier !== "cos";
      const nodeType = isShared ? "shared" : agent.tier;
      const size = nodeSize(isShared ? "shared" : agent.tier);

      const data: TreeNodeData = {
        label: agent.displayName,
        role:
          agent.tier === "cos"
            ? "Her iki şube"
            : agent.tier === "director"
              ? agent.branch === "web"
                ? copy.branch.webFull
                : copy.branch.automationFull
              : agent.branch === "shared"
                ? copy.branch.sharedFull
                : (copy.department[agent.department as keyof typeof copy.department] ?? agent.department),
        accent: agent.accent,
        status: agent.status,
        paused: agent.paused,
        dimmed: isDimmed(agent.branch),
        selected: selectedId === agent.id,
        ticker: agent.tier === "cos" ? ticker : undefined,
        blocker: agent.blocker,
      };

      out.push({
        id: agent.id,
        type: nodeType,
        position: { x: spot.x - size.w / 2, y: spot.y },
        data: data as unknown as Record<string, unknown>,
        draggable: false,
        selectable: false,
      });
    }
    return out;
  }, [crew, placed, ownerName, ticker, isDimmed, selectedId]);

  const edges: Edge[] = useMemo(() => {
    const out: Edge[] = [];
    for (const agent of crew) {
      const link = cableFor({
        id: agent.id,
        branch: agent.branch,
        department: agent.department,
        tier: agent.tier,
        reportsTo: agent.reportsTo,
      });
      if (!link) continue;
      if (!placed.has(link.from) || !placed.has(link.to)) continue;

      out.push({
        id: `${link.from}->${link.to}`,
        source: link.from,
        target: link.to,
        type: "cable",
        data: {
          accent: agent.accent,
          tint: TINT[agent.branch] ?? "#4dd6ff",
          working: agent.status === "working" && !agent.paused,
          dimmed: isDimmed(agent.branch),
          strength: agent.tier === "cos" ? 1.6 : agent.tier === "director" ? 1.3 : 1,
        },
      });
    }
    return out;
  }, [crew, placed, isDimmed]);

  // F fits, 1 and 2 jump to a branch (§4.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" || e.key === "F") fitView({ duration: 500, padding: 0.12 });
      if (e.key === "1" || e.key === "2") {
        const branch = e.key === "1" ? "web" : "automation";
        const ids = crew.filter((a) => a.branch === branch).map((a) => a.id);
        fitView({ duration: 600, padding: 0.18, nodes: ids.map((id) => ({ id })) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fitView, crew]);

  // Re-fit when the branch filter changes.
  useEffect(() => {
    const ids =
      filter === "all"
        ? undefined
        : crew.filter((a) => a.branch === filter || a.branch === "shared").map((a) => ({ id: a.id }));
    const t = setTimeout(() => fitView({ duration: 550, padding: 0.14, nodes: ids }), 40);
    return () => clearTimeout(t);
  }, [filter, fitView, crew]);

  const selected = crew.find((a) => a.id === selectedId) ?? null;

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => setSelectedId(node.id === "__owner" ? null : node.id)}
        onPaneClick={() => setSelectedId(null)}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.2}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent", width: "100%", height: "100%" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={38}
          size={1}
          color="rgba(142,163,189,.07)"
        />
      </ReactFlow>

      <NodeDrawer agent={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}

export function OrgTree(props: {
  crew: AgentNode[];
  ownerName: string;
  ticker: string[];
  filter: BranchFilter;
}) {
  return (
    <ReactFlowProvider>
      <Tree {...props} />
    </ReactFlowProvider>
  );
}
