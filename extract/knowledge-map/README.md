# Knowledge Map

Mission Control'ün `/brain` görünümündeki takımyıldız haritasının **projeden
bağımsız** hâli. Kendi başına çalışır: veritabanı yok, API anahtarı yok, ağ
erişimi yok. `npm install && npm run dev` yeter.

Kaynak: `src/components/brain/constellation.tsx` (Mission Control).

```
npm install
npm run dev      # http://localhost:5180
npm run build    # tsc --noEmit && vite build
```

Demo, üstteki kaydırıcıyla 20–1200 arası düğüm üretir; kuvvet ayarlarını
gerçek yükte denemek için orayı kullan.

---

## Ne değişti, ne aynı kaldı

Görsel sonuç ve kuvvet ayarları **birebir aynı** — palet, yarıçap sıkıştırma,
charge/link/collide değerleri, departman çapası, arama kısma davranışı hepsi
orijinalden geldi. Değişen tek şey bağımlılıklar ve genellik:

| Orijinal | Burada |
| --- | --- |
| `@/lib/data` → Drizzle + `BrainNode` | `KnowledgeNode` — alan adları alan-bağımsız |
| `@/lib/copy` → gömülü Türkçe | `labels` prop'u, Türkçe varsayılan (`trLabels` / `enLabels`) |
| `@/lib/copy` → `fmt` | `format.ts`, locale parametre |
| Tailwind sınıfları + global tokenlar | `knowledge-map.css`, `km-` önekli, tokenlar `--km-*` |
| `branch` / `department` | `group` (sütun) / `subgroup` (bant) |
| `permanent` / `useCount` | `pinned` / `weight` |
| Sabit renk tabloları | `theme` prop'u |
| Sabit kuvvet sabitleri | `layout` prop'u |

**Orijinalde olmayan, eklenen üç şey** — bir knowledge map'te ilk gün
isteyeceğin şeyler oldukları için:

- **Zoom / pan.** Tekerlek imlecin altındaki noktayı sabit tutarak yakınlaştırır;
  boşluğu sürüklemek gezdirir. `viewport={{ enabled: false }}` ile kapanır.
- **Düğüm sürükleme.** Basılı tutup çekince `fx/fy` sabitlenir, bırakınca
  serbest kalır. Kalıcı yerleştirme istiyorsan `knowledge-map.tsx` içindeki
  `endPress` fonksiyonunda `fx = null` satırlarını sil.
- **`ResizeObserver`.** Orijinal `window.resize` dinliyordu; bir yan panelin
  açılıp kapanması pencere olayı üretmediği için canvas bozuk ölçüde kalıyordu.

---

## Kullanım

```tsx
import { KnowledgeMap } from "./knowledge-map";
import "./knowledge-map/knowledge-map.css";   // bir kez, uygulamanın girişinde

<KnowledgeMap
  nodes={[
    {
      id: "a1",
      label: "Fiyat tabanı 2.400 USD; altına inilmiyor",
      kind: "tercih",
      group: "web",            // sütun (sol→sağ)
      subgroup: "sales",       // bant (üst→alt)
      tags: ["branch.web", "dept.web.sales"],
      weight: 12,              // yarıçap
      pinned: true,            // altın rengi + kalıcı parıltı
      meta: { Yazan: "agent-14", Güven: "0.91" },
      note: "Şunun yerine geçti: 4f2a91c…",
    },
  ]}
  links={[{ from: "a1", to: "a2", kind: "supersedes" }]}
  height={560}
  onSelect={(node) => console.log(node)}
/>
```

### Props

| Prop | Varsayılan | Ne yapar |
| --- | --- | --- |
| `nodes` | — | Zorunlu. `KnowledgeNode[]` |
| `links` | `[]` | `{ from, to, kind? }[]`. Eşleşmeyen id'ler sessizce atılır |
| `stats` | — | Canvas altındaki sayaç satırı |
| `legend` | — | Üstteki renk lejantı |
| `theme` | `defaultTheme` | Renkler (kısmi override yeterli) |
| `layout` | `defaultLayout` | Kuvvet sabitleri + küme sırası |
| `viewport` | `defaultViewport` | Zoom sınırları, `enabled: false` ile kapat |
| `labels` | `trLabels` | Tüm metinler |
| `locale` | `"tr-TR"` | Arama küçük harfe çevirme + sayı/tarih biçimi |
| `height` | `560` | **Kesin bir değer olmalı** (aşağıya bak) |
| `showPanel` / `showSearch` | `true` | Yerleşik parçaları kapat |
| `renderPanel` | — | Panelin gövdesini kendin çiz, çerçeve kalsın |
| `onSelect` | — | Seçim değiştiğinde |

### Renk sırası

`pinned` → `theme.subgroups[subgroup]` → `theme.groups[group]` →
`theme.fallback`. Yani kalıcı bir düğüm her zaman altın; kümesi olan düğüm küme
rengini alır; kalanı gruba düşer.

---

## Bilinmesi gerekenler

- **`height` kesin olmalı.** `560`, `"68vh"`, `"100%"` (ebeveyni kesin yükseklikteyse)
  çalışır; `flex-1` çalışmaz — yüzde sıfıra çözülür ve harita görünmez. Bu,
  Mission Control'de xyflow ile de yaşanan aynı tuzak.
- **`nodes` ve `links` referansı değişince simülasyon baştan kurulur.** Her
  render'da yeni dizi üretme — `useMemo` ile sabitle, yoksa harita sürekli
  sıfırlanır.
- **Canvas, SVG değil.** Bin küstü düğümde per-node DOM, sakin bir sürüklenme
  ile takılan bir sürüklenme arasındaki fark. Bedeli: metin etiketi yok, CSS
  ile düğüm biçimlendirilemez, tarayıcı araması düğümleri bulmaz.
- **Vurulma testi doğrusal tarama.** Bu ölçekte bedava; her tick'te yeniden
  kurulması gereken bir quadtree'den kaçınıyor. ~5.000 düğümü geçersen burası
  ilk optimize edilecek yer (`render.ts` → `pickAt`).
- **`"use client"` direktifi `knowledge-map.tsx`'in başında duruyor.** Next
  için gerekli; Vite/Rollup bunu yok sayar ama derleme sırasında bir uyarı
  basabilir, zararsız.
- **Küme ayrımı düğüm sayısı arttıkça bulanıklaşır.** Demo'da 140 düğümde
  sütunlar hâlâ okunuyor, 600'de birbirine giriyor. Ayarlanacak yer
  `layout.clusterStrength` (yukarı) ve `layout.charge` (sıfıra doğru).

---

## Mission Control'e geri takmak

`src/adapters/mission-control.ts` `BrainNode` → `KnowledgeNode` çevirisini
yapıyor; kapsam/güven/yazan alanları panel satırlarına, `supersedes` de nota
düşüyor. Çağrı yeri:

```tsx
import { KnowledgeMap } from "@/components/knowledge-map";
import { toKnowledgeNodes, toKnowledgeLinks } from "@/components/knowledge-map/adapters/mission-control";
import "@/components/knowledge-map/knowledge-map.css";

const { nodes, links, counts } = await getBrain();

<KnowledgeMap
  nodes={toKnowledgeNodes(nodes)}
  links={toKnowledgeLinks(links)}
  legend={[
    { color: "#f5c451", label: copy.brain.permanent },
    { color: "#4dd6ff", label: copy.branch.webFull },
    { color: "#ffb84d", label: copy.branch.automationFull },
  ]}
  stats={[
    { value: counts.memories, label: copy.brain.memories },
    { value: counts.facts, label: copy.brain.facts, accent: "var(--gold)" },
    { value: counts.clients, label: copy.brain.clients },
    { value: counts.links, label: copy.brain.links },
  ]}
/>
```

Dikkat: `getBrain()` kapsamdan departmanı **son parçadan** okur
(`dept.web.outreach` → `outreach`), ikinci parçadan değil. Kendi projende
kapsam üretiyorsan aynı kuralı koru, yoksa iki şubenin anıları karışır.

---

## Dosya haritası

```
src/knowledge-map/
  knowledge-map.tsx    bileşen + panel + etkileşim  (~370 satır)
  types.ts             veri şekli + varsayılan tema/yerleşim
  layout.ts            d3-force kurulumu, çapa, renk/yarıçap seçimi
  render.ts            canvas çizimi + vurulma testi
  viewport.ts          zoom/pan dönüşüm matematiği
  labels.ts            metinler (TR + EN)
  format.ts            sayı / tarih / "x önce"
  knowledge-map.css    kendine yeten stiller, --km-* tokenları
  index.ts             dışa açılan yüzey
src/adapters/
  mission-control.ts   BrainNode → KnowledgeNode
src/demo/              sadece demo kabuğu — pakete dahil değil
```

Pakete taşımak için `src/knowledge-map/` klasörünü kopyala; `src/demo/` ve
`src/main.tsx` demo kabuğu, gerekmiyor.

---

## Sırada ne var (yapılmadı)

- Klavye erişimi: düğümler canvas'ta, tab ile gezilemiyor. Gerçek çözüm,
  görünmez bir DOM listesi + canvas'ın `aria-hidden` olması.
- Etiket/metin katmanı: yakınlaşınca düğüm adlarını çizmek.
- Komşuluk vurgusu: bir düğüme tıklayınca yalnız komşularını yakmak.
- Kalıcı yerleşim: sürüklenen düğümün konumunu kaydetmek.
