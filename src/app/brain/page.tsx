import { TopBar } from "@/components/shell/top-bar";
import { Constellation } from "@/components/brain/constellation";
import { getBrain } from "@/lib/data";
import { copy } from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const { nodes, links, counts } = await getBrain();

  return (
    <main className="relative z-10 min-h-screen">
      {/* No live poller here on purpose: this page holds editing state — a
          selected node and a half-typed note — and a background refresh would
          throw both away mid-sentence. */}
      <TopBar caption={copy.brain.subtitle} />
      <Constellation nodes={nodes} links={links} counts={counts} />
    </main>
  );
}
