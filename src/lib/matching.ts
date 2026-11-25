import { tierFilterMatches } from "./tiers";
import type { Offer, RoleType, Tier, TierFilter } from "./types";

/**
 * Pure saved-search matching (feature 1) — no database, no `server-only`, so
 * `tests/saved-searches.test.ts` can exercise it directly.
 */

export interface SearchFilter {
  /** `"all"` = no role restriction. */
  roleType: RoleType | "all";
  tier: TierFilter;
  /** Whitespace-separated tokens; every token must appear in the offer. */
  keywords: string;
  /** Minimum numeric commission; `null` = no minimum. */
  minCommission: number | null;
}

export interface OfferFacts {
  roleType: RoleType;
  tier: Tier;
  title: string;
  company: string;
  description: string;
  commissionAmount: number | null;
  status: Offer["status"];
}

export function roleFilterMatches(
  filter: RoleType | "all",
  offerRole: RoleType,
): boolean {
  if (filter === "all") return true;
  // A "both" offer covers a setter-only or closer-only search too.
  if (offerRole === "both") return true;
  return filter === offerRole;
}

export function keywordsMatch(
  keywords: string,
  offer: Pick<OfferFacts, "title" | "company" | "description">,
): boolean {
  const tokens = keywords.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack =
    `${offer.title}\n${offer.company}\n${offer.description}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function minCommissionMatches(
  min: number | null,
  offer: Pick<OfferFacts, "commissionAmount">,
): boolean {
  if (min === null) return true;
  // An offer with no numeric commission can never satisfy a minimum.
  return offer.commissionAmount !== null && offer.commissionAmount >= min;
}

/** Only open offers alert; a paused or closed one never matches. */
export function matchesOffer(search: SearchFilter, offer: OfferFacts): boolean {
  if (offer.status !== "open") return false;
  return (
    roleFilterMatches(search.roleType, offer.roleType) &&
    tierFilterMatches(search.tier, offer.tier) &&
    keywordsMatch(search.keywords, offer) &&
    minCommissionMatches(search.minCommission, offer)
  );
}

/** The pure part of an offer a search can match against. */
export function offerFacts(offer: Offer): OfferFacts {
  return {
    roleType: offer.roleType,
    tier: offer.tier,
    title: offer.title,
    company: offer.company,
    description: offer.description,
    commissionAmount: offer.commissionAmount,
    status: offer.status,
  };
}
