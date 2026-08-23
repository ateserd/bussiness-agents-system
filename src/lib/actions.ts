"use server";

import { revalidatePath } from "next/cache";
import { rootAgent } from "@/lib/agents/registry";

/**
 * The only two mutations the panel can still make, and both edit *memory*.
 *
 * What used to be here — run this agent now, pause it, approve or reject a
 * card — is gone. Control moved to Telegram, and leaving a second path to the
 * same actions would have put a quieter door beside the one that has the gates
 * on it. These two stay because the owner asked for them by name and because
 * editing what the agents know is not commanding an agent.
 */

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
      sourceAgentId: rootAgent().id,
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
