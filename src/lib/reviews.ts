import "server-only";
import { ApiError } from "./api";
import { getDb } from "./d1";
import type { ReviewInput } from "./validation";

/**
 * Offer reviews (Elite feature, feature 2). Eligibility is deliberately split:
 * the *decision* is a pure function (unit-tested), the database does the rest,
 * and comment visibility is decided per viewer on read so an Elite-only field
 * never reaches a free/pro response body.
 */

export interface Review {
  id: string;
  offerId: string;
  userId: string;
  reviewerName: string;
  payoutRating: number;
  leadRating: number;
  supportRating: number;
  comment: string;
  createdAt: string;
}

export interface ReviewSummary {
  count: number;
  payout: number;
  lead: number;
  support: number;
  overall: number;
}

interface ReviewRow {
  id: string;
  offer_id: string;
  user_id: string;
  name: string | null;
  payout_rating: number;
  lead_rating: number;
  support_rating: number;
  comment: string;
  created_at: string;
}

function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    offerId: row.offer_id,
    userId: row.user_id,
    reviewerName: row.name ?? "Member",
    payoutRating: row.payout_rating,
    leadRating: row.lead_rating,
    supportRating: row.support_rating,
    comment: row.comment ?? "",
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ *
 * Pure logic (tested directly)
 * ------------------------------------------------------------------ */

export interface EligibilityInput {
  /** The viewer has an accepted application on this offer. */
  hasAcceptedApplication: boolean;
  tier: "free" | "pro" | "elite";
  isAdmin: boolean;
}

export interface Eligibility {
  can: boolean;
  /** Machine-stable reason code the UI maps to copy. */
  code: "ok" | "not_accepted" | "tier_required";
}

/**
 * Who may write a review: an accepted application is required of everyone
 * (it is the point of the feature), and writing needs the Elite tier — admins
 * bypass the tier gate per the codebase-wide convention (PROGRESS #13).
 */
export function reviewEligibility(input: EligibilityInput): Eligibility {
  if (!input.hasAcceptedApplication) return { can: false, code: "not_accepted" };
  if (input.tier !== "elite" && !input.isAdmin) {
    return { can: false, code: "tier_required" };
  }
  return { can: true, code: "ok" };
}

/** Averages over reviews; `null` when there are none yet. */
export function summariseReviews(
  reviews: Pick<Review, "payoutRating" | "leadRating" | "supportRating">[],
): ReviewSummary | null {
  if (reviews.length === 0) return null;

  const total = (key: "payoutRating" | "leadRating" | "supportRating") =>
    reviews.reduce((sum, review) => sum + review[key], 0);

  const round = (value: number) => Math.round((value / reviews.length) * 10) / 10;
  const payout = round(total("payoutRating"));
  const lead = round(total("leadRating"));
  const support = round(total("supportRating"));

  return {
    count: reviews.length,
    payout,
    lead,
    support,
    overall: Math.round(((payout + lead + support) / 3) * 10) / 10,
  };
}

/* ------------------------------------------------------------------ *
 * Data access
 * ------------------------------------------------------------------ */

export async function hasAcceptedApplication(
  offerId: string,
  userId: string,
): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM applications
        WHERE offer_id = ? AND user_id = ? AND status = 'accepted'`,
    )
    .bind(offerId, userId)
    .first<{ count: number }>();
  return (row?.count ?? 0) > 0;
}

export async function getReview(
  offerId: string,
  userId: string,
): Promise<Review | null> {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT r.*, u.name
         FROM offer_reviews r
         JOIN users u ON u.id = r.user_id
        WHERE r.offer_id = ? AND r.user_id = ?`,
    )
    .bind(offerId, userId)
    .first<ReviewRow>();
  return row ? toReview(row) : null;
}

/**
 * Every review's ratings (comments included — callers decide visibility) plus
 * the viewer's own row in one round trip each.
 */
export async function listReviews(offerId: string): Promise<Review[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT r.*, u.name
         FROM offer_reviews r
         JOIN users u ON u.id = r.user_id
        WHERE r.offer_id = ?
        ORDER BY r.created_at DESC`,
    )
    .bind(offerId)
    .all<ReviewRow>();
  return (results ?? []).map(toReview);
}

export async function summariseOfferReviews(
  offerId: string,
): Promise<ReviewSummary | null> {
  const reviews = await listReviews(offerId);
  return summariseReviews(reviews);
}

/** Throws 403/409 with stable codes; returns the stored review on success. */
export async function createReview(
  offerId: string,
  userId: string,
  eligibility: Eligibility,
  input: ReviewInput,
): Promise<Review> {
  if (!eligibility.can) {
    if (eligibility.code === "tier_required") {
      throw new ApiError(403, "Reviews are an Elite feature", "tier_required");
    }
    throw new ApiError(
      403,
      "Only members with an accepted application can review this offer",
      "not_accepted",
    );
  }

  const db = await getDb();
  const now = new Date().toISOString();

  const result = await db
    .prepare(
      `INSERT INTO offer_reviews
         (id, offer_id, user_id, payout_rating, lead_rating, support_rating,
          comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      offerId,
      userId,
      input.payoutRating,
      input.leadRating,
      input.supportRating,
      input.comment,
      now,
      now,
    )
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    throw new ApiError(409, "You have already reviewed this offer", "already_reviewed");
  }

  const review = await getReview(offerId, userId);
  if (!review) throw new ApiError(500, "Review could not be read", "internal");
  return review;
}

/** Duplicate inserts also surface from the unique index as 409. */
export function isDuplicateReviewError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}
