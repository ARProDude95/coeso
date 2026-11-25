import "server-only";
import { getDb } from "./d1";
import { toOffer, type OfferRow } from "./offers";
import type { Deal, DealWithOffer, Offer } from "./types";
import type { DealInput } from "./validation";

/**
 * Rep performance profile (feature 5). One log per rep per offer, upserted so
 * editing is idempotent; a partner confirmation survives edits only until the
 * numbers change (then it is cleared and has to be re-confirmed).
 */

export interface DealRow {
  id: string;
  user_id: string;
  offer_id: string;
  deals_closed: number;
  month: string;
  earnings_min: number | null;
  earnings_max: number | null;
  partner_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

function toDeal(row: DealRow): Deal {
  return {
    id: row.id,
    userId: row.user_id,
    offerId: row.offer_id,
    dealsClosed: row.deals_closed,
    month: row.month,
    earningsMin: row.earnings_min,
    earningsMax: row.earnings_max,
    partnerConfirmedAt: row.partner_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DEAL_COLUMNS =
  "id, user_id, offer_id, deals_closed, month, earnings_min, earnings_max, " +
  "partner_confirmed_at, created_at, updated_at";

/** The rep's own logs, joined with the offer they belong to. */
export async function listDealsForUser(
  userId: string,
): Promise<DealWithOffer[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT d.id, d.user_id, d.offer_id, d.deals_closed, d.month,
              d.earnings_min, d.earnings_max, d.partner_confirmed_at,
              d.created_at, d.updated_at,
              o.title AS offer_title, o.company AS offer_company,
              o.status AS offer_status
         FROM deals d
         JOIN offers o ON o.id = d.offer_id
        WHERE d.user_id = ?
        ORDER BY d.updated_at DESC`,
    )
    .bind(userId)
    .all<
      DealRow & {
        offer_title: string;
        offer_company: string;
        offer_status: Offer["status"];
      }
    >();

  return (results ?? []).map((row) => ({
    ...toDeal(row),
    offer: {
      id: row.offer_id,
      title: row.offer_title,
      company: row.offer_company,
      status: row.offer_status,
    },
  }));
}

/** Logs on one offer, with the rep behind each — the partner/admin view. */
export interface DealWithRep extends Deal {
  repName: string;
  repUsername: string;
}

export async function listDealsForOffer(
  offerId: string,
): Promise<DealWithRep[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT d.*, u.name AS rep_name, u.username AS rep_username
         FROM deals d
         JOIN users u ON u.id = d.user_id
        WHERE d.offer_id = ?
        ORDER BY d.updated_at DESC`,
    )
    .bind(offerId)
    .all<DealRow & { rep_name: string; rep_username: string | null }>();

  return (results ?? []).map((row) => ({
    ...toDeal(row),
    repName: row.rep_name,
    repUsername: row.rep_username ?? row.user_id,
  }));
}

/**
 * Offers a rep may log results against: the ones where their application was
 * accepted (the same bar as writing a review — documented in PROGRESS.md).
 */
export async function listWorkableOffers(userId: string): Promise<Offer[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT o.*,
              (SELECT COUNT(*) FROM applications a2 WHERE a2.offer_id = o.id)
                AS application_count
         FROM offers o
         JOIN applications a ON a.offer_id = o.id
        WHERE a.user_id = ? AND a.status = 'accepted'
        ORDER BY o.created_at DESC`,
    )
    .bind(userId)
    .all<OfferRow>();
  return (results ?? []).map(toOffer);
}

export async function getDeal(id: string): Promise<Deal | null> {
  const db = await getDb();
  const row = await db
    .prepare(`SELECT ${DEAL_COLUMNS} FROM deals WHERE id = ?`)
    .bind(id)
    .first<DealRow>();
  return row ? toDeal(row) : null;
}

/**
 * Creates or updates the rep's log for one offer. The unique (user, offer)
 * index makes the upsert safe under concurrent submits. Changing the numbers
 * clears any earlier partner confirmation.
 */
export async function upsertDeal(
  userId: string,
  input: DealInput & { month: string },
): Promise<Deal> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO deals (
         id, user_id, offer_id, deals_closed, month, earnings_min,
         earnings_max, partner_confirmed_at, partner_confirmed_by,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
       ON CONFLICT(user_id, offer_id, month) DO UPDATE SET
         deals_closed = excluded.deals_closed,
         earnings_min = excluded.earnings_min,
         earnings_max = excluded.earnings_max,
         partner_confirmed_at = NULL,
         partner_confirmed_by = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      input.offerId,
      input.dealsClosed,
      input.month,
      input.earningsMin,
      input.earningsMax,
      now,
      now,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT ${DEAL_COLUMNS} FROM deals
        WHERE user_id = ? AND offer_id = ? AND month = ?`,
    )
    .bind(userId, input.offerId, input.month)
    .first<DealRow>();
  if (!row) throw new Error("upsertDeal: insert did not return a row");
  return toDeal(row);
}

export async function deleteDeal(id: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .prepare("DELETE FROM deals WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Partner confirmation. Idempotent: confirming an already-confirmed log keeps
 * the first timestamp, so the button can be pressed twice safely.
 */
export async function confirmDeal(
  id: string,
  confirmedBy: string,
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .prepare(
      `UPDATE deals
          SET partner_confirmed_at = COALESCE(partner_confirmed_at, ?),
              partner_confirmed_by = COALESCE(partner_confirmed_by, ?)
        WHERE id = ?`,
    )
    .bind(new Date().toISOString(), confirmedBy, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Average partner rating for a rep: the mean of the review scores left on the
 * offers they worked (PROGRESS #16 documents why no separate rep rating).
 */
export async function getRepRating(userId: string): Promise<number | null> {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT AVG((r.payout_rating + r.lead_rating + r.support_rating) / 3.0)
              AS rating
         FROM offer_reviews r
        WHERE r.offer_id IN (SELECT offer_id FROM deals WHERE user_id = ?)`,
    )
    .bind(userId)
    .first<{ rating: number | null }>();
  if (row?.rating === null || row?.rating === undefined) return null;
  return Math.round(row.rating * 10) / 10;
}
