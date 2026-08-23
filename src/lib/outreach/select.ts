import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { leads, type Branch, type Lead } from "@/db/schema";
import { planFor, type Plan } from "./plan";

/**
 * Who gets contacted today, decided in code rather than by a model.
 *
 * This matters more than it looks. If the day's list were assembled inside an
 * agent turn, "bugün 7 tane at" would be a suggestion the model could round up
 * on a good day — and a cap that a model can exceed is not a cap. Here the
 * count is a `LIMIT`.
 *
 * **Mail or call is decided by what we can actually reach, not by branch.**
 * The two line up almost always — `qualifiesForWeb` means no website, and a
 * business with no website has no discoverable email — but almost is not
 * always: Scout sometimes finds an address on a Facebook page for a web lead.
 * Splitting on the address itself means that lead gets a mail instead of being
 * filed as unreachable, and nothing has to be kept in sync.
 */

export type Selection = {
  plan: Plan;
  /** Reachable by email — these become drafts behind the approval gate. */
  mail: Lead[];
  /** No email, but a phone — these become a call list for the owner himself. */
  call: Lead[];
  /** What the pool looked like, so a short list reads as a finding not a bug. */
  note: string;
};

/** Never contacted, never rejected outright — the pool a day is drawn from. */
function open(branch: Branch | null) {
  return and(
    isNull(leads.contactedAt),
    isNull(leads.rejectedAt),
    branch ? eq(leads.branch, branch) : undefined,
  );
}

export async function selectForDay(day?: string): Promise<Selection> {
  const plan = await planFor(day);
  const db = await getDb();

  if (plan.skip) {
    return { plan, mail: [], call: [], note: "Bugün için gönderim kapalı." };
  }

  // A branch directive narrows which *pool* is drawn from, so "bugün sadece
  // web" yields calls and no mail — which is what web-branch outreach is.
  const wantMail = plan.mailCount > 0;
  const wantCall = plan.callCount > 0;

  const [mail, call, totals] = await Promise.all([
    wantMail
      ? db
          .select()
          .from(leads)
          .where(and(open(plan.branch), isNotNull(leads.email)))
          .orderBy(desc(leads.fitScore), desc(leads.createdAt))
          .limit(plan.mailCount)
      : Promise.resolve([] as Lead[]),
    wantCall
      ? db
          .select()
          .from(leads)
          .where(and(open(plan.branch), isNull(leads.email), isNotNull(leads.phone)))
          .orderBy(desc(leads.fitScore), desc(leads.createdAt))
          .limit(plan.callCount)
      : Promise.resolve([] as Lead[]),
    db
      .select({
        mailable: sql<number>`count(*) filter (where ${leads.email} is not null)::int`,
        callable: sql<number>`count(*) filter (where ${leads.email} is null and ${leads.phone} is not null)::int`,
      })
      .from(leads)
      .where(open(plan.branch)),
  ]);

  const pool = totals[0] ?? { mailable: 0, callable: 0 };
  const parts: string[] = [];
  // Say when the pool is the constraint rather than the plan. A day that
  // produces 3 of 10 is a fact about the lead list, and reporting it as a
  // finding is what gets Scout pointed at a new city.
  if (wantMail && mail.length < plan.mailCount) {
    parts.push(`mail: havuzda ${pool.mailable} uygun lead var, ${plan.mailCount} isteniyordu`);
  }
  if (wantCall && call.length < plan.callCount) {
    parts.push(`arama: havuzda ${pool.callable} uygun lead var, ${plan.callCount} isteniyordu`);
  }

  return {
    plan,
    mail,
    call,
    note: parts.length > 0 ? parts.join(" · ") : `${mail.length} mail · ${call.length} arama seçildi`,
  };
}

/** One line the writer can act on: who, where, and what went wrong last time. */
export function briefLead(lead: Lead): string {
  const bits = [
    lead.company,
    lead.city,
    lead.sector,
    lead.reviewCount !== null ? `${lead.reviewCount} yorum` : null,
    lead.website ? `site: ${lead.website}` : "sitesi yok",
    lead.email ? `e-posta: ${lead.email}` : null,
    lead.phone ? `tel: ${lead.phone}` : null,
  ].filter(Boolean);
  const thesis = lead.thesis ? `\n    Tez: ${lead.thesis}` : "";
  // The correction the owner gave last time this lead came up. Handing it to
  // the writer is the whole point of keeping a rejected-with-reason lead in the
  // pool: without it, tomorrow's draft repeats today's mistake.
  const fix = lead.rejectionNote ? `\n    ⚠️ Sahip geçen sefer reddetti: "${lead.rejectionNote}" — bunu düzelt.` : "";
  return `${bits.join(" · ")}${thesis}${fix}`;
}
