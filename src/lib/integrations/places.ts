/**
 * Lead discovery through the Google Places API (§2).
 *
 * Both branches source from here. The two ICPs turn on fields this endpoint
 * returns directly — whether a business has a website, and how many Google
 * reviews it has — so the filtering is real rather than guessed from a name.
 *
 * **Cost is a field mask.** Places charges by which fields you ask for, not
 * just by request count. The mask below is the minimum both ICPs need; adding
 * to it raises the per-search price, so add deliberately.
 *
 * **Retention.** Google's terms allow caching place *content* only
 * temporarily, while place IDs may be stored indefinitely. `pruneLeads()`
 * below enforces the owner's rule: an untouched lead is Google's data sitting
 * in our database and is deleted after 30 days; a lead we actually contacted,
 * or that became a deal, is a record of our own business relationship and stays.
 */

import { and, eq, isNull, lt, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { deals, leads } from "@/db/schema";

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const TIMEOUT_MS = 20_000;

/** Exactly what the two ICPs need. Every extra field costs money per search. */
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.userRatingCount",
  "places.rating",
  "places.primaryTypeDisplayName",
].join(",");

/** Untouched leads are deleted after this. Contacted ones are never deleted. */
export const RETENTION_DAYS = 30;

export type Place = {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  reviewCount: number;
  rating: number | null;
  category: string | null;
};

export type PlacesResult = { ok: true; places: Place[] } | { ok: false; reason: string };

export function placesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  userRatingCount?: number;
  rating?: number;
  primaryTypeDisplayName?: { text?: string };
};

/**
 * Text search, e.g. "Antalya'da balık restoranı".
 *
 * `maxResults` is capped at 20 by the API per page. Paging costs another
 * search, so the caller asks for what it will actually work through.
 */
export async function searchPlaces(options: {
  query: string;
  maxResults?: number;
  languageCode?: string;
  regionCode?: string;
}): Promise<PlacesResult> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { ok: false, reason: "GOOGLE_PLACES_API_KEY tanımlı değil" };

  let body: { places?: RawPlace[]; error?: { message?: string } };
  try {
    const res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: options.query,
        maxResultCount: Math.min(20, Math.max(1, options.maxResults ?? 20)),
        languageCode: options.languageCode ?? "tr",
        regionCode: options.regionCode ?? "TR",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = await res.json();
    if (!res.ok) {
      return { ok: false, reason: body.error?.message ?? `Places ${res.status}` };
    }
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  const places: Place[] = (body.places ?? [])
    .filter((p): p is RawPlace & { id: string } => Boolean(p.id))
    .map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? "(isimsiz)",
      address: p.formattedAddress ?? null,
      phone: p.nationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
      // Absent means zero, which is a disqualification — not unknown.
      reviewCount: p.userRatingCount ?? 0,
      rating: p.rating ?? null,
      category: p.primaryTypeDisplayName?.text ?? null,
    }));

  return { ok: true, places };
}

/**
 * ICP A: no website at all, and at least one review.
 *
 * Both halves matter. A business with a site is out however good it looks, and
 * zero reviews means too small for this work rather than merely unproven.
 */
export function qualifiesForWeb(place: Place): boolean {
  return !place.website && place.reviewCount > 0;
}

/**
 * ICP B qualifies on whether n8n can reach the systems a business already runs,
 * which no Places field reports. All this can do is clear the shared floor —
 * the real judgement belongs to Dossier, on evidence.
 */
export function passesAutomationFloor(place: Place): boolean {
  return place.reviewCount > 0;
}

export type PruneResult = { deleted: number; kept: number; cutoff: Date };

/**
 * Deletes untouched leads older than the retention window.
 *
 * Kept regardless of age: anything with `contactedAt` set, and anything a deal
 * points at — including a lost deal, because losing one is part of the
 * relationship history that makes the next attempt smarter.
 *
 * Safe to run repeatedly; it only ever removes rows that already qualify.
 */
export async function pruneLeads(now = new Date(), retentionDays = RETENTION_DAYS): Promise<PruneResult> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);

  const linked = await db
    .select({ leadId: deals.leadId })
    .from(deals)
    .where(sql`${deals.leadId} is not null`);
  const protectedIds = linked.map((r) => r.leadId).filter((id): id is string => Boolean(id));

  const condition = and(
    isNull(leads.contactedAt),
    lt(leads.createdAt, cutoff),
    protectedIds.length > 0 ? notInArray(leads.id, protectedIds) : undefined,
  );

  const doomed = await db.select({ id: leads.id }).from(leads).where(condition);
  for (const row of doomed) {
    await db.delete(leads).where(eq(leads.id, row.id));
  }

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(leads);
  return { deleted: doomed.length, kept: n, cutoff };
}

/** Records that outreach reached this lead, which exempts it from pruning. */
export async function markContacted(leadId: string, at = new Date()): Promise<void> {
  const db = await getDb();
  await db.update(leads).set({ contactedAt: at }).where(eq(leads.id, leadId));
}
