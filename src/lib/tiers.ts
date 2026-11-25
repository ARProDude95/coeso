import type { Tier, TierFilter, User } from "./types";

/**
 * Membership tiers (see PROGRESS.md #3). Deliberately pure — no database, no
 * `server-only` — so the rules are unit-testable straight from `tests/`.
 */

export const TIERS: Tier[] = ["free", "pro", "elite"];
export const TIER_FILTERS: TierFilter[] = ["all", "free", "pro", "elite"];

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  elite: "Elite",
};

const RANK: Record<Tier, number> = { free: 0, pro: 1, elite: 2 };

export function tierRank(tier: Tier): number {
  return RANK[tier] ?? 0;
}

/** True when `actual` is at least as high as `required`. */
export function hasTier(actual: Tier, required: Tier): boolean {
  return tierRank(actual) >= tierRank(required);
}

/** Saved searches per tier: Pro gets 5, Elite 15, Free none (PROGRESS #1). */
export function savedSearchLimit(tier: Tier): number {
  switch (tier) {
    case "elite":
      return 15;
    case "pro":
      return 5;
    default:
      return 0;
  }
}

/** Role required to use a feature, for copy in the UI and API errors. */
export const PRO_REQUIRED = "Saved searches are a Pro feature";

/**
 * Whether a saved search's tier filter accepts an offer's tier. `"all"` is the
 * no-filter value.
 */
export function tierFilterMatches(
  filter: TierFilter,
  offerTier: Tier,
): boolean {
  if (filter === "all") return true;
  return filter === offerTier;
}

/** Whether the viewer's tier satisfies a feature requirement (admins pass). */
export function viewerCanUse(user: Pick<User, "tier" | "isAdmin">, required: Tier): boolean {
  if (user.isAdmin) return true;
  return hasTier(user.tier, required);
}
