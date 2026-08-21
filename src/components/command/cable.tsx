"use client";

import { getBezierPath, type EdgeProps } from "@xyflow/react";

/**
 * A "light cable" between two nodes.
 *
 * The gradient runs from the branch's temperature into the child's department
 * accent, so a glance at the cable tells you which business is lit up (§4.2):
 * branch A cool, branch B warm. When the child is working, a dot travels the
 * path upward — a report being delivered toward the owner (§4.3).
 */

export type CableData = {
  accent: string;
  tint: string;
  working: boolean;
  dimmed: boolean;
  strength: number;
};

export function Cable(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const d = (props.data ?? {}) as unknown as CableData;

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.42,
  });

  const gradientId = `cable-grad-${id}`;
  const opacity = d.dimmed ? 0.06 : d.working ? 0.95 : 0.42;

  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor={d.tint ?? "#4dd6ff"} stopOpacity="0.55" />
          <stop offset="100%" stopColor={d.accent ?? "#4dd6ff"} stopOpacity="0.95" />
        </linearGradient>
      </defs>

      <path
        id={id}
        d={path}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={d.strength ?? 1}
        strokeLinecap="round"
        style={{ strokeOpacity: opacity, transition: "stroke-opacity .35s ease" }}
      />

      {d.working && !d.dimmed && (
        <circle r="2.7" fill="var(--ink)" opacity="0.9">
          {/* keyPoints 1;0 runs the dot from the child up toward the owner. */}
          <animateMotion
            dur="2.8s"
            repeatCount="indefinite"
            keyPoints="1;0"
            keyTimes="0;1"
            calcMode="linear"
          >
            <mpath href={`#${id}`} />
          </animateMotion>
        </circle>
      )}
    </>
  );
}

export const edgeTypes = { cable: Cable };
