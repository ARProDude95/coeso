import type { Viewer } from "./roles";
import type { Offer } from "./types";

/**
 * Partner portal (feature 4): who may see and manage what.
 *
 * The decision functions are pure — no database, no `server-only` — because
 * partner data isolation is exactly what `tests/partners.test.ts` has to pin
 * down: a partner sees applicants only for their own offers and never another
 * partner's (or an admin's) data.
 */

/** Role slug granting partner access; assigned by the admin (PROGRESS #4). */
export const PARTNER_ROLE = "partner";

/** Approval states an offer can be in. */
export type ApprovalStatus = "approved" | "pending" | "rejected";

export function isPartnerRole(roles: string[]): boolean {
  return roles.includes(PARTNER_ROLE);
}

/** Normalises a possibly-missing/unknown column value. */
export function toApprovalStatus(value: string | null | undefined): ApprovalStatus {
  return value === "pending" || value === "rejected" ? value : "approved";
}

/**
 * Whether the viewer may edit an offer and see its applicants: admins may
 * manage everything, a partner only offers they themselves submitted
 * (`partnerId` null = admin-authored, never a partner's).
 */
export function canManageOffer(
  viewer: Pick<Viewer, "id" | "isAdmin" | "roles">,
  offer: Pick<Offer, "partnerId">,
): boolean {
  if (viewer.isAdmin) return true;
  if (!isPartnerRole(viewer.roles)) return false;
  return offer.partnerId !== null && offer.partnerId === viewer.id;
}

/**
 * Whether the viewer may see an offer at all: approved offers are public;
 * pending/rejected ones are visible only to admins and the owning partner
 * (so the partner can find their submission, and nobody else can).
 */
export function canViewOfferApproval(
  viewer: Pick<Viewer, "id" | "isAdmin" | "roles">,
  offer: Pick<Offer, "partnerId" | "approvalStatus">,
): boolean {
  if (offer.approvalStatus === "approved") return true;
  if (viewer.isAdmin) return true;
  return offer.partnerId !== null && offer.partnerId === viewer.id;
}

/**
 * Approval is an admin action — partners can submit, never approve. Also the
 * SQL condition for what a partner's dashboard may list.
 */
export function canApproveOffers(viewer: Pick<Viewer, "isAdmin">): boolean {
  return viewer.isAdmin;
}

/** SQL fragment: only approved offers are visible to ordinary members. */
export function approvedOffersClause(alias = "o"): string {
  return `${alias}.approval_status = 'approved'`;
}
