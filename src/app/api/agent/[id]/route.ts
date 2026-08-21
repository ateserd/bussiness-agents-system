import { NextResponse } from "next/server";
import { getAgentDetail } from "@/lib/data";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const detail = await getAgentDetail(id);
  if (!detail.agent) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    log: detail.log.map((row) => ({
      id: row.id,
      summary: row.summary,
      outcome: row.outcome,
      costUsd: row.costUsd,
      durationMs: row.durationMs,
      startedAt: row.startedAt.toISOString(),
      unsureAbout: row.unsureAbout,
    })),
    memories: detail.memories.map((m) => ({
      id: m.id,
      content: m.content,
      kind: m.kind,
      confidence: m.confidence,
    })),
  });
}
