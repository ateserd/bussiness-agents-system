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

/** From the BRAIN panel — the owner's own delete, not Brain Keeper's pruning. */
export async function deleteBrainMemory(id: string): Promise<{ ok: boolean; message: string }> {
  const { deleteMemory } = await import("./brain/write");
  const result = await deleteMemory(id);
  revalidatePath("/brain");
  return result.deleted ? { ok: true, message: "Silindi." } : { ok: false, message: "Bulunamadı — zaten silinmiş olabilir." };
}

/**
 * A note added from the BRAIN panel, in the same scopes as the node the
 * owner was looking at — so it reaches the same agents that memory does.
 */
export async function addBrainNote(scopes: string[], content: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, message: "Boş not yazılamaz." };

  const { writeMemory } = await import("./brain/write");
  try {
    const result = await writeMemory({
      kind: "fact",
      scopes,
      content: trimmed,
      sourceAgentId: "shared.command.chief_of_staff",
      confidence: 0.9,
    });
    revalidatePath("/brain");
    return {
      ok: true,
      message: result.action === "merged" ? "Zaten biliniyordu — güveni artırdım." : "Eklendi.",
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
