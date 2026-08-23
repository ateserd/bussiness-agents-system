import { TopBar } from "@/components/shell/top-bar";
import { LiveDot } from "@/components/shell/live";
import { TodayBoard } from "@/components/today/board";
import { buildBrief, narrateBrief } from "@/lib/brief";
import { getActivity, getDayActivity, getMemoryCount, getPendingApprovals } from "@/lib/data";
import { openQuestions, runningTasks } from "@/lib/tasks";
import { openBatch } from "@/lib/outreach/batch";
import { OWNER_NAME } from "@/lib/owner";
import { copy, fmt } from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [brief, running, parked, approvals, activity, day, memoryCount, batch] = await Promise.all([
    buildBrief(now),
    runningTasks(),
    openQuestions(),
    getPendingApprovals(),
    getActivity(12),
    getDayActivity(midnight),
    getMemoryCount(),
    openBatch().catch(() => null),
  ]);

  // The manager's framing is worth a model call on the morning push, not on
  // every page load — the figures below it are the same either way.
  const narration = await narrateBrief(brief, "morning").catch(() => null);

  return (
    <main className="relative z-10 min-h-screen">
      <TopBar caption={`${OWNER_NAME} · ${fmt.day(now)}`}>
        <LiveDot />
      </TopBar>

      {!process.env.ANTHROPIC_API_KEY && (
        <div
          className="mx-4 mb-4 rounded-[10px] px-4 py-2.5 text-[12.5px] sm:mx-8"
          style={{ border: "1px solid var(--accent-line)", background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          {copy.common.simulateBanner}
        </div>
      )}

      <TodayBoard
        brief={brief}
        narration={narration}
        running={running}
        parked={parked}
        approvals={approvals}
        batch={batch ? { pending: batch.pending.length, calls: batch.payload.call.length, planLine: batch.payload.planLine } : null}
        activity={activity}
        sentToday={day.sent}
        memoryCount={memoryCount}
      />
    </main>
  );
}
