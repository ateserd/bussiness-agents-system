import type { KnowledgeLink, KnowledgeNode } from "../knowledge-map/types";

/**
 * Deterministic sample data, so the demo runs with no database, no API key and
 * no network — and looks the same on every reload while you tune the forces.
 */

// Mulberry32: tiny, seedable, good enough for layout noise.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GROUPS = ["web", "automation"] as const;
const SUBGROUPS = ["outreach", "sales", "delivery", "build", "content"] as const;
const KINDS = ["gerçek", "karar", "tercih", "müşteri bağlamı", "ders", "ölçüm"];

const PHRASES = [
  "Fiyat tabanı 2.400 USD; altına inilmiyor, kapsam kısılıyor",
  "İlk yanıt 4 saati geçerse dönüşüm yarıya düşüyor",
  "ICP: 10-50 kişilik ajanslar, aylık 8k+ reklam harcaması",
  "Teklif PDF yerine tek sayfalık link daha hızlı dönüyor",
  "Salı 10:00 gönderimleri perşembeye göre %31 daha iyi açılıyor",
  "Müşteri onayı olmadan hiçbir gönderim dışarı çıkmaz",
  "Kapsam kayması faturalanır; ek talep yeni satır demek",
  "Discovery çağrısı 25 dakikayı geçmesin",
  "Otomasyon devri öncesi iki hafta gölge çalışma şart",
  "Webhook hataları sessizce yutulmaz, ledger'a yazılır",
  "Landing sayfası ilk ekranda tek bir eylem barındırır",
  "Marka rengi dışında ikinci vurgu rengi kullanılmıyor",
  "Aylık rapor ayın ilk iş günü sabah 09:00'da gider",
  "Soğuk e-postada üçüncü takip sonrası dizi kapatılır",
  "Fatura vadesi 14 gün; gecikirse iş durur",
];

export function sampleGraph(count = 140): { nodes: KnowledgeNode[]; links: KnowledgeLink[] } {
  const rand = rng(20260825);
  const nodes: KnowledgeNode[] = [];

  for (let i = 0; i < count; i++) {
    const global = rand() < 0.12;
    const group = global ? "global" : GROUPS[rand() < 0.5 ? 0 : 1];
    const scoped = !global && rand() > 0.15;
    const subgroup = scoped ? SUBGROUPS[Math.floor(rand() * SUBGROUPS.length)] : null;
    const pinned = rand() < 0.34;

    nodes.push({
      id: `n${i}`,
      label: `${PHRASES[Math.floor(rand() * PHRASES.length)]} (#${i})`,
      kind: KINDS[Math.floor(rand() * KINDS.length)],
      group,
      subgroup,
      tags: [
        global ? "global" : `branch.${group}`,
        ...(subgroup ? [`dept.${group}.${subgroup}`] : []),
      ],
      weight: Math.floor(rand() ** 2 * 55),
      pinned,
      meta: {
        Kapsam: global ? "global" : `branch.${group}`,
        Güven: (0.5 + rand() * 0.5).toFixed(2),
        Yazan: `agent-${Math.floor(rand() * 49)}`,
      },
      note: rand() < 0.08 ? "Şunun yerine geçti: 4f2a91c…" : undefined,
    });
  }

  // Link mostly within a subgroup, so the clusters read as clusters.
  const links: KnowledgeLink[] = [];
  for (let i = 0; i < Math.round(count * 0.55); i++) {
    const a = nodes[Math.floor(rand() * nodes.length)];
    const pool = nodes.filter((n) => n.id !== a.id && n.subgroup === a.subgroup && n.group === a.group);
    const b = (pool.length ? pool : nodes)[Math.floor(rand() * (pool.length || nodes.length))];
    if (!b || a.id === b.id) continue;
    links.push({ from: a.id, to: b.id, kind: rand() < 0.14 ? "supersedes" : "relates" });
  }

  return { nodes, links };
}
