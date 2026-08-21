import { TopBar } from "@/components/deck/top-bar";
import { Deck } from "@/components/command/deck";
import { buildBrief, tickerLines } from "@/lib/brief";
import { getCrew, getMemoryCount, getPendingApprovals } from "@/lib/data";
import { OWNER_NAME } from "@/lib/owner";
import { copy } from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function CommandPage() {
  const [crew, memoryCount, approvals, brief] = await Promise.all([
    getCrew(),
    getMemoryCount(),
    getPendingApprovals(),
    buildBrief(),
  ]);

  const simulate = !process.env.ANTHROPIC_API_KEY;

  return (
    <main className="relative z-10 min-h-screen">
      <TopBar caption={`${OWNER_NAME} · ${copy.tagline}`} />

      {simulate && (
        <div
          className="mx-7 mb-4 rounded px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.14em]"
          style={{
            border: "1px solid rgba(245,196,81,.28)",
            background: "rgba(245,196,81,.05)",
            color: "var(--gold)",
          }}
        >
          {copy.common.simulateBanner}
        </div>
      )}

      <Deck
        crew={crew}
        ownerName={OWNER_NAME}
        ticker={tickerLines(brief)}
        memoryCount={memoryCount}
        approvals={approvals}
      />
    </main>
  );
}
