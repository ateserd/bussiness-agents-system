"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agents, approvals } from "@/db/schema";

/**
 * Mutations the deck can trigger. Everything here is deliberately small: the
 * dashboard commands, the runtime does the work.
 */

export async function toggleAgentPause(agentId: string): Promise<void> {
  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) return;
  await db.update(agents).set({ paused: !agent.paused }).where(eq(agents.id, agentId));
  revalidatePath("/");
}

export async function runAgentNow(agentId: string): Promise<{ ok: boolean; message: string }> {
  const { runAgent } = await import("./agents/run");
  try {
    const result = await runAgent(agentId, { trigger: "manual" });
    revalidatePath("/");
    revalidatePath("/activity");
    return { ok: result.outcome === "success", message: result.summary };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function decideApproval(
  approvalId: string,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  const db = await getDb();
  const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!approval || approval.state !== "pending") return;

  await db
    .update(approvals)
    .set({
      state: decision,
      decidedAt: new Date(),
      rejectionReason: decision === "rejected" ? (reason ?? null) : null,
    })
    .where(eq(approvals.id, approvalId));

  // Releasing the gate returns the agent to idle so the tree stops asking —
  // unless it still has another approval waiting.
  const remaining = await db.select().from(approvals).where(eq(approvals.agentId, approval.agentId));
  const stillPending = remaining.some((a) => a.id !== approvalId && a.state === "pending");
  if (!stillPending) {
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, approval.agentId));
  }

  revalidatePath("/");
  revalidatePath("/activity");
}
