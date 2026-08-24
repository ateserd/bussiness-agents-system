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

**v2 yeniden yazımı bitti** (Fazlar 1–7). Geçmişi ve alınan kararlar
`V2_PLAN.md`'de; kalan tek iş VPS'e deploy.

**Stack:** Next.js 15.5.22 (App Router) · TypeScript · Tailwind v4 · Drizzle
(Postgres lehçesi) · PGlite (yerel) · d3-force · Anthropic SDK

## Ne nerede

```
agents/shared/<dept>/*.yaml     4 ajan — tek gerçek kaynak
prompts/<agent.id>.md           ajan başına sistem promptu (iş gerçeği İÇERMEZ)
src/app/                        4 görünüm: / (Bugün) · /pipeline · /ledger · /brain
src/app/api/state/              5 sn'de bir yoklanan canlı durum
src/components/today/           Bugün panosu
src/components/pipeline/        lead → fırsat → proje → müşteri hunisi
src/components/shell/           üst çubuk + canlı yenileyici
src/components/brain/           d3-force takımyıldızı (canvas)
src/lib/settings.ts             ayar kataloğu — hardcoded iş değeri BURAYA
src/lib/tasks.ts                görev kuyruğu · park etme · cevaplama
src/lib/system-map.ts           Yönetici'nin promptuna eklenen canlı sistem özeti
src/lib/approvals.ts            settleApproval — onayın TEK yolu
src/lib/agents/                 registry · prompt · run · tools · cost
src/lib/brain/                  embed · scope · search · write
src/lib/outreach/               günlük plan · lead seçimi · parti · karar
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
- **`outreach_send` ve üç takvim aracı KOŞULSUZ kapılı** — `gatedBy` kontrolü
  yok. YAML'dan kapıyı silmek ya da ajanı `act_freely` yapmak ne bir yabancının
  gelen kutusuna ne de sahibin takvimine yol açabilir. İkisi de sahibin duran
  talimatı; config'e bağlı bir kural bu talimat değildir. `spend` ajan bazında
  kalmaya devam ediyor, o meşru biçimde role bağlı.
  (`send_contract` vardı ve silindi: sözleşmeyi sahip elle yolluyor, yani onu
  tutan bir ajan hiç olmadı. Ulaşılamayan bir araç hakkındaki kural, kural
  değil süstür.)
- **Her onay kartı oluşturulduğunda Telegram'a düşer** (`notifyOwner`) — tek
  istisna günün gönderim partisi: on kart on bildirim düşürmesin diye
  `requireApproval(..., notify=false)` ile susturulur ve hepsini kapsayan **tek**
  mesaj gider. Kapı değişmedi, sorulma biçimi değişti.
- **Takvim de koşulsuz kapılı.** Oluşturma, değiştirme, iptal — üçü de. Sahibin
  duran talimatı: "telegramdan bana sormadan yapmasın". Araçlar Google'a hiç
  dokunmuyor; kartı yazıp duruyorlar, işi onaydan sonra `settleApproval` yapıyor.
- **Panel kumanda değil, ayna.** Ajan çalıştıran/duraklatan/onaylayan düğme
  yok — kontrol Telegram'da. Beyin'deki not ekleme ve silme istisna: onlar
  hafıza düzenlemek, ajana komut vermek değil.
- **Günlük talimat kalıcı değildir.** "bugün 7 at" `outreach_days`'e yazılır ve
  ertesi gün kendiliğinden söner; "günlük mail sayısını 7 yap" ise `settings`.
  İkisini karıştırmak haftalarca fark edilmez.
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

- **Ajan `tools:` listesine yazılan her ad artık zorunlu olarak var.** Eskiden
  `toolsFor()` bilinmeyen adı sessizce düşürürdü; v1'de `agent.dispatch` on bir
  dosyada yazılıydı ve hiç var olmamıştı — Chief of Staff hiç görev
  dağıtamıyordu. Tuzak kapatıldı: geçerli adlar `src/lib/agents/tool-names.ts`'te,
  `registry.ts` YAML'ı ona karşı doğruluyor (dosya adını söyleyerek patlıyor) ve
  `BUILDERS` `satisfies Record<ToolName, …>` olduğu için ikisi sapamıyor.
  Yeni araç eklerken **iki yere** yazılır: listeye ve `BUILDERS`'a; birini
  unutmak derlemede yakalanır.
  Kanal-bağlı araçlar (`settings.write`, `outreach.plan`) listede bilerek yok —
  onlar YAML'dan değil, çalışmanın nereden geldiğinden mount ediliyor.
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

- **`assemblePrompt` `runAgent`'ın try bloğunun DIŞINDA.** Orada patlayan bir şey
  ajanın cevap vermesini tümden engeller. `buildSystemMap()` bu yüzden kendi
  içinde try/catch'li ve her bölümü `⚠️` satırına düşebiliyor — harita konfor,
  yetenek değil.
- **Önbellek breakpoint'i yalnızca kök ajanda.** Yazmak okumaktan pahalı; kazanç
  aynı önek 5 dk içinde tekrar gelirse doğuyor. Yönetici Telegram'da art arda
  çalışıyor, işçiler günde bir — onlara koymak primi ödeyip hiç okumamak olurdu.
  Anıların değişken tarafta olması şart: `recall()` sorguyu `mission + task` ile
  gömüyor, yani her mesajda değişiyor.
- **Önbelleğin minimum önek uzunluğu MODELE göre değişiyor** ve altında kalınca
  breakpoint sessizce yok sayılıyor — hata yok, yazma yok, `cache_read` sıfır.
  Sonnet'te 1024 token, **Haiku 4.5'te 4096.** Yönetici ölçüldü: ~3.3k araç +
  ~2.6k sabit metin ≈ **5.9k**, yani Haiku eşiğinin ~1.8k üstünde. Rol promptunu
  kırpmak ya da araç çıkarmak bu marjı yer ve önbellek Haiku'da sessizce durur.
  İkisinden birini yapmadan önce yeniden ölç.
- **Hiçbir render yolu model çağırmaz.** Sayfa `narrateBrief()` çağırıyordu ve
  bu kendi kendini besleyen bir döngüydü: anlatım bir `activity` satırı yazar →
  `/api/state`'in `lastActivity`'si değişir → 5 saniyelik yoklama
  `router.refresh()` çağırır → sayfa yeniden render olur → yine anlatır. Açık
  bir tarayıcı sekmesi ~12 saniyede bir model çağırıyordu, sonsuza kadar —
  ölçüldü: **saatte ~$0.60**, hedeflenen aylık bütçenin iki katı, günde.
  İşin kötüsü kodun kendi yorumu doğru olanı zaten söylüyordu; kod tersini
  yapıyordu. Anlatım artık günde bir kez sabah brifinginde üretilip görev
  satırına yazılıyor, panel `todaysNarration()` ile **okuyor**. Kural: panel
  ayna, ve aynaya bakmak para tutmaz.

- **Sunucu-taraflı web araçları `allowed_callers: ["direct"]` istiyor.**
  `web_search_20260209` ve sonrası varsayılan olarak `code_execution` içinden
  çalışıyor (dinamik filtreleme). Programatik araç çağrısı olmayan modeller —
  Haiku 4.5 dahil — bunu yapamıyor ve **400** dönüyor. Belirti aldatıcıydı:
  hata mesajı *modeli* suçluyor, oysa sorun aracın çağrılma biçimi. Web aracı
  olan tek ajan Scout olduğu için tek başına patlıyordu, Yönetici ve Ops aynı
  modelde sorunsuz çalışıyordu.

- **Thinking ve effort her modelde yok — ve yanlışı runu tümden düşürüyor.**
  Haiku 4.5 yalnızca extended thinking destekliyor: `thinking:{type:"adaptive"}`
  400 dönüyor, `output_config.effort` de desteklenen parametreleri arasında
  değil. `run.ts` eskiden ikisini de koşulsuz gönderiyordu, yani Ops Haiku'ya
  alındığı andan beri her gerçek çağrıda patlıyordu — ve **anahtarsız checkout
  hiç API'ye ulaşmadığı için burada görünmüyordu.** Artık `reasoningParams()`
  modele bakıyor, kaynağı da `cost.ts`'teki tek model tablosu. Yeni model
  eklerken fiyatla birlikte `thinking` alanı da yazılır; bilinmeyen model
  `extended`'a düşer, çünkü göndermemek asla runu düşürmez.

- **`tick()` içindeki sistem adımlarının saati AYARDAN gelir**, cadence
  tablosundan değil. `dueRuns()` statik cron okur; `brief.time` ve
  `outreach.batch_time` birer ayar. Bu yüzden brifing ve parti `tick.ts` içinde,
  `onceToday()` kalıbıyla.
- **Süreç ölürse görev sonsuza kadar `running` kalır.** `runUnit` fırlatılan
  hatayı yakalar, sürecin kaybolmasını yakalayamaz. `reapStaleRuns` bunun tek
  çaresi ve **her tick'te** çalışır, günde bir değil: saklama bir *politika*
  (günlük doğru), bu ise bir *onarım* — kayıt gerçekle çelişiyor. Günde bire
  bağlamak, 10:00'da öksüz kalan bir satırın ertesi sabaha kadar panelde
  "çalışıyor" demesi demekti; yani fonksiyonun önlemek için var olduğu yalanın
  ta kendisi. Eşik `TIMEOUT_MS * 6` (12 dk) — timeout'un çok ötesinde, yoksa
  yavaş ama canlı bir çalışma kendi altından ölü ilan edilir.
- **`/pause` çalışan görevi durdurmaz.** Yalnızca `agents.paused`'ı çeviriyor,
  yani *sonraki* çalışmaları engelliyor; uçuştaki iş devam eder. Çalışan bir işi
  yarıda kesmenin yolu yok — kasıtlı: yarıda kesilen bir araç çağrısı dış
  dünyada yarım iş bırakabilir.

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

Sahipten bekleyen tek kurulum: **Google Takvim OAuth** (~20 dk, `DEPLOY.md` § 8).
Kurulmadan takvim yazma çalışmaz, okuma `.ics`'ten devam eder.

Yalnızca VPS'te doğrulanabilecek dört şey — bu sandbox'ın çıkış proxy'si
`tcmb.gov.tr`'yi ve döviz API'lerini engelliyor, `ANTHROPIC_API_KEY` de yok:

1. **Kur** — ilk gerçek TL çevrimi (`npm run agent:run -- shared.ops.assistant
   --task "45 bin TL kaç dolar?"`)
2. **`web_search` / `web_fetch`** — sunucu tarafı araçlar, tanımları doğru ama
   gerçek bir çağrı yapılmadı
3. **Önbellek isabeti** — iki ardışık Telegram mesajından sonra
   `usage.cache_read_input_tokens > 0` olmalı
4. **Haiku işçiler** — Ops ve Scout'un gerçek bir çağrıda 400 almadığı.
   Yukarıdaki 1 ve 2 bunu zaten sınıyor: ikisi de artık Haiku'da. Model
   yeteneği tablosu dokümana göre yazıldı, canlı çağrıyla doğrulanmadı.

Geri kalan açık işler `SETUP_TODO.md`'de.
