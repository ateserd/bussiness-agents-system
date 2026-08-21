import { TopBar } from "@/components/deck/top-bar";
import { Constellation } from "@/components/brain/constellation";
import { getBrain } from "@/lib/data";
import { copy } from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function BrainPage() {
  const { nodes, links, counts } = await getBrain();

  return (
    <main className="relative z-10 min-h-screen">
      <TopBar caption={copy.brain.subtitle} />
      <div className="px-7 pb-6">
        <h2 className="m-0 text-[26px] font-bold tracking-[-0.01em]">{copy.brain.title}</h2>
      </div>
      <Constellation nodes={nodes} links={links} counts={counts} />
    </main>
  );
}
