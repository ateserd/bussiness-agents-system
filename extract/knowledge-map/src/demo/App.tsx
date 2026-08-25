import { useMemo, useState } from "react";
import { KnowledgeMap } from "../knowledge-map";
import type { KnowledgeNode } from "../knowledge-map/types";
import { sampleGraph } from "./sample-data";

export default function App() {
  const [count, setCount] = useState(140);
  const { nodes, links } = useMemo(() => sampleGraph(count), [count]);
  const [picked, setPicked] = useState<KnowledgeNode | null>(null);

  const stats = useMemo(
    () => [
      { value: nodes.length, label: "düğüm" },
      { value: nodes.filter((n) => n.pinned).length, label: "kalıcı", accent: "#f5c451" },
      { value: new Set(nodes.map((n) => n.subgroup).filter(Boolean)).size, label: "küme" },
      { value: links.length, label: "bağ" },
    ],
    [nodes, links],
  );

  return (
    <main className="demo">
      <header className="demo-head">
        <div>
          <h1>
            KNOWLEDGE <span>MAP</span>
          </h1>
          <p>Mission Control&apos;ün Beyin görünümünden çıkarılmış, projeden bağımsız hâli.</p>
        </div>
        <label className="demo-range">
          <span>{count} düğüm</span>
          <input
            type="range"
            min={20}
            max={1200}
            step={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
      </header>

      <KnowledgeMap
        nodes={nodes}
        links={links}
        stats={stats}
        legend={[
          { color: "#f5c451", label: "Kalıcı" },
          { color: "#4dd6ff", label: "Ateş Design Agency" },
          { color: "#ffb84d", label: "Ateş Flow Agency" },
        ]}
        height="68vh"
        onSelect={setPicked}
      />

      <p className="demo-foot">
        {picked ? `Seçili: ${picked.id}` : "Bir düğüme tıkla. Tekerlek yakınlaştırır, boşluğu sürüklemek gezdirir, düğümü sürüklemek yerinden oynatır."}
      </p>
    </main>
  );
}
