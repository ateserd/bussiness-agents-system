import { TopBar } from "@/components/shell/top-bar";
import { LiveDot } from "@/components/shell/live";
import { Funnel } from "@/components/pipeline/funnel";
import { getFunnel } from "@/lib/data";
import { copy } from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const stages = await getFunnel();

  return (
    <main className="relative z-10 min-h-screen">
      <TopBar caption={copy.pipeline.subtitle}>
        <LiveDot />
      </TopBar>
      <Funnel stages={stages} />
    </main>
  );
}
