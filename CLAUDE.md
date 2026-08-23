# CLAUDE.md — Mission Control proje rehberi

Bu dosya her Claude Code oturumunda otomatik okunur. Amaç: kurulum dokümanını
tekrar etmek değil (o `README.md`'de), **bu projede çalışırken bilinmesi
gerekenleri** aktarmak: mimari değişmezler ve pahalıya mal olmuş tuzaklar.

## Proje nedir

Tek kişilik bir ajans işletim sistemi. İki iş var — Ateş Design Agency (web
tasarım) ve Ateş Flow Agency (yapay zekâ otomasyonu) — ama **artık iki ayrı
ajan hiyerarşisi yok.** Dört ajan ikisine birden bakıyor; şube artık *işin*
bir özelliği, ajanın değil.

Sahip yalnızca **Yönetici** ile konuşuyor, o da Telegram üzerinden. Panel bir
kumanda değil, canlı bir ayna.

**v2 yeniden yazımı sürüyor — sıradaki fazlar `V2_PLAN.md`'de.**

**Stack:** Next.js 15.5.22 (App Router) · TypeScript · Tailwind v4 · Drizzle
(Postgres lehçesi) · PGlite (yerel) · d3-force · Anthropic SDK

## Ne nerede

```
agents/shared/<dept>/*.yaml     4 ajan — tek gerçek kaynak
prompts/<agent.id>.md           ajan başına sistem promptu (iş gerçeği İÇERMEZ)
src/app/                        4 görünüm: / · /brain · /activity · /ledger
src/components/command/         ajan kartları · onay tepsisi · çekmece
src/components/brain/           d3-force takımyıldızı (canvas)
src/lib/settings.ts             ayar kataloğu — hardcoded iş değeri BURAYA
src/lib/tasks.ts                görev kuyruğu · park etme · cevaplama
src/lib/system-map.ts           Yönetici'nin promptuna eklenen canlı sistem özeti
src/lib/approvals.ts            settleApproval — onayın TEK yolu
src/lib/agents/                 registry · prompt · run · tools · cost
src/lib/brain/                  embed · scope · search · write
src/lib/scheduler/              cadences · tick (sınırlı eşzamanlı havuz)
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
- **Şube yalıtımı ajandan işe taşındı.** Dört ajan da iki şubeyi birden
  görebiliyor; yalıtım `narrowScopes()` ile *görev başına* uygulanıyor. Bir
  göreve şube etiketi koymayı unutmak, sızıntı demek.
- **Hiçbir iş değeri kodda sabit değil.** Günlük mail sayısı, bayatlama eşiği,
  maliyet tavanı — hepsi `src/lib/settings.ts` kataloğunda, sahibin Telegram'dan
  tek cümleyle değiştirebileceği şekilde. Yeni bir sayı gerekiyorsa oraya ekle,
  koda gömme.
- **`settings_write` YAML'dan verilemez.** Yalnızca sahibin doğrulanmış Telegram
  sohbetinden mount ediliyor (`ToolContext.ownerChannel`). Sebep: gelen
  cold-mail yanıtları Beyin'e yazılıyor ve ajanlar Beyin'i okuyor, yani bir
  yabancı ajanın önüne metin koyabiliyor. O metin ayarlara ulaşamamalı.
- **Onay tek yoldan kapanır:** `settleApproval()`. Panel ve Telegram aynı
  fonksiyonu çağırır. Eskiden iki kopya vardı ve paneldeki onay maili hiç
  göndermiyordu — sessizce.
- **Emin değilse sorar, o görevi bekletir.** `ask_owner` yalnızca kendi görevini
  `waiting_owner`'a alır; kuyruk çalışmaya devam eder. `tick()` bir çalışma
  bittiğinde satırı yeniden okur — park etmişse "done" diye ezmez.
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

- **Ajan `tools:` listesine yazılan her ad `BUILDERS`'ta olmalı.** Yoksa
  `toolsFor()` onu sessizce düşürür. v1'de `agent.dispatch` on bir dosyada
  yazılıydı ve hiç var olmamıştı — Chief of Staff hiç görev dağıtamıyordu.
- **`toolsFor()` araç *adına* göre tekilleştirir.** Bir ajan aynı aracı hem
  `tools:` hem `approval_required_for` üzerinden alabilir; kayıt adına göre
  tekilleştirmek API'ye aynı isimde iki tanım gönderiyordu.
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
yok (takvim, CRM, gönderim, Lighthouse), Telegram taşıma katmanı bağlı
değil. Zamanlayıcı `/api/tick` + `vercel.json` ile saate bağlandı; yalnızca
`CRON_SECRET` bekliyor. `npm run tick` çalışıyor ve idempotent.
