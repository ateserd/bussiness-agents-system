import type { Branch, Tier } from "@/db/schema";

/**
 * Deterministic positions for the org tree.
 *
 * Not dagre: the composition the deck needs — one apex, a command row, two
 * branches fanning symmetrically, workers hanging under their lead — is a fixed
 * shape, and a generic layout engine fights it. Positions come from tier /
 * branch / department, so the picture is identical every render and the eye
 * learns where things live.
 *
 * Shared services flank the Chief of Staff rather than sitting below the
 * branches. They report to the COS and serve both branches, so that is where
 * they belong — and it keeps their cables short instead of sweeping them across
 * the whole chart, which also buys back ~400px of height for everything else.
 */

export type LayoutInput = {
  id: string;
  branch: Branch;
  department: string;
  tier: Tier;
  reportsTo: string | null;
};

export type Placed = { id: string; x: number; y: number };

export const NODE = {
  owner: { w: 200, h: 116 },
  cos: { w: 520, h: 92 },
  director: { w: 290, h: 88 },
  lead: { w: 214, h: 84 },
  worker: { w: 172, h: 40 },
  shared: { w: 190, h: 62 },
} as const;

const ROW = {
  owner: 0,
  cos: 178,
  director: 332,
  lead: 498,
  worker: 622,
} as const;

/** Column order inside a branch. Delivery and Build occupy the same slot. */
const DEPT_ORDER = ["outreach", "sales", "delivery", "content"];

function deptIndex(department: string): number {
  if (department === "build") return 2;
  const i = DEPT_ORDER.indexOf(department);
  return i < 0 ? 0 : i;
}

const LEAD_GAP = 232;
const WORKER_GAP = 46;
const BRANCH_GAP = 300;
const SHARED_GAP = 202;

export function layout(nodes: LayoutInput[]): Map<string, Placed> {
  const placed = new Map<string, Placed>();

  const cos = nodes.find((n) => n.tier === "cos");
  const directors = nodes.filter((n) => n.tier === "director");

  // Pin the sides explicitly rather than by sort index, so adding a third
  // branch later is a change here and nowhere else.
  const sideOf: Record<string, number> = { web: -1, automation: 1 };
  const branchHalfWidth = (LEAD_GAP * 3) / 2;

  placed.set("__owner", { id: "__owner", x: 0, y: ROW.owner });
  if (cos) placed.set(cos.id, { id: cos.id, x: 0, y: ROW.cos });

  for (const dir of directors) {
    const side = sideOf[dir.branch] ?? 0;
    const centre = side * (branchHalfWidth + BRANCH_GAP / 2);
    placed.set(dir.id, { id: dir.id, x: centre, y: ROW.director });

    const leads = nodes
      .filter((n) => n.tier === "lead" && n.branch === dir.branch)
      .sort((a, b) => deptIndex(a.department) - deptIndex(b.department));

    leads.forEach((lead, i) => {
      const x = centre + (i - (leads.length - 1) / 2) * LEAD_GAP;
      placed.set(lead.id, { id: lead.id, x, y: ROW.lead });

      nodes
        .filter((n) => n.tier === "worker" && n.reportsTo === lead.id)
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((worker, w) => {
          placed.set(worker.id, { id: worker.id, x, y: ROW.worker + w * WORKER_GAP });
        });
    });
  }

  // Shared services: two either side of the Chief of Staff, working outward.
  const shared = nodes
    .filter((n) => n.branch === "shared" && n.tier !== "cos")
    .sort((a, b) => a.id.localeCompare(b.id));

  const inner = NODE.cos.w / 2 + SHARED_GAP / 2 + 24;
  shared.forEach((agent, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const rank = Math.floor(i / 2);
    placed.set(agent.id, {
      id: agent.id,
      x: side * (inner + rank * SHARED_GAP),
      // Centred against the taller COS card. No stagger: a vertical offset here
      // would imply a hierarchy between shared services that does not exist.
      y: ROW.cos + (NODE.cos.h - NODE.shared.h) / 2,
    });
  });

  return placed;
}

/**
 * Which cable to draw for a node. Shared services return null: they sit beside
 * the Chief of Staff and a cable between adjacent cards is noise, not
 * information. The band label in the deck carries that relationship instead.
 */
export function cableFor(node: LayoutInput): { from: string; to: string } | null {
  if (node.tier === "cos") return { from: "__owner", to: node.id };
  if (node.branch === "shared") return null;
  if (!node.reportsTo) return null;
  return { from: node.reportsTo, to: node.id };
}

export function nodeSize(tier: Tier | "owner" | "shared") {
  if (tier === "owner") return NODE.owner;
  if (tier === "shared") return NODE.shared;
  if (tier === "cos") return NODE.cos;
  if (tier === "director") return NODE.director;
  if (tier === "lead") return NODE.lead;
  return NODE.worker;
}
