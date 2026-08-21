import { TopBar } from "@/components/deck/top-bar";
import { ActivityFeed } from "@/components/activity/feed";
import { getActivity, getBlockedAgents, getPendingApprovals } from "@/lib/data";
import { copy } from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const [rows, approvals, blocked] = await Promise.all([
    getActivity(300),
    getPendingApprovals(),
    getBlockedAgents(),
  ]);

  return (
    <main className="relative z-10 min-h-screen">
      <TopBar caption={copy.activity.subtitle} />
      <div className="px-7 pb-6">
        <h2 className="m-0 text-[26px] font-bold tracking-[-0.01em]">{copy.activity.title}</h2>
      </div>
      <ActivityFeed rows={rows} approvals={approvals} blocked={blocked} />
    </main>
  );
}
