import { randomUUID } from "node:crypto";
import { closeDb, getConnection, getDb } from "./client";
import {
  activity,
  agents,
  approvals,
  clients,
  deals,
  invoices,
  kpiSnapshots,
  leads,
  memories,
  memoryLinks,
  projects,
  tasks,
} from "./schema";
import { allAgents } from "../lib/agents/registry";
import { embedSync } from "../lib/brain/embed";

/**
 * Seeds a believable month of two agencies operating.
 *
 * The point is not volume, it is texture: mixed agent states, a real blocker, a
 * real pending approval, deals at every stage, one stalled deal for Pipeline
 * Watch to have caught, paid and unpaid invoices, and a memory graph with
 * enough structure that the BRAIN constellation has actual clusters.
 *
 * Deterministic: a fixed PRNG seed means the same dashboard every run, so a
 * screenshot stays comparable and a bug stays reproducible.
 */

let seed = 0x5eed_a7e5;
function rnd(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100000) / 100000;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length) % items.length];
}
function int(min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}
const DAY = 86_400_000;
const now = new Date("2026-08-21T09:20:00+03:00");
function daysAgo(d: number, jitterHours = 0): Date {
  return new Date(now.getTime() - d * DAY - Math.round(rnd() * jitterHours) * 3_600_000);
}
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------------
   Fixture vocabulary — Turkish SMB names, because that is the actual market.
-------------------------------------------------------------------------- */

const WEB_PROSPECTS = [
  ["Kumsal Balık Restoran", "Antalya", "restoran"],
  ["Meşe Mobilya Atölyesi", "Bursa", "mobilya"],
  ["Işık Optik", "İzmir", "perakende"],
  ["Doğan Hukuk Bürosu", "Ankara", "hukuk"],
  ["Yeşil Vadi Butik Otel", "Muğla", "konaklama"],
  ["Pusula Sürüş Okulu", "İstanbul", "eğitim"],
  ["Aden Güzellik Merkezi", "İstanbul", "güzellik"],
  ["Kavak Veteriner Kliniği", "Eskişehir", "sağlık"],
  ["Bereket Un Değirmeni", "Konya", "üretim"],
  ["Deniz Yat Kiralama", "Muğla", "turizm"],
  ["Altın Çatı Yapı Market", "Adana", "yapı"],
  ["Serin Klima Servisi", "İzmir", "servis"],
] as const;

const AUTO_PROSPECTS = [
  ["Marmara Lojistik", "Kocaeli", "lojistik"],
  ["Anadolu Sigorta Acentesi", "Ankara", "sigorta"],
  ["Ege Tekstil İhracat", "Denizli", "tekstil"],
  ["Bosphorus Emlak", "İstanbul", "emlak"],
  ["Kılıç Muhasebe", "İstanbul", "muhasebe"],
  ["Toros Nakliyat", "Mersin", "nakliyat"],
  ["Vega Medikal Tedarik", "Ankara", "medikal"],
  ["Poyraz İnsan Kaynakları", "İstanbul", "İK"],
  ["Kervan Gıda Toptan", "Gaziantep", "toptan"],
  ["Nar Dijital Ajans", "İzmir", "ajans"],
] as const;

const WEB_CLIENTS = [
  ["Zeytin Kafe & Fırın", "restoran"],
  ["Mavi Koy Pansiyon", "konaklama"],
  ["Ustaoğlu Mermer", "üretim"],
] as const;

const AUTO_CLIENTS = [
  ["Marmara Lojistik", "lojistik"],
  ["Kılıç Muhasebe", "muhasebe"],
  ["Vega Medikal Tedarik", "medikal"],
  ["Poyraz İnsan Kaynakları", "İK"],
] as const;

/* --------------------------------------------------------------------------
   Activity phrasing per agent role. Keeps the feed readable rather than
   "agent ran successfully" 300 times.
-------------------------------------------------------------------------- */

const ACTIONS: Record<string, { action: string; lines: string[] }> = {
  prospector: {
    action: "build_list",
    lines: [
      "{n} yeni işletme tarandı, {m} tanesi ICP eşiğini geçti.",
      "Liste çekildi: {n} aday, {d} tekrar elendi.",
      "{m} lead CRM'e yazıldı, hepsinde alan adı ve telefon var.",
    ],
  },
  auditor: {
    action: "audit_site",
    lines: [
      "{c} sitesi denetlendi — mobilde 4.1sn açılıyor, tek CTA yok.",
      "{c}: site yok, sadece Instagram profili. En güçlü kanca bu.",
      "{c} denetimi: Lighthouse 34, hero görseli 3.8MB.",
      "{c}: form çalışmıyor, gönderim hiçbir yere düşmüyor.",
    ],
  },
  dossier: {
    action: "write_dossier",
    lines: [
      "{c}: sipariş formu e-postaya düşüyor, elle tabloya giriliyor. Haftada ~6 saat.",
      "{c} dosyası: 3 kişilik ekip, 2 ayrı yerde çift veri girişi.",
      "{c}: teklif hazırlama tamamen elle, ilan metninden anlaşılıyor.",
    ],
  },
  draftsman: {
    action: "draft_sequence",
    lines: [
      "{c} için ilk temas + 4 takip yazıldı, e-posta ve DM varyantı ayrı.",
      "Dizi taslağı hazır: kanca denetimden, ask tek satır.",
    ],
  },
  sender: {
    action: "queue_send",
    lines: [
      "{n} mesaj kuyruğa alındı, günlük kota içinde.",
      "{n} gönderildi, {m} yanıt geldi, {d} sert bounce.",
      "Kuyruk onay bekliyor — {n} mesaj hazır, gönderilmedi.",
    ],
  },
  call_prep: {
    action: "write_brief",
    lines: [
      "{c} görüşmesi için brifing hazır: paket önerisi ve 3 itiraz.",
      "Bugün {n} görüşme var, brifingler yazıldı.",
    ],
  },
  closer_support: {
    action: "draft_proposal",
    lines: ["{c} için teklif taslağı: kapsam ve takvim yazıldı, fiyat sahibe bırakıldı.", "{c} sözleşmesi taslak halinde, onay bekliyor."],
  },
  proposal_agent: {
    action: "draft_proposal",
    lines: ["{c}: kurulum + aylık bakım teklifi hazırlandı.", "{c} sözleşmesi taslakta, onay bekliyor."],
  },
  scoper: {
    action: "estimate_build",
    lines: [
      "{c} akışı {n} saat tahmin edildi, en büyük bilinmeyen: veri temizliği.",
      "{c}: aylık işletme maliyeti hesaplandı, izleme dahil.",
    ],
  },
  pipeline_watch: {
    action: "sweep_pipeline",
    lines: [
      "Hat tarandı: {n} açık fırsat, {m} tanesi {d} gündür hareketsiz.",
      "Dönüşüm: yanıt {n} → görüşme {m} → teklif {d}.",
      "Hareket yok. {n} fırsatın hiçbiri bugün ilerlemedi.",
    ],
  },
  brief_builder: {
    action: "build_brief",
    lines: ["{c} için site haritası ve sayfa hedefleri çıkarıldı.", "{c} brifi hazır: 6 sayfa, her birinin tek işi var."],
  },
  copy_agent: {
    action: "write_copy",
    lines: ["{c} anasayfa ve hizmetler metni yazıldı.", "{c}: tüm sayfa metinleri marka sesinde tamamlandı."],
  },
  design_agent: {
    action: "design_layout",
    lines: ["{c} wireframe'leri gerçek metinle çıkarıldı.", "{c}: bileşen seti ve tipografi ölçeği belirlendi."],
  },
  build_agent: {
    action: "build_site",
    lines: ["{c} bileşen sistemi kuruldu, 4 sayfa yerleşti.", "{c}: formlar bağlandı, test gönderimi ulaştı."],
  },
  qa_agent: {
    action: "run_qa",
    lines: [
      "{c}: 5 kırılma noktası tarandı, Lighthouse 92, 2 kırık link bulundu.",
      "{c} QA geçti — engelleyen hata yok.",
      "{c} QA başarısız: iletişim formu gönderim yapmıyor. Handoff engellendi.",
    ],
  },
  handoff_agent: {
    action: "prepare_handoff",
    lines: ["{c} lansman kontrol listesi ve devir dokümanı hazır.", "{c}: Loom metni yazıldı, fatura tetiklendi."],
  },
  solution_architect: {
    action: "spec_workflow",
    lines: [
      "{c} akışı çıkarıldı: 4 tetikleyici, 11 adım, 6 hata durumu.",
      "{c}: istisna yolları tanımlandı — asıl kırılma orada.",
    ],
  },
  builder: {
    action: "build_workflow",
    lines: ["{c} akışı kuruldu, hata dalları dahil.", "{c}: her adım loglanıyor, girdi/çıktı görünür."],
  },
  tester: {
    action: "test_workflow",
    lines: [
      "{c}: {n} senaryo koşuldu, {m} geçti. Boş girdi dalı düzeltildi.",
      "{c} testleri temiz — süresi dolmuş auth dahil.",
    ],
  },
  shipper: {
    action: "deploy_workflow",
    lines: ["{c} canlıya alındı, izleme bağlandı, runbook yazıldı.", "{c}: dağıtım onay bekliyor."],
  },
  monitor: {
    action: "health_check",
    lines: [
      "{n} canlı akış tarandı, {m} sağlıklı.",
      "{c} akışı beklenen saatte çalışmadı — sessiz kalma olayı açıldı.",
      "{c}: art arda iki hata, olay açıldı.",
    ],
  },
  trend_scout: {
    action: "scan_trends",
    lines: ["{n} format tarandı, 3 tanesi bu hafta üretilebilir.", "Öne çıkan format kaydedildi, örnek link eklendi."],
  },
  scriptwriter: {
    action: "write_script",
    lines: ["{n} kısa metin yazıldı, hepsi tek fikir üstünde.", "Metin hazır: kanca ilk satırda."],
  },
  carousel: {
    action: "build_carousel",
    lines: ["{n} slaytlık karusel hazır, ilk slayt kaydırmayı hak ediyor.", "Karusel taslağı onay bekliyor."],
  },
  repurposer: {
    action: "repurpose",
    lines: ["Bir içerik {n} platforma yeniden biçimlendirildi.", "Her platform kendi formatında aldı."],
  },
  lead: {
    action: "file_numbers",
    lines: [
      "Gün sonu rakamları direktöre iletildi.",
      "Huni sırayla kontrol edildi, en dar adım: {s}.",
      "Bugün hareket yok. Sebep: kimse aramadı.",
    ],
  },
  director: {
    action: "branch_review",
    lines: ["Haftalık şube incelemesi dosyalandı.", "Hedefe göre sapma: {s}. Değiştirilen: kaynak dağılımı."],
  },
  chief_of_staff: {
    action: "morning_brief",
    lines: [
      "Sabah brifingi gönderildi. Sana düşen 2 madde vardı.",
      "Gün sonu özeti: ne çıktı, ne kaydı, yarının ilk 3'ü.",
      "Kasa kaynağı bağlı olmadığı için nakit satırı uyarı ile geçildi.",
    ],
  },
  finance: {
    action: "reconcile",
    lines: [
      "⚠️ Bu ay gider kaydı yok — net rakam gider tarafı olmadan raporlandı.",
      "Ödenmemiş fatura taraması: {n} açık, en eskisi {d} gün.",
    ],
  },
  client_success: {
    action: "check_clients",
    lines: [
      "{n} müşteri tarandı, {m} tanesinde risk sinyali var.",
      "{c}: 18 gündür temas yok, kontrol araması öneriliyor.",
    ],
  },
  brain_keeper: {
    action: "curate_memory",
    lines: [
      "{n} yakın kopya birleştirildi, {m} çelişki işaretlendi.",
      "Haftalık 'ne öğrendik' özeti yazıldı.",
      "{n} tekrar eden gerçek kalıcıya terfi etti.",
    ],
  },
  recruiter: {
    action: "propose_agent",
    lines: [
      "Tekrarlayan elle iş tespit edildi, yeni ajan konfigürasyonu taslakta.",
      "{n} ajan bir aydır çıktı üretmedi — emeklilik önerildi.",
    ],
  },
};

function phrase(agentId: string, ctx: { c?: string }): { action: string; summary: string } {
  const key = agentId.split(".").pop()!;
  const spec = ACTIONS[key] ?? ACTIONS.lead;
  const line = pick(spec.lines)
    .replace("{n}", String(int(3, 48)))
    .replace("{m}", String(int(1, 12)))
    .replace("{d}", String(int(1, 21)))
    .replace("{s}", pick(["gönderim", "yanıt", "görüşme", "teklif"]))
    .replace("{c}", ctx.c ?? "Bir işletme");
  return { action: spec.action, summary: line };
}

/* --------------------------------------------------------------------------
   Memories — written as atomic statements, the way the rules require.

   Split in two, because only one half is safe to put in front of a real
   deployment:

   buildStandingMemories() is every business fact and rule Ateş actually
   decided in conversation — control rules, ICP A/B, money handling, the
   14-day stale threshold. Agents read the Brain at run time (assemblePrompt),
   so this is not documentation, it is the configuration a live agent acts on.
   It ships in both --fresh and demo mode.

   buildDemoMemories() is texture invented to make a clean checkout's BRAIN
   view look like a month of real operation — fabricated "lessons" about
   response rates, notes about fictional clients, a superseded-decision pair
   for Brain Keeper to have something to reconcile. None of it was said by
   the owner. It must never reach a production Brain: an agent cannot tell a
   seeded lesson from a real one, and "kaynak yoksa sayı uydurulmaz" cuts both
   ways — inventing a performance lesson is the same failure as inventing a
   metric.
-------------------------------------------------------------------------- */

type MemSpec = { kind: Parameters<typeof embedSync> extends never ? never : string; text: string; scopes: string[]; permanent?: boolean; conf?: number };

function buildStandingMemories(): MemSpec[] {
  const out: MemSpec[] = [];
  const g = (text: string, permanent = false, conf = 0.8) =>
    out.push({ kind: "fact", text, scopes: ["global"], permanent, conf });
  const web = (text: string, kind = "fact", conf = 0.7) =>
    out.push({ kind, text, scopes: ["branch.web"], conf });
  const auto = (text: string, kind = "fact", conf = 0.7) =>
    out.push({ kind, text, scopes: ["branch.automation"], conf });
  const dept = (branch: string, d: string, text: string, kind = "lesson", conf = 0.7) =>
    out.push({ kind, text, scopes: [`branch.${branch}`, `dept.${branch}.${d}`], conf });

  /* --- global: how the owner works --- */
  g("Sahibin çalışma dili Türkçe; sistem arayüzü ve brifingler Türkçe olmalı.", true, 0.95);
  g("Sahip tek insan; hiçbir ajan başka bir insana iş devredemez.", true, 0.98);
  g("Saat dilimi Europe/Istanbul. Sabah brifingi 07:30 her gün, gün sonu özeti 19:00.", true, 0.95);
  g("Sahip önce sayı ister, sonra kendisine düşenleri. Övgü ve giriş cümlesi istemez.", true, 0.92);
  g("Sahibe aynı anda en fazla 3 karar taşınır; fazlası eleme yapılmadığı anlamına gelir.", true, 0.9);
  g("Bir kaynak bağlı değilse sayı uydurulmaz, uyarı ile geçilir.", true, 0.97);
  g("İki şube ayrı P&L tutar; birleşik toplam tek başına raporlanmaz.", true, 0.9);
  g("Ateş Design Agency web tasarımı, Ateş Flow Agency yapay zekâ otomasyonu satar.", true, 0.99);
  g("Sahip sesli not gönderdiğinde bu bir talimattır, bilgi değil.", false, 0.75);
  g("Onay kapısı olan hiçbir aksiyon, onay kaydı olmadan yürütülmez.", true, 0.98);

  /* --- the owner's standing control rules --- */
  g("Hiçbir ajan sahibin onayı olmadan bir yabancıya mesaj göndermez; her temas ayrı ayrı onaylanır.", true, 0.99);
  g("Onay istekleri Telegram'dan sahibin telefonuna gider; sahip panele bakmak zorunda bırakılmaz.", true, 0.95);
  g("Gelen e-postalara ajanlar yanıt yazmaz. Yanıtı sahip yazar; ajan yalnızca taslak hazırlar ve onaya sunar.", true, 0.97);
  g("Sözleşme imzası elle atılır; e-imza aracı bağlı değil. Ajanın işi onaya düşen sözleşme taslağında biter.", true, 0.95);
  g("Tahsilat nakit veya IBAN havalesi ile alınır, Stripe kullanılmaz. Gelir ve giderler sahibi tarafından elle girilir.", true, 0.95);
  g("Soğuk arama sahibi tarafından elle yapılır; ajanlar arama listesi ve açılış metni hazırlar, aramayı yapmaz.", true, 0.92);
  g("Sabit fiyat listesi yok. Her projenin fiyatını sahip belirler; ajan kapsamı ve süreyi yazar, rakamı boş bırakır ve sahibe sorar.", true, 0.96);
  g("Tutarlar ABD doları cinsindendir.", true, 0.95);
  g("Lead listesi Google Places API ile çıkarılır — iki şube için de. İşletme adı, telefon, adres, kategori, yorum sayısı ve sitesi olup olmadığı oradan gelir.", true, 0.95);
  g("Dokunulmamış lead 30 günden uzun tutulmaz, otomatik silinir. Temas kurulan ya da müşteriye dönüşen kayıt kalır — o artık kendi ticari ilişkimizin kaydıdır.", true, 0.96);
  g("Chief of Staff para bağlayan hiçbir kararı kendi başına vermez; tutar ne olursa olsun sahibe sorar.", true, 0.97);
  g("Soğuk e-posta kutu başına günde 10 mesajı geçmez. Hacim asla bir günden diğerine iki katına çıkarılmaz; alan adı itibarını yakan en yaygın hata budur.", true, 0.96);

  /* --- web branch: ICP A, as the owner defined it --- */
  web("ICP A — Ateş Design hedef müşterisi: Türkiye'nin her şehri, her sektör, 30 kişinin altında çalışanı olan, HİÇ web sitesi olmayan işletmeler.", "decision", 0.97);
  web("ICP A diskalifiye: zincir ve franchise işletmeler; ayrıca Google yorumu hiç olmayan çok küçük işletmeler — yorum yokluğu işletmenin bu iş için fazla küçük olduğunun işareti.", "decision", 0.95);
  web("Sitesi zayıf olan değil, sitesi HİÇ OLMAYAN işletme hedeftir. Mevcut sitesi olan aday ICP A dışıdır.", "decision", 0.95);
  web("İlk temas soğuk e-posta ile yapılır; soğuk arama sahibin kendisi tarafından elle yapılacağı için adayda telefon numarası da bulunmalıdır.", "decision", 0.93);
  dept("web", "sales", "Bayat fırsat eşiği 14 gündür. 14 gün kıpırdamayan fırsat brifinge 'kapatılsın mı, kovalansın mı' diye taşınır.", "decision", 0.95);

  /* --- automation branch: ICP B, as the owner defined it --- */
  auto("ICP B — Ateş Flow hedef müşterisi: Türkiye'nin her şehri, her sektör, 30 kişinin altında çalışanı olan, kullandığı sistemlere yapay zekâ entegre edilebilen işletmeler.", "decision", 0.97);
  auto("Entegrasyon n8n ile yapılıyor; eleme kriteri bu. Adayın kullandığı sisteme n8n bağlanamıyorsa aday ICP B dışıdır — esneklik sınırı burada.", "decision", 0.96);
  auto("ICP B diskalifiye: zincir ve franchise işletmeler; ayrıca Google yorumu hiç olmayan çok küçük işletmeler.", "decision", 0.95);
  dept("automation", "sales", "Bayat fırsat eşiği 14 gündür. 14 gün kıpırdamayan fırsat brifinge 'kapatılsın mı, kovalansın mı' diye taşınır.", "decision", 0.95);

  return out;
}

function buildDemoMemories(): MemSpec[] {
  const out: MemSpec[] = [];
  const web = (text: string, kind = "fact", conf = 0.7) =>
    out.push({ kind, text, scopes: ["branch.web"], conf });
  const auto = (text: string, kind = "fact", conf = 0.7) =>
    out.push({ kind, text, scopes: ["branch.automation"], conf });
  const dept = (branch: string, d: string, text: string, kind = "lesson", conf = 0.7) =>
    out.push({ kind, text, scopes: [`branch.${branch}`, `dept.${branch}.${d}`], conf });

  /* --- web branch --- */
  web("Web şubesinde en değerli hedef: sitesi olmayan ama telefonu olan bağımsız işletme.", "fact", 0.85);
  web("Zincir markalar web şubesi için diskalifiye; ICP dışı.", "decision", 0.88);
  web("Denetimde ölçülmeyen metrik yazılmaz; Lighthouse çalışmadıysa öyle denir.", "preference", 0.9);
  web("İlk temas mesajı işletmenin kendi sorunuyla açılır, ajans adıyla değil.", "preference", 0.86);
  web("QA temiz olmadan hiçbir proje Handoff'a geçmez.", "decision", 0.95);
  web("Restoran ve kafe segmentinde yanıt oranı diğer sektörlerin iki katı.", "lesson", 0.72);
  web("Sitesi hiç olmayan adaylara giden mesajlar, kötü sitesi olanlardan daha çok yanıt alıyor.", "lesson", 0.68);
  web("Antalya ve Muğla'da sezon dışı (kasım-şubat) yanıt oranı belirgin düşüyor.", "lesson", 0.62);
  dept("web", "outreach", "Instagram DM, e-postadan daha hızlı yanıt alıyor ama daha kısa konuşma üretiyor.", "lesson", 0.66);
  dept("web", "outreach", "Günlük kanal kotası aşıldığında alan adı itibarı haftalarca toparlanmıyor.", "lesson", 0.9);
  dept("web", "outreach", "Denetimdeki üç maddeden en somut olanı ilk cümleye konduğunda yanıt artıyor.", "lesson", 0.74);
  dept("web", "sales", "Görüşmede en sık üç itiraz: fiyat, süre, 'yeğenim yapıyordu'.", "lesson", 0.8);
  dept("web", "sales", "Kapsam dışı olanları teklifte yazmak, sonradan çıkan tartışmayı bitiriyor.", "lesson", 0.82);
  dept("web", "sales", "14 günden uzun hareketsiz fırsatların geri dönüş oranı çok düşük.", "lesson", 0.7);
  dept("web", "delivery", "Wireframe gerçek metinle yapılmazsa yerleşim canlıda bozuluyor.", "lesson", 0.84);
  dept("web", "delivery", "Müşteri içeriği geç gönderdiğinde lansman kayması neredeyse kesin.", "lesson", 0.8);
  dept("web", "delivery", "Devir dokümanı olmadan yapılan lansmanlar iki hafta içinde destek talebi üretiyor.", "lesson", 0.78);
  dept("web", "content", "Gerçek bir öncesi/sonrası ekran görüntüsü, anlatım videosundan çok daha iyi çalışıyor.", "lesson", 0.76);

  /* --- automation branch --- */
  auto("Otomasyon şubesi gözlemlenen bir elle süreç üzerinden satar, teknoloji üzerinden değil.", "fact", 0.9);
  auto("Teklif her zaman kurulum ücreti + aylık bakım olarak ikiye ayrılır.", "decision", 0.92);
  auto("Aylık bakım bedeli izleme maliyetinin altına inemez.", "decision", 0.94);
  auto("Canlı akış sağlığı, yeni satıştan önce gelir.", "decision", 0.95);
  auto("Sessiz kalan akış, hata veren akış kadar bozuktur.", "fact", 0.93);
  auto("Hiçbir akış izleme bağlanmadan canlıya alınmaz.", "decision", 0.95);
  auto("Müşteri verisi hiçbir zaman temiz varsayılmaz; tahminlere temizlik payı eklenir.", "lesson", 0.86);
  auto("Lojistik ve muhasebe segmentinde otomasyon tezi en kolay kanıtlanıyor.", "lesson", 0.74);
  auto("İş ilanları, şirketin hangi işi elle yaptığını gösteren en güvenilir açık kaynak.", "lesson", 0.8);
  dept("automation", "outreach", "'AI' kelimesiyle açılan mesajlar belirgin şekilde daha az yanıt alıyor.", "lesson", 0.78);
  dept("automation", "outreach", "Dosyada somut saat tahmini verildiğinde görüşme oranı yükseliyor.", "lesson", 0.72);
  dept("automation", "sales", "Kapsam anlaşılmadan verilen fiyat, bu şubede zararın ana kaynağı.", "lesson", 0.88);
  dept("automation", "sales", "En sık itiraz: 'bizim sürecimiz farklı' ve 'bozulunca ne olacak'.", "lesson", 0.82);
  dept("automation", "build", "Akışlar mutlu yolda değil, istisna yollarında kırılıyor.", "lesson", 0.9);
  dept("automation", "build", "Auth süresi dolması, canlı akışlarda en sık görülen tek hata sebebi.", "lesson", 0.84);
  dept("automation", "build", "Tekrarlanan tetikleyici testi yapılmayan akışlar canlıda çift kayıt üretiyor.", "lesson", 0.8);
  dept("automation", "content", "Süreç teardown'ları, ürün tanıtımından daha çok kaydediliyor.", "lesson", 0.7);

  /* --- client context (carries its branch scope, per the isolation rule) --- */
  const clientNotes: [string, string, string][] = [
    ["web", "zeytin_kafe", "Zeytin Kafe menüsünü haftada bir kendisi güncellemek istiyor; panel eğitimi verildi."],
    ["web", "zeytin_kafe", "Zeytin Kafe sahibi telefonu tercih ediyor, e-postaya iki gün sonra bakıyor."],
    ["web", "mavi_koy", "Mavi Koy Pansiyon rezervasyon formunu doğrudan WhatsApp'a bağlamak istedi."],
    ["web", "mavi_koy", "Mavi Koy için sezon dışı içerik güncellemesi ekimde yapılacak."],
    ["web", "ustaoglu", "Ustaoğlu Mermer ürün fotoğraflarını kendisi çekiyor, kalite değişken."],
    ["automation", "marmara", "Marmara Lojistik sipariş akışı her sabah 06:00'da çalışıyor; sessizlik 07:00'de olay demek."],
    ["automation", "marmara", "Marmara Lojistik'te ERP tarafı yalnızca CSV kabul ediyor, API yok."],
    ["automation", "kilic", "Kılıç Muhasebe ayın ilk üç günü yoğun; bakım penceresi o günlere konmaz."],
    ["automation", "vega", "Vega Medikal stok akışı tedarikçi API'sine bağlı, o taraf sık zaman aşımına giriyor."],
    ["automation", "poyraz", "Poyraz İK aday eleme akışı 14 Ağustos'tan beri hata veriyor, olay açık."],
  ];
  for (const [branch, client, text] of clientNotes) {
    out.push({
      kind: "client_context",
      text,
      scopes: [`branch.${branch}`, `client.${client}`],
      conf: 0.85,
    });
  }

  /* --- metric snapshots --- */
  const snaps = [
    ["web", "Ağustos ilk yarısında web şubesi 6 görüşme aldı, hedef 10'du."],
    ["web", "Web şubesi temmuz cirosu, haziranın %18 üzerinde kapandı."],
    ["automation", "Otomasyon şubesinde 7 canlı akış var, biri hatalı."],
    ["automation", "Otomasyon şubesi MRR'ı ağustos başında 4 müşteriye dağılmış durumda."],
    ["web", "Denetim başına ortalama ajan maliyeti 0.02 doların altında kalıyor."],
    ["automation", "Dosya başına ortalama ajan maliyeti denetimin yaklaşık üç katı."],
  ] as const;
  for (const [branch, text] of snaps) {
    out.push({ kind: "metric_snapshot", text, scopes: [`branch.${branch}`], conf: 0.9 });
  }

  /* --- decisions with a superseding pair, so Brain Keeper has real work --- */
  out.push({
    kind: "decision",
    text: "Web şubesinde bayat fırsat eşiği 10 gün olarak belirlendi.",
    scopes: ["branch.web", "dept.web.sales"],
    conf: 0.6,
  });
  out.push({
    kind: "decision",
    text: "Web şubesinde bayat fırsat eşiği 14 güne çıkarıldı; 10 gün çok erken uyarı üretiyordu.",
    scopes: ["branch.web", "dept.web.sales"],
    conf: 0.85,
  });

  /* --- filler that is still real: per-prospect observations --- */
  for (const [name, city, sector] of WEB_PROSPECTS) {
    out.push({
      kind: "fact",
      text: `${name} (${city}, ${sector}) için denetim yapıldı; bulgular outreach kancası olarak kullanıldı.`,
      scopes: ["branch.web", "dept.web.outreach"],
      conf: 0.6 + rnd() * 0.2,
    });
  }
  for (const [name, city, sector] of AUTO_PROSPECTS) {
    out.push({
      kind: "fact",
      text: `${name} (${city}, ${sector}) dosyası çıkarıldı; elle yürüyen bir süreç tespit edildi.`,
      scopes: ["branch.automation", "dept.automation.outreach"],
      conf: 0.6 + rnd() * 0.2,
    });
  }

  const lessons = [
    ["web", "delivery", "Tek CTA'lı sayfalar, üç seçenek sunanlardan daha iyi dönüşüyor."],
    ["web", "delivery", "Mobil menüde üçten fazla bağlantı, tıklanma oranını düşürüyor."],
    ["web", "outreach", "Cuma öğleden sonra gönderilen mesajlar pazartesi yığınında kayboluyor."],
    ["web", "sales", "Fiyatı görüşmede söylemek, teklife saklamaktan daha az itiraz üretiyor."],
    ["web", "content", "Ekran kaydı içeren gönderiler, statik görselden iki kat kaydediliyor."],
    ["automation", "build", "Adım başına loglama, hata ayıklama süresini belirgin kısaltıyor."],
    ["automation", "build", "Runbook'u olan akışlarda destek talebi neredeyse yok."],
    ["automation", "outreach", "Salı ve çarşamba sabahları en yüksek açılma oranını veriyor."],
    ["automation", "sales", "Kurulum ücreti peşin alındığında proje başlangıcı gecikmiyor."],
    ["automation", "content", "Rakam içeren başlıklar, soru başlıklarından daha çok tıklanıyor."],
  ] as const;
  for (const [branch, d, text] of lessons) {
    out.push({ kind: "lesson", text, scopes: [`branch.${branch}`, `dept.${branch}.${d}`], conf: 0.6 + rnd() * 0.25 });
  }

  const prefs = [
    "Sahip uzun paragraf yerine madde işareti tercih ediyor.",
    "Rapor başlığında emoji kullanılmıyor, uyarı satırı hariç.",
    "Sayılar Türkçe biçimde yazılıyor, para birimi dolar.",
    "Ajan çıktısında 'harika soru' gibi giriş cümleleri istenmiyor.",
    "Engel bildirimi tek satır olmalı ve tam olarak ne yapılması gerektiğini söylemeli.",
    "Sahip ekran görüntüsü ile bildirilen test sonucunu doğrulanmış kabul ediyor.",
    "Haftalık inceleme pazartesi sabahı okunuyor; cuma gönderilirse kayboluyor.",
    "Ajan adları İngiliz rol adları, arayüz metinleri Türkçe.",
  ];
  for (const text of prefs) out.push({ kind: "preference", text, scopes: ["global"], conf: 0.85 });

  /* --- operating decisions, per branch --- */
  const decisions: [string, string][] = [
    ["web", "Web şubesinde tek sayfalık site satılmıyor; en küçük paket 4 sayfa."],
    ["web", "Müşteri içeriği gelmeden tasarım aşamasına geçilmiyor."],
    ["web", "Lansman cuma günü yapılmıyor; hafta sonu destek yok."],
    ["web", "Alan adı ve hosting müşterinin kendi hesabında kalıyor, bizde değil."],
    ["automation", "Müşterinin üretim sistemine yazma yetkisi, test ortamı doğrulanmadan istenmiyor."],
    ["automation", "Her canlı akışın beklenen çalışma sıklığı kayıt altına alınır; sessizlik ancak böyle tespit edilir."],
    ["automation", "Kurulum ücretinin yarısı peşin alınır."],
    ["automation", "Aynı anda ikiden fazla yeni kurulum başlatılmıyor."],
  ];
  for (const [branch, text] of decisions) {
    out.push({ kind: "decision", text, scopes: [`branch.${branch}`], conf: 0.82 + rnd() * 0.12 });
  }

  /* --- more department-level lessons, earned the hard way --- */
  const moreLessons: [string, string, string][] = [
    ["web", "outreach", "Telefonu olup sitesi olmayan adaylarda dönüşüm, her iki kanalı olanlardan yüksek."],
    ["web", "outreach", "Aynı işletmeye iki kanaldan aynı hafta yazmak yanıt oranını düşürüyor."],
    ["web", "outreach", "Denetim ekran görüntüsü eklenen mesajlar iki kat yanıt alıyor."],
    ["web", "sales", "Görüşme öncesi brifing okunmadığında çağrı ortalama 12 dakika uzuyor."],
    ["web", "sales", "Teklife takvim eklendiğinde imza süresi kısalıyor."],
    ["web", "delivery", "Bileşen sistemi önce kurulduğunda sayfa üretimi belirgin hızlanıyor."],
    ["web", "delivery", "Form testi yapılmayan lansmanların yarısında ilk hafta hata çıkıyor."],
    ["web", "delivery", "Lighthouse 90 altındaki teslimlerde müşteri şikâyeti artıyor."],
    ["web", "content", "Müşteri sonucundan bahseden gönderiler en çok kaydedileni."],
    ["web", "content", "Haftada üçten fazla gönderi, üretim kalitesini düşürüyor."],
    ["automation", "outreach", "Dosyada şirketin kendi ilan metninden alıntı yapmak güçlü çalışıyor."],
    ["automation", "outreach", "Genel 'süreçlerinizi otomatikleştirelim' mesajları neredeyse hiç yanıt almıyor."],
    ["automation", "sales", "Kapsam dışı maddeler yazılmadığında proje ortasında tartışma çıkıyor."],
    ["automation", "sales", "Aylık bakım anlatılmadan satılan kurulumlar ikinci ay iptal ediliyor."],
    ["automation", "build", "Zaman aşımı dalı olmayan entegrasyonlar üretimde en sık kırılan yer."],
    ["automation", "build", "Test ortamında geçen akışların bir kısmı canlıda veri biçimi yüzünden kırılıyor."],
    ["automation", "build", "İzleme, lansman duyurusundan önce bağlanmazsa çoğunlukla hiç bağlanmıyor."],
    ["automation", "content", "Gerçek bir hata hikâyesi anlatan gönderiler en yüksek etkileşimi alıyor."],
  ];
  for (const [branch, d, text] of moreLessons) {
    out.push({ kind: "lesson", text, scopes: [`branch.${branch}`, `dept.${branch}.${d}`], conf: 0.58 + rnd() * 0.3 });
  }

  /* --- more per-client context, each carrying its branch scope --- */
  const moreClientNotes: [string, string, string][] = [
    ["web", "zeytin_kafe", "Zeytin Kafe hafta içi 15:00-17:00 arası müsait, aramalar o saate konuyor."],
    ["web", "mavi_koy", "Mavi Koy sahibi İngilizce içerik istemedi; sadece Türkçe yayında."],
    ["web", "ustaoglu", "Ustaoğlu Mermer'de karar verici oğlu, e-postaları o okuyor."],
    ["web", "ustaoglu", "Ustaoğlu için ürün kataloğu PDF olarak duruyor, sayfaya taşınacak."],
    ["automation", "marmara", "Marmara Lojistik CSV'yi UTF-8 değil Windows-1254 ile üretiyor."],
    ["automation", "marmara", "Marmara Lojistik'te operasyon müdürü değişti, yeni kişi akışı bilmiyor."],
    ["automation", "kilic", "Kılıç Muhasebe akışı ayın 1-3'ü arası günde 200'ü aşkın kayıt işliyor."],
    ["automation", "vega", "Vega Medikal tedarikçi API'si gece 02:00-04:00 arası bakımda oluyor."],
    ["automation", "poyraz", "Poyraz İK'da aday verisi KVKK gereği 6 ay sonra siliniyor, akış buna uymalı."],
    ["automation", "poyraz", "Poyraz İK yöneticisi haftalık özet e-postası istiyor, akışa eklendi."],
  ];
  for (const [branch, client, text] of moreClientNotes) {
    out.push({
      kind: "client_context",
      text,
      scopes: [`branch.${branch}`, `client.${client}`],
      conf: 0.78 + rnd() * 0.15,
    });
  }

  return out;
}

/* ========================================================================== */

async function main() {
  const db = await getDb();
  const { raw } = await getConnection();

  /*
   * --fresh seeds the 49 agents and every business fact Ateş actually decided
   * — nothing else. No fake leads, deals, clients, invoices, activity feed or
   * "lessons" that never happened. That is what goes on a real deployment:
   * a LEDGER showing fabricated revenue on day one would be exactly the
   * "kaynak yoksa sayı uydurulmaz" rule broken by the seed script itself.
   *
   * Without the flag, seed keeps building the believable month of demo
   * texture it always has — that is what a clean local checkout wants.
   */
  const FRESH = process.argv.includes("--fresh");
  console.log(FRESH ? "· fresh mode — agents and standing decisions only, no demo data" : "· demo mode");

  console.log("· clearing");
  await raw(`truncate table
    memory_links, memories, kpi_snapshots, activity, approvals, tasks,
    invoices, projects, clients, deals, leads, agents
    restart identity cascade`);

  /* --- agents ------------------------------------------------------------ */
  const configs = allAgents();

  // A believable Thursday morning: most idle, a handful mid-run, one waiting on
  // the owner, one genuinely broken. Skipped in fresh mode — a real deployment
  // starts with every agent idle because none of them have run yet.
  const WORKING = FRESH
    ? new Set<string>()
    : new Set([
        "web.outreach.auditor",
        "web.sales.pipeline_watch",
        "automation.outreach.prospector",
        "shared.services.client_success",
      ]);
  const NEEDS_APPROVAL = FRESH
    ? new Set<string>()
    : new Set(["web.outreach.sender", "automation.sales.proposal_agent"]);
  const BLOCKED = FRESH
    ? new Map<string, string>()
    : new Map([
        [
          "shared.services.finance",
          "Bu ay hiç gider kaydı girilmemiş — P&L'in gider tarafı boş, net rakam eksik çıkıyor.",
        ],
      ]);

  await db.insert(agents).values(
    configs.map((c) => ({
      id: c.id,
      displayName: c.display_name,
      branch: c.branch,
      department: c.department,
      tier: c.tier,
      reportsTo: c.reports_to,
      accent: c.accent,
      avatar: c.avatar ?? null,
      status: BLOCKED.has(c.id)
        ? ("blocked" as const)
        : NEEDS_APPROVAL.has(c.id)
          ? ("needs_approval" as const)
          : WORKING.has(c.id)
            ? ("working" as const)
            : ("idle" as const),
      mission: c.mission,
      promptFile: c.system_prompt_file,
      model: c.model,
      effort: c.effort,
      tools: c.tools,
      memoryScopes: c.memory_scopes,
      approvalRequiredFor: c.approval_required_for,
      escalateWhen: c.escalate_to_human_when,
      schedule: c.schedule,
      autonomy: c.autonomy,
      paused: false,
      blocker: BLOCKED.get(c.id) ?? null,
      lastRunAt: FRESH ? null : c.schedule ? daysAgo(0, 8) : rnd() > 0.5 ? daysAgo(int(1, 5), 12) : null,
      nextRunAt: FRESH ? null : c.schedule ? new Date(now.getTime() + int(1, 22) * 3_600_000) : null,
      createdAt: FRESH ? now : daysAgo(34),
    })),
  );
  console.log(`· ${configs.length} agents`);

  if (!FRESH) {
  /* --- leads ------------------------------------------------------------- */
  const leadRows: (typeof leads.$inferInsert)[] = [];
  for (const [name, city, sector] of WEB_PROSPECTS) {
    leadRows.push({
      id: randomUUID(),
      branch: "web",
      company: name,
      contactName: null,
      email: rnd() > 0.45 ? `info@${slug(name)}.com.tr` : null,
      phone: rnd() > 0.25 ? `+90 5${int(30, 55)} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}` : null,
      website: rnd() > 0.4 ? `https://${slug(name)}.com.tr` : null,
      city,
      sector,
      fitScore: int(58, 94),
      thesis: pick([
        "Site yok, sadece Instagram. Telefon var — en güçlü hedef profili.",
        "Site var ama mobilde 4sn üzeri açılıyor, tek bir çağrı butonu yok.",
        "Menü PDF olarak duruyor, aranabilir değil.",
        "Form var ama gönderim hiçbir yere ulaşmıyor.",
      ]),
      source: "osm+manual",
      sourceAgentId: "web.outreach.prospector",
      createdAt: daysAgo(int(2, 28), 12),
    });
  }
  for (const [name, city, sector] of AUTO_PROSPECTS) {
    leadRows.push({
      id: randomUUID(),
      branch: "automation",
      company: name,
      contactName: null,
      email: `bilgi@${slug(name)}.com.tr`,
      phone: rnd() > 0.5 ? `+90 2${int(12, 62)} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}` : null,
      website: `https://${slug(name)}.com.tr`,
      city,
      sector,
      fitScore: int(61, 96),
      thesis: pick([
        "Sipariş formu e-postaya düşüyor, oradan elle tabloya giriliyor.",
        "İki ayrı sistemde çift veri girişi yapılıyor.",
        "Teklif hazırlama tamamen elle; ilan metninden anlaşılıyor.",
        "Aday eleme e-posta üzerinden yürüyor, hacim yüksek.",
      ]),
      source: "apollo+manual",
      sourceAgentId: "automation.outreach.prospector",
      createdAt: daysAgo(int(2, 26), 12),
    });
  }
  await db.insert(leads).values(leadRows);
  console.log(`· ${leadRows.length} leads`);

  /* --- deals: every stage represented, one deliberately stalled ---------- */
  const STAGES = ["new", "contacted", "discovery", "proposal", "won", "lost"] as const;
  const dealRows: (typeof deals.$inferInsert)[] = [];
  let stageCursor = 0;
  for (const lead of leadRows) {
    if (rnd() > 0.85) continue;
    const stage = STAGES[stageCursor++ % STAGES.length];
    const isWeb = lead.branch === "web";
    const value = isWeb ? int(1200, 6500) : int(2500, 12000);
    // Deals go quiet in the middle of the funnel, not at the ends — that is
    // where Pipeline Watch earns its place.
    const canStall = ["contacted", "discovery", "proposal"].includes(stage);
    const movedDays = canStall && rnd() > 0.55 ? int(15, 26) : int(0, 9);
    dealRows.push({
      id: randomUUID(),
      branch: lead.branch!,
      leadId: lead.id!,
      title: `${lead.company} — ${isWeb ? "web sitesi" : "otomasyon kurulumu"}`,
      stage,
      valueUsd: String(value),
      mrrUsd: isWeb ? "0" : String(int(180, 900)),
      ownerAgentId: `${lead.branch}.sales.lead`,
      stalled: movedDays >= 14 && !["won", "lost"].includes(stage),
      lastMovedAt: daysAgo(movedDays, 10),
      closedAt: stage === "won" || stage === "lost" ? daysAgo(int(1, 18)) : null,
      createdAt: daysAgo(int(10, 30)),
    });
  }
  await db.insert(deals).values(dealRows);
  const stalledCount = dealRows.filter((d) => d.stalled).length;
  console.log(`· ${dealRows.length} deals (${stalledCount} stalled)`);

  /* --- clients, projects, invoices --------------------------------------- */
  const clientRows: (typeof clients.$inferInsert)[] = [];
  for (const [name] of WEB_CLIENTS) {
    clientRows.push({
      id: randomUUID(),
      branch: "web",
      name,
      contactName: null,
      email: `info@${slug(name)}.com.tr`,
      health: "active",
      mrrUsd: "0",
      startedAt: daysAgo(int(40, 150)),
      lastContactAt: daysAgo(int(1, 12)),
    });
  }
  AUTO_CLIENTS.forEach(([name], i) => {
    clientRows.push({
      id: randomUUID(),
      branch: "automation",
      name,
      contactName: null,
      email: `bilgi@${slug(name)}.com.tr`,
      // One at risk on purpose: Client Success needs something real to report.
      health: i === 3 ? "at_risk" : "active",
      mrrUsd: String(int(220, 850)),
      startedAt: daysAgo(int(45, 180)),
      lastContactAt: i === 3 ? daysAgo(18) : daysAgo(int(1, 9)),
    });
  });
  await db.insert(clients).values(clientRows);

  const projectRows: (typeof projects.$inferInsert)[] = [];
  const P_STAGES = ["brief", "design", "build", "qa", "handoff", "live"] as const;
  clientRows.forEach((c, i) => {
    const isWeb = c.branch === "web";
    const stage = isWeb ? P_STAGES[i % 5] : "live";
    projectRows.push({
      id: randomUUID(),
      branch: c.branch!,
      clientId: c.id!,
      name: isWeb ? `${c.name} — kurumsal site` : `${c.name} — sipariş akışı`,
      stage,
      // Poyraz İK is the erroring automation the Monitor is blocked on.
      healthy: !(c.name === "Poyraz İnsan Kaynakları"),
      atRisk: stage === "qa" || c.name === "Poyraz İnsan Kaynakları",
      dueAt: new Date(now.getTime() + int(3, 28) * DAY),
      createdAt: daysAgo(int(15, 60)),
    });
  });
  // A couple of extra live automations so the Monitor's ratio is interesting.
  for (let i = 0; i < 3; i++) {
    projectRows.push({
      id: randomUUID(),
      branch: "automation",
      clientId: clientRows[WEB_CLIENTS.length + (i % AUTO_CLIENTS.length)].id!,
      name: pick(["fatura eşleme akışı", "stok uyarı akışı", "teklif üretim akışı"]),
      stage: "live",
      healthy: true,
      atRisk: false,
      dueAt: null,
      createdAt: daysAgo(int(30, 90)),
    });
  }
  await db.insert(projects).values(projectRows);

  const invoiceRows: (typeof invoices.$inferInsert)[] = [];
  clientRows.forEach((c, i) => {
    const count = int(1, 3);
    for (let n = 0; n < count; n++) {
      const issued = daysAgo(int(3, 70));
      const overdue = rnd() > 0.72;
      const paid = !overdue && rnd() > 0.3;
      invoiceRows.push({
        id: randomUUID(),
        branch: c.branch!,
        clientId: c.id!,
        number: `${c.branch === "web" ? "AD" : "AF"}-2026-${String(100 + i * 4 + n)}`,
        amountUsd: String(c.branch === "web" ? int(900, 4200) : int(400, 2600)),
        state: paid ? "paid" : overdue ? "overdue" : "sent",
        issuedAt: issued,
        dueAt: new Date(issued.getTime() + 14 * DAY),
        paidAt: paid ? new Date(issued.getTime() + int(3, 13) * DAY) : null,
      });
    }
  });
  await db.insert(invoices).values(invoiceRows);
  console.log(
    `· ${clientRows.length} clients · ${projectRows.length} projects · ${invoiceRows.length} invoices`,
  );

  /* --- activity: 30 days of it ------------------------------------------- */
  const COST: Record<string, [number, number]> = {
    "claude-opus-5": [5 / 1e6, 25 / 1e6],
    "claude-sonnet-5": [3 / 1e6, 15 / 1e6],
    "claude-haiku-4-5": [1 / 1e6, 5 / 1e6],
  };
  const companies = [...WEB_PROSPECTS, ...AUTO_PROSPECTS].map(([n]) => n);
  const activityRows: (typeof activity.$inferInsert)[] = [];

  const schedulable = configs.filter((c) => c.schedule || c.tier === "worker");
  for (let day = 29; day >= 0; day--) {
    const date = daysAgo(day);
    const isWeekend = [0, 6].includes(date.getDay());
    const runs = isWeekend ? int(1, 4) : int(8, 16);
    for (let r = 0; r < runs; r++) {
      const agent = pick(schedulable);
      const { action, summary } = phrase(agent.id, { c: pick(companies) });
      const inTok = int(900, 6500);
      const outTok = int(120, 1400);
      const [inRate, outRate] = COST[agent.model] ?? COST["claude-haiku-4-5"];
      const failed = rnd() > 0.94;
      const started = new Date(date.getTime() + int(7, 19) * 3_600_000 + int(0, 59) * 60_000);
      const duration = int(1400, 42_000);
      activityRows.push({
        id: randomUUID(),
        agentId: agent.id,
        branch: agent.branch,
        department: agent.department,
        action,
        summary,
        reason: pick([
          "Programlı çalışma.",
          "Lider görevlendirdi.",
          "Yukarı akıştan yeni kayıt geldi.",
          "Sahip sordu.",
        ]),
        input: { scheduled: Boolean(agent.schedule), day: dayKey(date) },
        output: { note: summary },
        unsureAbout: rnd() > 0.6 ? pick(UNSURE) : null,
        outcome: failed ? "failure" : "success",
        costUsd: (inTok * inRate + outTok * outRate).toFixed(6),
        inputTokens: inTok,
        outputTokens: outTok,
        durationMs: duration,
        simulated: true,
        error: failed ? pick(["Kaynak zaman aşımına uğradı.", "Site yanıt vermedi (503)."]) : null,
        startedAt: started,
        finishedAt: new Date(started.getTime() + duration),
      });
    }
  }
  // The two blocked agents each get a terminal blocked row so ACTIVITY shows why.
  for (const [agentId, blocker] of BLOCKED) {
    const agent = configs.find((c) => c.id === agentId)!;
    const started = daysAgo(0, 3);
    activityRows.push({
      id: randomUUID(),
      agentId,
      branch: agent.branch,
      department: agent.department,
      action: agentId.includes("monitor") ? "health_check" : "reconcile",
      summary: blocker,
      reason: "Engel tespit edildi, yukarı taşındı.",
      input: {},
      output: {},
      unsureAbout: null,
      outcome: "blocked",
      costUsd: "0",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: int(300, 2000),
      simulated: true,
      error: blocker,
      startedAt: started,
      finishedAt: new Date(started.getTime() + 900),
    });
  }
  await db.insert(activity).values(activityRows);
  console.log(`· ${activityRows.length} activity rows`);

  /* --- approvals --------------------------------------------------------- */
  const approvalRows: (typeof approvals.$inferInsert)[] = [
    {
      id: randomUUID(),
      agentId: "web.outreach.sender",
      branch: "web",
      gate: "sending_external_messages",
      title: "Kumsal Balık Restoran — ilk temas + 4 takip",
      draft: `Merhaba,

Kumsal Balık'ın sitesine telefondan baktım: menü PDF olarak açılıyor ve Google'da aranamıyor. Sayfanın açılması mobilde 4.1 saniye sürüyor — bu sürede ziyaretçilerin yarısı geri dönüyor.

Aynı sektörde bunu çözdüğümüz bir örnek var. 15 dakikalık bir görüşmede ne yaptığımızı göstereyim mi?

— Ateş Design Agency`,
      context: { sequence_steps: 5, channel: "email", daily_cap_remaining: 12 },
      estimatedCostUsd: "0.00",
      state: "pending",
      createdAt: daysAgo(0, 4),
    },
    {
      id: randomUUID(),
      agentId: "automation.sales.proposal_agent",
      branch: "automation",
      gate: "sending_contracts",
      title: "Ege Tekstil İhracat — kurulum + aylık bakım teklifi",
      draft: `KAPSAM
Sipariş e-postalarının okunması, satır kalemlerine ayrılması ve ERP'ye CSV olarak aktarılması.
Tetikleyici: gelen kutusuna düşen sipariş e-postası. Beklenen hacim: günde ~40.

DAHİL
· Hata dalları: eksik alan, çift sipariş, bozuk ek dosya
· Aylık izleme ve olay müdahalesi

DAHİL DEĞİL
· ERP tarafındaki değişiklikler
· Tedarikçi API entegrasyonu (ayrı kapsam)

BEDEL
Kurulum: 4.800 USD · Aylık bakım: 640 USD

En büyük bilinmeyen: geçmiş sipariş e-postalarının biçim tutarlılığı. İlk hafta örneklem üzerinden doğrulanacak.`,
      context: { estimated_hours: 38, monthly_running_cost_usd: 210 },
      estimatedCostUsd: "4800.00",
      state: "pending",
      createdAt: daysAgo(1, 6),
    },
  ];
  await db.insert(approvals).values(approvalRows);
  console.log(`· ${approvalRows.length} approvals (${approvalRows.filter((a) => a.state === "pending").length} pending)`);

  /* --- tasks ------------------------------------------------------------- */
  await db.insert(tasks).values(
    configs
      .filter((c) => c.schedule)
      .slice(0, 12)
      .map((c, i) => ({
        id: randomUUID(),
        agentId: c.id,
        title: `Programlı çalışma — ${c.display_name}`,
        status: i < 2 ? ("running" as const) : ("queued" as const),
        payload: { source: "schedule" },
        runKey: `${c.id}:${dayKey(now)}:${i}`,
        scheduledFor: new Date(now.getTime() + int(1, 20) * 3_600_000),
        attempts: 0,
        createdAt: daysAgo(0, 2),
      })),
  );

  /* --- KPI snapshots: 14 days, so sparklines have shape ------------------ */
  const kpiRows: (typeof kpiSnapshots.$inferInsert)[] = [];
  for (const c of configs) {
    for (const k of c.kpis) {
      const target = typeof k.target === "number" ? k.target : Number(k.target);
      const base = Number.isFinite(target) && target > 0 ? target : int(4, 20);
      let value = base * (0.5 + rnd() * 0.6);
      for (let day = 13; day >= 0; day--) {
        value = Math.max(0, value + (rnd() - 0.45) * base * 0.35);
        kpiRows.push({
          id: randomUUID(),
          agentId: c.id,
          name: k.name,
          label: k.label,
          value: Math.round(value * 10) / 10,
          target: Number.isFinite(target) ? target : null,
          window: k.window,
          day: dayKey(daysAgo(day)),
        });
      }
    }
  }
  await db.insert(kpiSnapshots).values(kpiRows);
  console.log(`· ${kpiRows.length} KPI snapshots`);
  } // !FRESH

  /* --- memories ------------------------------------------------------------
     Standing decisions ship always — agents read the Brain at run time, so a
     fresh deployment without ICP A/B and the control rules would run with an
     empty rulebook. Demo texture (fabricated lessons, fictional client notes)
     is opt-out via the same --fresh flag as everything else above. --------- */
  const specs = FRESH ? buildStandingMemories() : [...buildStandingMemories(), ...buildDemoMemories()];
  const memRows: (typeof memories.$inferInsert)[] = specs.map((m) => ({
    id: randomUUID(),
    kind: m.kind as (typeof memories.$inferInsert)["kind"],
    scopes: m.scopes,
    content: m.text,
    sourceAgentId: pickWriter(m.scopes, configs.map((c) => c.id)),
    sourceActivityId: null,
    sourceUrl: null,
    confidence: m.conf ?? 0.7,
    permanent: m.permanent ?? false,
    embedding: embedSync(m.text),
    useCount: FRESH ? 0 : m.permanent ? int(14, 60) : int(0, 22),
    supersedes: null,
    createdAt: FRESH ? now : daysAgo(int(1, 33), 20),
    lastUsedAt: FRESH ? null : rnd() > 0.25 ? daysAgo(int(0, 6), 12) : null,
  }));

  // Wire the superseding pair explicitly — Brain Keeper's real work.
  const oldThreshold = memRows.find((m) => m.content.includes("10 gün olarak belirlendi"));
  const newThreshold = memRows.find((m) => m.content.includes("14 güne çıkarıldı"));
  if (oldThreshold && newThreshold) newThreshold.supersedes = oldThreshold.id!;

  await db.insert(memories).values(memRows);

  /* --- memory links: cluster by shared scope, so the graph has structure -- */
  const linkRows: (typeof memoryLinks.$inferInsert)[] = [];
  const seenPair = new Set<string>();
  for (const a of memRows) {
    const peers = memRows.filter(
      (b) =>
        b.id !== a.id &&
        b.scopes!.some((s) => s !== "global" && a.scopes!.includes(s)),
    );
    for (const b of peers.slice(0, 3)) {
      const key = [a.id, b.id].sort().join("|");
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      linkRows.push({ id: randomUUID(), fromId: a.id!, toId: b.id!, kind: "relates" });
    }
  }
  if (oldThreshold && newThreshold) {
    linkRows.push({
      id: randomUUID(),
      fromId: newThreshold.id!,
      toId: oldThreshold.id!,
      kind: "supersedes",
    });
  }
  await db.insert(memoryLinks).values(linkRows);
  console.log(`· ${memRows.length} memories · ${linkRows.length} links`);

  console.log(FRESH ? "\n✓ seeded (fresh) — npm run dev" : "\n✓ seeded — npm run dev");
  await closeDb();
}

const UNSURE = [
  "Telefon numarasının hâlâ aktif olduğunu doğrulayamadım.",
  "Sektör etiketi OSM'den geldi, güncel olmayabilir.",
  "Lighthouse tek seferlik ölçüm; ağ koşulları etkilemiş olabilir.",
  "İşletmenin zincire bağlı olup olmadığından emin değilim.",
  "Yanıtın karar vericiden geldiğini varsaydım, doğrulamadım.",
  "Tahmin geçmiş projelere dayanıyor, bu müşterinin verisi daha dağınık olabilir.",
];

function slug(name: string): string {
  return name
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 22);
}

/** Attribute a memory to a plausible author given its scopes. */
function pickWriter(scopes: string[], ids: string[]): string | null {
  const deptScope = scopes.find((s) => s.startsWith("dept."));
  const branchScope = scopes.find((s) => s.startsWith("branch."));
  if (deptScope && branchScope) {
    const branch = branchScope.split(".")[1];
    const d = deptScope.split(".")[1];
    const candidates = ids.filter((i) => i.startsWith(`${branch}.${d}.`));
    if (candidates.length) return pick(candidates);
  }
  if (branchScope) {
    const branch = branchScope.split(".")[1];
    const candidates = ids.filter((i) => i.startsWith(`${branch}.`));
    if (candidates.length) return pick(candidates);
  }
  return "shared.services.brain_keeper";
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
