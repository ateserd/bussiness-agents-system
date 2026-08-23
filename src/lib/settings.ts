import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";

/**
 * Every business value that used to be frozen in a YAML file, a prompt or a
 * `const`.
 *
 * The owner's rule: he never edits a hardcoded number by hand. He says "günlük
 * mail sayısını 15 yap" on Telegram and it changes. So each value needs three
 * things travelling together — a default, a valid range, and a Turkish label —
 * and that is what the catalogue below is.
 *
 * The catalogue is in code and the table is only an override layer. That
 * ordering matters: a database with zero rows still boots with every default
 * intact, `getSetting` can never fail or return undefined, and a value that is
 * still at its default costs no row. It also means the valid range is versioned
 * with the code that depends on it, so "500 yap" is refused by the schema
 * rather than by a rule someone has to remember.
 */

type BaseDef = {
  /** Shown to the owner on Telegram and in the dashboard. Turkish. */
  label: string;
  /**
   * True only where a change would weaken a safety guarantee. Those need an
   * explicit yes/no round-trip rather than a single sentence. Deliberately a
   * short list: the daily send cap is NOT on it, because changing that in one
   * sentence is the owner's own headline example of what this system is for.
   */
  ownerConfirm?: boolean;
};

export type SettingDef =
  | (BaseDef & { type: "number"; value: number; min: number; max: number })
  | (BaseDef & { type: "string"; value: string })
  | (BaseDef & { type: "boolean"; value: boolean })
  | (BaseDef & { type: "enum"; value: string; allowed: readonly string[] });

export const CATALOGUE = {
  "outreach.daily_cap_per_mailbox": {
    type: "number",
    value: 10,
    min: 1,
    max: 50,
    label: "Gönderen kutu başına günlük mail",
  },
  "outreach.approval_mode": {
    type: "enum",
    value: "batch",
    allowed: ["batch", "per_item"],
    label: "Onay biçimi (toplu / tek tek)",
    ownerConfirm: true,
  },
  "outreach.batch_time": {
    type: "string",
    value: "09:00",
    label: "Günlük gönderim partisinin hazırlanma saati",
  },
  "lead.stale_days": { type: "number", value: 14, min: 1, max: 90, label: "Lead bayatlama günü" },
  "lead.retention_days": {
    type: "number",
    value: 30,
    min: 7,
    max: 365,
    label: "Dokunulmamış lead saklama günü",
  },
  "deal.stale_days": { type: "number", value: 14, min: 1, max: 90, label: "Fırsat bayatlama günü" },
  "client.quiet_days": {
    type: "number",
    value: 30,
    min: 7,
    max: 365,
    label: "Müşteri sessizlik eşiği (brifingde hatırlatılır)",
  },
  "brief.time": { type: "string", value: "07:30", label: "Sabah brifingi saati" },
  "brief.evening_time": { type: "string", value: "19:00", label: "Akşam özeti saati" },
  "fx.source": {
    type: "enum",
    value: "tcmb",
    allowed: ["tcmb", "erapi"],
    label: "Döviz kuru kaynağı (tcmb / erapi)",
  },
  "owner.timezone": {
    type: "string",
    value: "Europe/Istanbul",
    label: "Takvim saat dilimi",
  },
  "agent.max_cost_usd": {
    type: "number",
    value: 0.5,
    min: 0.01,
    max: 10,
    label: "Tek çalışma maliyet tavanı (USD)",
    ownerConfirm: true,
  },
  "escalation.ceiling_usd": {
    type: "number",
    value: 0,
    min: 0,
    max: 100_000,
    label: "Sormadan harcanabilecek tavan (USD)",
    ownerConfirm: true,
  },
  "runtime.concurrency": {
    type: "number",
    value: 3,
    min: 1,
    max: 8,
    label: "Aynı anda çalışabilecek görev sayısı",
  },
  "scout.weekly_lead_target": {
    type: "number",
    value: 50,
    min: 1,
    max: 500,
    label: "Haftalık lead hedefi",
  },
  "meeting.default_duration_min": {
    type: "number",
    value: 30,
    min: 15,
    max: 180,
    label: "Varsayılan toplantı süresi (dk)",
  },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof CATALOGUE;

type ValueFor<K extends SettingKey> = (typeof CATALOGUE)[K] extends { type: "number" }
  ? number
  : (typeof CATALOGUE)[K] extends { type: "boolean" }
    ? boolean
    : string;

export function isSettingKey(key: string): key is SettingKey {
  return key in CATALOGUE;
}

export function settingKeys(): SettingKey[] {
  return Object.keys(CATALOGUE) as SettingKey[];
}

/** Text → typed value, or null when the stored text no longer fits the def. */
function parse(def: SettingDef, raw: string): number | boolean | string | null {
  switch (def.type) {
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < def.min || n > def.max) return null;
      return n;
    }
    case "boolean": {
      const t = raw.trim().toLowerCase();
      if (["true", "1", "evet", "açık", "acik"].includes(t)) return true;
      if (["false", "0", "hayır", "hayir", "kapalı", "kapali"].includes(t)) return false;
      return null;
    }
    case "enum":
      return def.allowed.includes(raw) ? raw : null;
    case "string":
      return raw;
  }
}

/**
 * The current value, always. A missing row, a row left behind by an older
 * catalogue, or a value that no longer passes validation all fall back to the
 * default rather than throwing — a settings table should never be able to take
 * the system down.
 */
export async function getSetting<K extends SettingKey>(key: K): Promise<ValueFor<K>> {
  const def: SettingDef = CATALOGUE[key];
  try {
    const db = await getDb();
    const [row] = await db.select().from(settings).where(eq(settings.key, key));
    if (row) {
      const parsed = parse(def, row.value);
      if (parsed !== null) return parsed as ValueFor<K>;
      console.warn(`· setting "${key}" holds an invalid value (${row.value}) — using the default`);
    }
  } catch (err) {
    console.warn(`· settings unreadable for "${key}" (${(err as Error).message}) — using the default`);
  }
  return def.value as ValueFor<K>;
}

export type SettingView = {
  key: SettingKey;
  value: number | boolean | string;
  isDefault: boolean;
  def: SettingDef;
  updatedAt: Date | null;
  updatedBy: string | null;
};

/** The whole catalogue with overrides applied — one query, for the system map. */
export async function allSettings(): Promise<SettingView[]> {
  let rows: (typeof settings.$inferSelect)[] = [];
  try {
    const db = await getDb();
    rows = await db.select().from(settings);
  } catch {
    // An unreachable table means "everything is at its default", not an error.
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return settingKeys().map((key) => {
    const def: SettingDef = CATALOGUE[key];
    const row = byKey.get(key);
    const parsed = row ? parse(def, row.value) : null;
    return {
      key,
      value: parsed ?? def.value,
      // A row holding the default value is still at its default. Without the
      // second half, setting 15 and then setting 10 back leaves the key listed
      // under "yalnızca varsayılandan farklı olanlar" forever, showing a value
      // identical to the default under a heading that says it differs.
      isDefault: parsed === null || parsed === def.value,
      def,
      updatedAt: parsed !== null && row ? row.updatedAt : null,
      updatedBy: parsed !== null && row ? row.updatedBy : null,
    };
  });
}

/** What a rejected value should have looked like, in the owner's language. */
function expectedShape(def: SettingDef): string {
  switch (def.type) {
    case "number":
      return `${def.min}–${def.max} arası bir sayı`;
    case "enum":
      return def.allowed.join(" | ");
    case "boolean":
      return "evet / hayır";
    case "string":
      return "bir metin";
  }
}

export type SetResult =
  | { ok: true; key: SettingKey; from: number | boolean | string; to: number | boolean | string; label: string }
  | { ok: false; reason: string };

/**
 * Validates against the catalogue, then writes. Range lives in the definition,
 * so an out-of-range request is refused by data rather than by prose in a
 * prompt the model may or may not have followed.
 */
export async function setSetting(key: string, raw: string, by: string): Promise<SetResult> {
  if (!isSettingKey(key)) {
    return { ok: false, reason: `"${key}" diye bir ayar yok. Bilinenler: ${settingKeys().join(", ")}` };
  }
  const def: SettingDef = CATALOGUE[key];
  const parsed = parse(def, raw.trim());
  if (parsed === null) {
    return { ok: false, reason: `"${raw}" geçersiz — ${def.label} için ${expectedShape(def)} bekleniyor.` };
  }

  const from = await getSetting(key);
  const db = await getDb();
  await db
    .insert(settings)
    .values({ key, value: String(parsed), type: def.type, updatedAt: new Date(), updatedBy: by })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(parsed), type: def.type, updatedAt: new Date(), updatedBy: by },
    });

  return { ok: true, key, from, to: parsed, label: def.label };
}

/** True when changing this key should cost an explicit confirmation. */
export function needsOwnerConfirm(key: SettingKey): boolean {
  const def: SettingDef = CATALOGUE[key];
  return def.ownerConfirm === true;
}
