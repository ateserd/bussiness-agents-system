import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { outreachDays, type Branch } from "@/db/schema";
import { getSetting } from "@/lib/settings";

/**
 * What today's outreach should look like, when today is not like every day.
 *
 * The owner's ask: "bugün atma", "bugün 7 tane at" — said at any hour, in his
 * own words, and honoured by a job that runs the next morning. Nothing in the
 * system could hold that. A setting is permanent, so "bugün 7" would silently
 * become every day's 7. A task is a unit of work, and this is not work. The
 * Brain would need an agent to choose to read it.
 *
 * So a directive is a row that belongs to one day and is gone by the next. The
 * absence of a row is the normal case and means "the standing rule applies" —
 * which is why `planFor()` never returns null and never throws: it falls back
 * to the settings the same way `getSetting` falls back to its catalogue
 * default. A directive table must not be able to stop outreach by being empty
 * or unreachable.
 */

export type Plan = {
  day: string;
  mailCount: number;
  callCount: number;
  skip: boolean;
  branch: Branch | null;
  focus: string | null;
  /** True when a row exists — i.e. the owner said something about this day. */
  directed: boolean;
  /** What he actually said, for quoting back. Never paraphrased. */
  sourceText: string | null;
  /** The standing values, so a report can say "7 (senin isteğin), normalde 10". */
  defaults: { mailCount: number; callCount: number };
};

/** `YYYY-MM-DD` in the owner's timezone. His day, not UTC's. */
export function dayKey(date = new Date(), timeZone = "Europe/Istanbul"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function standing(): Promise<{ mailCount: number; callCount: number }> {
  const [mailCount, callCount] = await Promise.all([
    getSetting("outreach.daily_cap_per_mailbox"),
    getSetting("outreach.daily_calls"),
  ]);
  return { mailCount, callCount };
}

export async function planFor(day = dayKey()): Promise<Plan> {
  const defaults = await standing();
  const base: Plan = {
    day,
    mailCount: defaults.mailCount,
    callCount: defaults.callCount,
    skip: false,
    branch: null,
    focus: null,
    directed: false,
    sourceText: null,
    defaults,
  };

  try {
    const db = await getDb();
    const [row] = await db.select().from(outreachDays).where(eq(outreachDays.day, day));
    if (!row) return base;
    return {
      ...base,
      // `?? default` and not `|| default`: 0 is a real instruction ("bugün mail
      // atma ama aramaları ver"), and `||` would quietly turn it back into 10.
      mailCount: row.mailCount ?? defaults.mailCount,
      callCount: row.callCount ?? defaults.callCount,
      skip: row.skip,
      branch: row.branch ?? null,
      focus: row.focus ?? null,
      directed: true,
      sourceText: row.sourceText ?? null,
    };
  } catch (err) {
    console.warn(`· günlük outreach planı okunamadı (${(err as Error).message}) — ayarlar kullanılıyor`);
    return base;
  }
}

export type PlanPatch = {
  mailCount?: number | null;
  callCount?: number | null;
  skip?: boolean;
  branch?: Branch | null;
  focus?: string | null;
  sourceText?: string | null;
  saidBy?: string;
};

/**
 * Records a directive, merging with anything already said about that day —
 * "bugün 7 at" then "ve sadece web" is two sentences about one day, not two
 * competing plans.
 */
export async function setPlan(day: string, patch: PlanPatch): Promise<Plan> {
  const db = await getDb();
  const [existing] = await db.select().from(outreachDays).where(eq(outreachDays.day, day));

  const merged = {
    day,
    mailCount: patch.mailCount !== undefined ? patch.mailCount : (existing?.mailCount ?? null),
    callCount: patch.callCount !== undefined ? patch.callCount : (existing?.callCount ?? null),
    skip: patch.skip !== undefined ? patch.skip : (existing?.skip ?? false),
    branch: patch.branch !== undefined ? patch.branch : (existing?.branch ?? null),
    focus: patch.focus !== undefined ? patch.focus : (existing?.focus ?? null),
    saidBy: patch.saidBy ?? existing?.saidBy ?? "owner",
    saidAt: new Date(),
    sourceText: patch.sourceText ?? existing?.sourceText ?? null,
  };

  if (existing) {
    await db.update(outreachDays).set(merged).where(eq(outreachDays.day, day));
  } else {
    await db.insert(outreachDays).values(merged);
  }
  return planFor(day);
}

/** Drops the directive, returning the day to the standing rule. */
export async function clearPlan(day: string): Promise<void> {
  const db = await getDb();
  await db.delete(outreachDays).where(eq(outreachDays.day, day));
}

/** One line naming the plan and how it differs from the standing rule. */
export function describePlan(plan: Plan): string {
  if (plan.skip) return "Bugün gönderim yok — senin isteğin.";
  const mail =
    plan.mailCount === plan.defaults.mailCount
      ? `${plan.mailCount} mail`
      : `${plan.mailCount} mail (senin isteğin, normalde ${plan.defaults.mailCount})`;
  const call =
    plan.callCount === plan.defaults.callCount
      ? `${plan.callCount} arama`
      : `${plan.callCount} arama (senin isteğin, normalde ${plan.defaults.callCount})`;
  const only = plan.branch ? ` · yalnızca ${plan.branch === "web" ? "web" : "otomasyon"}` : "";
  const focus = plan.focus ? ` · odak: ${plan.focus}` : "";
  return `${mail} · ${call}${only}${focus}`;
}
