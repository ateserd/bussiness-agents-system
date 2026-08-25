/**
 * The portable data shape.
 *
 * The original lived inside Mission Control and spoke that project's language
 * (branch / department / permanent / useCount). Everything here is domain
 * neutral so a second project can feed it whatever it has; see
 * `src/adapters/mission-control.ts` for the mapping that keeps the original
 * caller working.
 */

export type KnowledgeNode = {
  id: string;
  /** Body text. Rendered in the side panel, folded into the search index. */
  label: string;
  /** Free-form category, shown as the panel eyebrow. */
  kind?: string;
  /** Primary cluster. Lays out as a column, left to right. */
  group?: string;
  /** Secondary cluster. Lays out as a band inside the column. */
  subgroup?: string | null;
  /** Searchable, listed in the panel. */
  tags?: string[];
  /** Drives node radius. Compressed, so heavy nodes read bigger without taking over. */
  weight?: number;
  /** Painted in the pinned colour and given a permanent glow. */
  pinned?: boolean;
  /** Extra label/value rows in the panel, in insertion order. */
  meta?: Record<string, string | number | null | undefined>;
  /** Highlighted footnote at the bottom of the panel. */
  note?: string;
  /** Extra text folded into the search index but never displayed. */
  search?: string;
};

export type KnowledgeLink = {
  from: string;
  to: string;
  /** Looked up in `theme.linkKinds` for colour; unknown kinds fall back. */
  kind?: string;
};

export type KnowledgeTheme = {
  /** Wins over group and subgroup when `node.pinned`. */
  pinned: string;
  /** Used when nothing else matches. */
  fallback: string;
  /** Checked first: subgroup name → colour. */
  subgroups: Record<string, string>;
  /** Checked second: group name → colour. */
  groups: Record<string, string>;
  /** Link kind → colour. `default` is the fallback entry. */
  linkKinds: Record<string, string>;
};

export type KnowledgeLayout = {
  /** Column order, left to right. Groups outside the list land in the middle. */
  groupOrder: string[];
  /** Band order, top to bottom. Subgroups outside the list land mid-height. */
  subgroupOrder: string[];
  /** Vertical span the bands are spread over, as a fraction of height. */
  band: { start: number; end: number };
  /** Horizontal span the columns are spread over, as a fraction of width. */
  column: { start: number; end: number };
  charge: number;
  chargeDistanceMax: number;
  linkDistance: number;
  linkStrength: number;
  clusterStrength: number;
  centerStrength: number;
  collidePadding: number;
  collideStrength: number;
  velocityDecay: number;
  alphaDecay: number;
  radius: { base: number; scale: number; cap: number };
};

export type KnowledgeViewport = {
  enabled: boolean;
  min: number;
  max: number;
  /** Wheel sensitivity. Higher zooms faster. */
  speed: number;
};

/**
 * Same palette the Mission Control build shipped with, so an extraction of the
 * screenshot still looks like the screenshot. Override per project.
 */
export const defaultTheme: KnowledgeTheme = {
  pinned: "#f5c451",
  fallback: "#8ea3bd",
  subgroups: {
    outreach: "#ff4d6d",
    sales: "#4dd6ff",
    delivery: "#3ddc84",
    build: "#3ddc84",
    content: "#a06cff",
    shared: "#ffb84d",
  },
  groups: {
    web: "#4dd6ff",
    automation: "#ffb84d",
    global: "#8ea3bd",
  },
  linkKinds: {
    supersedes: "#f5c451",
    default: "#8ea3bd",
  },
};

export const defaultLayout: KnowledgeLayout = {
  groupOrder: ["web", "global", "automation"],
  subgroupOrder: ["outreach", "sales", "delivery", "build", "content"],
  band: { start: 0.18, end: 0.82 },
  column: { start: 0.26, end: 0.74 },
  charge: -96,
  chargeDistanceMax: 340,
  linkDistance: 62,
  linkStrength: 0.42,
  clusterStrength: 0.055,
  centerStrength: 0.04,
  collidePadding: 1.5,
  collideStrength: 0.7,
  velocityDecay: 0.36,
  alphaDecay: 0.016,
  radius: { base: 3, scale: 1.5, cap: 60 },
};

export const defaultViewport: KnowledgeViewport = {
  enabled: true,
  min: 0.35,
  max: 6,
  speed: 0.0016,
};
