# CLAUDE.md — Mission Control proje rehberi

Bu dosya her Claude Code oturumunda otomatik okunur. Amaç: kurulum dokümanını
tekrar etmek değil (o `README.md`'de), **bu projede çalışırken bilinmesi
gerekenleri** aktarmak: mimari değişmezler ve pahalıya mal olmuş tuzaklar.

## Proje nedir

Tek kişilik, **iki şubeli** bir ajans işletim sistemi. Ateş Design Agency (web
tasarım) ve Ateş Flow Agency (yapay zekâ otomasyonu) yapısal olarak ayrı iki
şube; yalnızca tepede (sahip + Chief of Staff) ve ortak servis katmanında
birleşiyorlar. 49 ajan, tek hafıza, tek gösterge paneli.

**Stack:** Next.js 15.5.22 (App Router) · TypeScript · Tailwind v4 · Drizzle
(Postgres lehçesi) · PGlite (yerel) · @xyflow/react · d3-force · Anthropic SDK

## Ne nerede

```
agents/<branch>/<dept>/*.yaml   49 ajan konfigürasyonu — tek gerçek kaynak
prompts/<agent.id>.md           ajan başına sistem promptu (iş gerçeği İÇERMEZ)
src/app/                        4 görünüm: / · /brain · /activity · /ledger
src/components/command/         org ağacı: layout · nodes · cable · drawer
src/components/brain/           d3-force takımyıldızı (canvas)
src/lib/agents/                 registry · prompt · run · tools · cost
src/lib/brain/                  embed · scope · search · write
src/lib/scheduler/              cadences (§7 tablosu) · tick
src/lib/chat/                   komut ayrıştırma, Telegram ile paylaşılıyor
src/db/                         schema · client · migrate · seed
```

## Kritik iş kuralları

- **ICP, fiyat, tercih gibi iş gerçekleri prompt dosyasına yazılmaz.** Beyin'de
  dururlar ve `assemblePrompt()` çalışma anında enjekte eder. Prompt'a gömmek,
  bir fiyat değişikliğini kod değişikliğine çevirir.
- **Onay kapıları araç `run()`'ının İÇİNDE.** Başka bir döngü, retry veya yeni
  bir çağıran kapıyı atlayamaz. Dışarıya tek bir yol var, o da oradan geçer.
- **`outreach_send` ve `send_contract` KOŞULSUZ kapılı** — `gatedBy` kontrolü
  yok. YAML'dan kapıyı silmek ya da ajanı `act_freely` yapmak bir yabancının
  gelen kutusuna yol açamaz. Sahibin duran talimatı bu; config'e bağlı bir kural
  bu talimat değildir. `publish`/`deploy`/`spend` ajan bazında kalmaya devam
  ediyor, onlar meşru biçimde role bağlı.
- **Her onay kartı oluşturulduğunda Telegram'a düşer** (`notifyOwner`). Sahip
  panele bakmak zorunda değil; bildirim başarısız olursa çalışma bozulmaz.
- **Kapsam yalıtımı tek bir yerde:** `src/lib/brain/scope.ts` → `scopeMatches`.
  Başka hiçbir yerde kapsam kontrolü yazma.
- **Dokunulmamış lead 30 günden uzun tutulmaz.** `pruneLeads()` her gün `tick()`
  içinde çalışıyor — cadence'te değil, çünkü cadence *ajan* çalıştırır ve
  saklama kuralı bir ajanın onu hatırlamasına bağlı olamaz. Temas kurulan ya da
  fırsata dönüşen lead kalır: o artık Google'ın verisi değil, kendi ticari
  ilişkimizin kaydı.
- **Kaynak yoksa sayı uydurulmaz.** `⚠️ <kaynak> kullanılamıyor (<sebep>)`
  yazılır. `lighthouse` aracı bilerek "kullanılamıyor" döner — sahte skor
  döndürmek kuralı model'in göremeyeceği katmanda çiğnerdi.
- **Ajan eklemek = dosya eklemek.** Hiçbir yer ekibi tek tek saymaz.

## Tuzaklar (tekrar öğrenmeye değmez)

- **`dept.` kapsamları şube nitelikli olmak zorunda:** `dept.web.outreach`,
  `dept.outreach` değil. İki şubede de "outreach" var; niteliksiz kapsam web
  ajanının otomasyon anılarını okumasına yol açıyordu. Bu gerçek bir sızıntıydı,
  seed'de yakalandı.
- **Bir anı ya `global` ya şube kapsamlıdır, ikisi birden değil.** `["global",
  "branch.web"]` yazarsan `global` her şeyi herkese açar ve yalıtım tamamen
  çöker. Artık `assertWritableScopes` (scope.ts) bunu `writeMemory()`'nin içinde
  reddediyor — ama kapsamı *yanlış seçmek* hâlâ senin sorumluluğun: tek başına
  `global` tamamen geçerlidir, o bilginin şubeye ait olduğunu yalnızca sen
  bilirsin. `npm run remember` bu yüzden `--scope`'u varsayılansız istiyor.
- **`getBrain()` departmanı kapsamın SON parçasından okur** (`.at(-1)`), ikinci
  parçasından değil — yukarıdaki nitelendirme yüzünden.
- **xyflow `base.css` `.react-flow`'a yükseklik VERMEZ**, yalnızca
  `.react-flow__container`'a. Kök eleman `height: 100%` ile gelir, yani
  **sarmalayıcının kesin (definite) bir yüksekliği olmalı** — `flex-1` yetmez,
  yüzde sıfıra çözülür ve ağaç görünmez. `deck.tsx`'te `height: 68vh` bu yüzden.
- **`style` prop'u ile xyflow'un `position`'ını ezemezsin** — kendi değerlerini
  seninkinden SONRA ekliyor. Konumlandırma sarmalayıcıda çözülür.
- **PGlite üst dizini kendi oluşturmuyor.** `client.ts` `data/` dizinini
  `mkdirSync(recursive)` ile açıyor, yoksa ENOENT.
- **tsx ile çalışan `.ts` script'lerinde top-level await yok** —
  `ERR_REQUIRE_ASYNC_MODULE`. `async function main()` sarmalayıcısı kullan.
- **Next dev/prod sunucusu açıkken build alırsan** chunk hash'leri kayar ve
  tarayıcı 404 alır; sunucuyu öldür, `rm -rf .next`, yeniden build al.
- **d3-force'ta collide + tek eksende kümeleme = düzgün disk.** Bilgi taşımayan
  duvar kâğıdı üretir. Departman bazlı çapa (`anchor()`) bu yüzden var.

## Ortam

- Node 22. `better-sqlite3` yok, PGlite native derleme istemiyor.
- Ağ erişimi gerekmez: `npm run dev` anahtarsız, sunucusuz çalışır.
- `ANTHROPIC_API_KEY` yoksa her ajan **simülasyon modunda** çalışır; gerçek
  activity + memory satırı yazar, model çağırmaz. Bu, döngüyü anahtarsız
  kanıtlanabilir tutmak için var — kaldırma.

## Geliştirme kuralları

- **Minimal diff.** Mevcut kalıpları takip et, gereksiz soyutlama ekleme.
- **Test yazma** (açıkça istenmedikçe) — projede test altyapısı yok.
- **Arayüz metinleri Türkçe, kod ve yorumlar İngilizce.** Tüm kullanıcıya görünen
  metin `src/lib/copy.ts`'te; başka yere string gömme.
- Commit öncesi **typecheck + lint + build** üçü de yeşil olmalı.
- Şema değiştirdiysen `npm run db:generate` çalıştır ve üretilen SQL'i aynı
  commit'e koy.
- `data/` ve `.env*` asla commit edilmez.

## Bilinen açık işler

Hepsi `SETUP_TODO.md`'de, neyi açtığına göre gruplanmış durumda. Özet: entegrasyon
yok (Stripe, takvim, CRM, gönderim, Lighthouse), Telegram taşıma katmanı bağlı
değil. Zamanlayıcı `/api/tick` + `vercel.json` ile saate bağlandı; yalnızca
`CRON_SECRET` bekliyor. `npm run tick` çalışıyor ve idempotent.
