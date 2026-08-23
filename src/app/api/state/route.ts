import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activity, approvals, tasks } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * The smallest thing a page can poll to learn that something moved.
 *
 * The panel used to *look* live — breathing dots, a travelling cable dot — over
 * a server-rendered frame that never changed until the owner reloaded. This is
 * the opposite trade: almost no animation, and a real 5-second check that
 * refreshes the page when the underlying counts change.
 *
 * Four counts and one id, chosen because they cover every visible change on
 * Bugün: a task starting or finishing, a question parked or answered, an
 * approval settled, and any new agent action. Anything else the owner sees is
 * downstream of one of those.
 */
export async function GET() {
  try {
    const db = await getDb();
    const [[running], [parked], [pending], [last]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.status, "running")),
      db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.status, "waiting_owner")),
      db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(eq(approvals.state, "pending")),
      db.select({ id: activity.id }).from(activity).orderBy(desc(activity.startedAt)).limit(1),
    ]);

    return NextResponse.json({
      running: running?.n ?? 0,
      parked: parked?.n ?? 0,
      pending: pending?.n ?? 0,
      lastActivity: last?.id ?? null,
    });
  } catch (err) {
    // A polling endpoint that 500s would make the client retry forever against
    // a database that is already unhappy. Report it and let the client hold.
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }
}
