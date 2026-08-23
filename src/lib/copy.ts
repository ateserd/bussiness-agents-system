/**
 * Every user-facing string in the system, in one place.
 *
 * The interface is Turkish; code, identifiers and comments are English. The
 * four view names (COMMAND / BRAIN / ACTIVITY / LEDGER) and the MISSION CONTROL
 * wordmark stay English on purpose — they are the product's own vocabulary, the
 * way a console's stations are named. To translate them too, edit `nav` and
 * `wordmark` below and nothing else changes.
 */

export const copy = {
  wordmark: { lead: "Mission", tail: "Control" },
  tagline: "Ateş Design Agency · Ateş Flow Agency",

  nav: {
    command: "Command",
    brain: "Brain",
    activity: "Activity",
    ledger: "Ledger",
  },

  branch: {
    all: "Tümü",
    web: "Web",
    automation: "AI Otomasyon",
    webFull: "Ateş Design Agency",
    automationFull: "Ateş Flow Agency",
    sharedFull: "Ortak servisler",
  },

  tier: {
    owner: "Owner · The Human",
  },

  status: {
    idle: "Boşta",
    working: "Çalışıyor",
    blocked: "Engelli",
    needs_approval: "Onay bekliyor",
    paused: "Duraklatıldı",
  },

  outcome: {
    success: "Tamam",
    failure: "Hata",
    blocked: "Engelli",
    needs_approval: "Onay bekliyor",
    running: "Sürüyor",
  },

  autonomy: {
    observe: "İzler",
    propose: "Önerir",
    act_with_log: "Yapar, kaydeder",
    act_freely: "Serbest",
  },

  department: {
    outreach: "Outreach",
    sales: "Sales",
    shared: "Ortak",
  },

  command: {
    sharedMemory: "Paylaşılan hafıza",
    memoriesSuffix: "anı",
    openBrain: "beyni aç →",
    hint: "sürükle · tekerlek yakınlaştırır · F sığdırır · 1 / 2 şube",
    approvalTray: "Onayını bekleyen",
    blockedTray: "Engellenen",
    noApprovals: "Bekleyen onay yok.",
    noBlocked: "Engellenen ajan yok.",
  },

  drawer: {
    mission: "Görev",
    config: "Yapılandırma",
    kpis: "Hedefler",
    memories: "Hafızası",
    log: "Son hareketler",
    runNow: "Şimdi çalıştır",
    pause: "Duraklat",
    resume: "Sürdür",
    chat: "Ajanla konuş",
    reportsTo: "Bağlı olduğu",
    model: "Model",
    tools: "Araçlar",
    scopes: "Hafıza kapsamı",
    schedule: "Program",
    autonomy: "Yetki",
    gates: "Onay gerektirenler",
    escalate: "Sana taşır",
    nextRun: "Sıradaki çalışma",
    lastRun: "Son çalışma",
    noRuns: "Henüz çalışmadı.",
    noMemories: "Bu ajanın yazdığı anı yok.",
    close: "Kapat",
    chatSoon: "Sohbet arayüzü henüz bağlı değil — bkz. SETUP_TODO.md",
  },

  activity: {
    title: "Hareketler",
    subtitle: "Her ajan hareketi buraya düşer: kim, ne, neden, ne kadar sürdü, ne kadar tuttu.",
    filterBranch: "Şube",
    filterDepartment: "Bölüm",
    filterAgent: "Ajan",
    filterOutcome: "Sonuç",
    all: "Hepsi",
    empty: "Bu filtreyle eşleşen hareket yok.",
    input: "Girdi",
    output: "Çıktı",
    reason: "Gerekçe",
    unsure: "Emin olmadığı nokta",
    simulated: "Simüle",
    deletedAgent: "silinmiş ajan",
  },

  ledger: {
    title: "Defter",
    subtitle: "Şube başına skor tablosu. Bir kaynak bağlı değilse sayı uydurulmaz.",
    combined: "Toplam",
    revenueMtd: "Bu ay ciro",
    cashCollected: "Tahsil edilen",
    pipelineValue: "Açık hat değeri",
    liveProjects: "Canlı proje",
    unpaidInvoices: "Ödenmemiş fatura",
    agentCost: "Ajan maliyeti",
    expensesMtd: "Bu ay gider",
    netMtd: "Net",
    trend: "12 haftalık seyir",
    unavailable: "kaynak bağlı değil",
  },

  brain: {
    title: "Beyin",
    subtitle: "Tek hafıza. Her ajan okur, her ajan yazar, kimsenin özeli yok.",
    search: "Hafızada ara…",
    memories: "anı",
    facts: "kalıcı gerçek",
    clients: "müşteri",
    links: "bağ",
    scope: "Kapsam",
    confidence: "Güven",
    writtenBy: "Yazan",
    used: "Kullanım",
    created: "Yazıldı",
    lastUsed: "Son kullanım",
    permanent: "Kalıcı",
    supersedes: "Şunun yerine geçti",
    pick: "Bir düğüme tıkla.",
    delete: "Sil",
    deleteConfirm: "Emin misin? Geri alınamaz.",
    deleteCancel: "Vazgeç",
    addNote: "Bu kapsama not ekle",
    notePlaceholder: "Ajanların bu kapsamda görmesini istediğin bir şey yaz…",
    noteSubmit: "Ekle",
  },

  memoryKind: {
    fact: "gerçek",
    decision: "karar",
    preference: "tercih",
    client_context: "müşteri bağlamı",
    lesson: "ders",
    metric_snapshot: "ölçüm",
  },

  brief: {
    heading: "Günaydın brifingi",
    intro: "Önce sayılar, sonra sana düşenler.",
    web: "WEB",
    automation: "AI OTOMASYON",
    cash: "NAKİT",
    pipeline: "Hat",
    open: "açık",
    callsToday: "bugün görüşme",
    delivery: "Teslimat",
    projects: "proje",
    atRisk: "riskte",
    liveAutomations: "Canlı akış",
    healthy: "sağlıklı",
    erroring: "hatalı",
    collectedMtd: "Bu ay tahsil",
    unpaid: "Ödenmemiş",
    needsYou: "SANA DÜŞENLER",
    nothingNeedsYou: "Sana düşen bir şey yok.",
    unavailable: (source: string, reason: string) =>
      `⚠️ ${source} kullanılamıyor (${reason})`,
  },

  common: {
    loading: "Yükleniyor…",
    never: "hiç",
    none: "—",
    simulateBanner:
      "Simülasyon modu — ANTHROPIC_API_KEY yok, ajanlar model çağırmadan gerçek kayıt yazıyor.",
  },
} as const;

/** Turkish locale formatting, used everywhere numbers or dates are shown. */
export const fmt = {
  money(value: number, currency = "USD"): string {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency,
      maximumFractionDigits: value < 100 ? 2 : 0,
    }).format(value);
  },

  cost(value: number): string {
    if (value === 0) return "$0";
    if (value < 0.01) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(2)}`;
  },

  number(value: number): string {
    return new Intl.NumberFormat("tr-TR").format(value);
  },

  duration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms / 60_000)}dk`;
  },

  date(value: Date | string | null): string {
    if (!value) return copy.common.never;
    const d = typeof value === "string" ? new Date(value) : value;
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  },

  day(value: Date | string): string {
    const d = typeof value === "string" ? new Date(value) : value;
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "long",
      weekday: "long",
    }).format(d);
  },

  /** "3 dk önce" / "2 sa önce" / "4 gün önce" */
  ago(value: Date | string | null): string {
    if (!value) return copy.common.never;
    const d = typeof value === "string" ? new Date(value) : value;
    const diff = Date.now() - d.getTime();
    const mins = Math.round(diff / 60_000);
    if (mins < 1) return "az önce";
    if (mins < 60) return `${mins} dk önce`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} sa önce`;
    return `${Math.round(hours / 24)} gün önce`;
  },
};
