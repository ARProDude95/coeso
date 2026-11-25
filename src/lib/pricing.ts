import type { SubscriptionStatus, Tier } from "./types";

/**
 * THE pricing config. Change prices, founding slots, plan env-var names or the
 * pinned Whop API version here — nothing else hard-codes an amount.
 *
 * Money is collected by Whop (hosted checkout + billing). Each plan below maps
 * to one Whop plan id in an environment variable, so a price change never
 * re-points existing subscribers: they stay on the plan (and price) they
 * bought, and a new subscription uses the current plan id.
 */

/** How many paying subscribers can hold founding pricing. */
export const FOUNDING_SLOTS = 20;

/**
 * Pinned Whop API version date (header `Api-Version-Date`). Whop rolls
 * behaviour changes behind these dates; pinning keeps our payloads stable.
 */
export const WHOP_API_VERSION = "2026-10-24";

/** Default REST base. Set `WHOP_API_BASE_URL` to the sandbox in development. */
export const WHOP_PRODUCTION_BASE_URL = "https://api.whop.com/api/v1";
export const WHOP_SANDBOX_BASE_URL = "https://sandbox-api.whop.com/api/v1";

export type BillingInterval = "monthly" | "annual";
export type PaidTier = Exclude<Tier, "free">;
export type Currency = "USD" | "INR";

export interface PricingPlan {
  /** Stable key used by the UI and stored on the subscription row. */
  key: string;
  tier: PaidTier;
  interval: BillingInterval;
  founding: boolean;
  /** Explicit prices — India never gets a converted-at-checkout amount. */
  usd: number;
  inr: number;
  /** Env var holding this plan's Whop plan id. */
  envVar: string;
  label: string;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    key: "pro_monthly",
    tier: "pro",
    interval: "monthly",
    founding: false,
    usd: 12,
    inr: 499,
    envVar: "WHOP_PLAN_ID_PRO_MONTHLY",
    label: "Pro monthly",
  },
  {
    key: "pro_annual",
    tier: "pro",
    interval: "annual",
    founding: false,
    usd: 99,
    inr: 4_999,
    envVar: "WHOP_PLAN_ID_PRO_ANNUAL",
    label: "Pro annual",
  },
  {
    key: "elite_monthly",
    tier: "elite",
    interval: "monthly",
    founding: false,
    usd: 29,
    inr: 1_299,
    envVar: "WHOP_PLAN_ID_ELITE_MONTHLY",
    label: "Elite monthly",
  },
  {
    key: "elite_annual",
    tier: "elite",
    interval: "annual",
    founding: false,
    usd: 249,
    inr: 12_999,
    envVar: "WHOP_PLAN_ID_ELITE_ANNUAL",
    label: "Elite annual",
  },
  {
    key: "pro_founding",
    tier: "pro",
    interval: "monthly",
    founding: true,
    usd: 9,
    inr: 399,
    envVar: "WHOP_PLAN_ID_PRO_FOUNDING",
    label: "Pro founding",
  },
  {
    key: "elite_founding",
    tier: "elite",
    interval: "monthly",
    founding: true,
    usd: 19,
    inr: 899,
    envVar: "WHOP_PLAN_ID_ELITE_FOUNDING",
    label: "Elite founding",
  },
];

export function planByKey(key: string): PricingPlan | null {
  return PRICING_PLANS.find((plan) => plan.key === key) ?? null;
}

/** The standard version of a founding plan (and vice versa). */
export function counterpartPlan(plan: PricingPlan): PricingPlan | null {
  if (plan.tier !== "pro" && plan.tier !== "elite") return null;
  return (
    PRICING_PLANS.find(
      (candidate) =>
        candidate.tier === plan.tier &&
        candidate.interval === plan.interval &&
        candidate.founding !== plan.founding,
    ) ?? null
  );
}

/** Reads the plan id from the environment at call time (never at import). */
export function planId(plan: PricingPlan): string | null {
  return process.env[plan.envVar]?.trim() || null;
}

export function configured(plan: PricingPlan): boolean {
  return planId(plan) !== null;
}

/** Maps a Whop plan id back to our config (webhook → tier). */
export function planByWhopId(whopPlanId: string | null): PricingPlan | null {
  if (!whopPlanId) return null;
  return (
    PRICING_PLANS.find((plan) => planId(plan) === whopPlanId) ?? null
  );
}

export function standardPlans(tier: PaidTier): PricingPlan[] {
  return PRICING_PLANS.filter(
    (plan) => plan.tier === tier && !plan.founding,
  );
}

export function foundingPlan(tier: PaidTier): PricingPlan | null {
  return (
    PRICING_PLANS.find((plan) => plan.tier === tier && plan.founding) ?? null
  );
}

/** `$12` / `₹499` — no decimals: every configured amount is whole. */
export function formatPrice(amount: number, currency: Currency): string {
  const symbol = currency === "INR" ? "₹" : "$";
  return `${symbol}${amount.toLocaleString("en-US")}`;
}

export function priceFor(
  plan: Pick<PricingPlan, "usd" | "inr">,
  currency: Currency,
): number {
  return currency === "INR" ? plan.inr : plan.usd;
}

/** Spots left out of `FOUNDING_SLOTS`; never negative. */
export function foundingSpotsLeft(used: number): number {
  return Math.max(0, FOUNDING_SLOTS - used);
}

export function foundingAvailable(used: number): boolean {
  return used < FOUNDING_SLOTS;
}

/**
 * A subscription only unlocks its tier while it is paying (active or in
 * dunning) or explicitly granted by an admin. A canceled/expired subscription
 * grants nothing, no matter what tier it still records — this is why gating
 * reads the subscription rather than client state.
 */
export function effectiveTier(
  subscription: { tier: Tier; status: SubscriptionStatus } | null,
): Tier {
  if (!subscription) return "free";
  if (
    subscription.status === "active" ||
    subscription.status === "past_due" ||
    subscription.status === "granted"
  ) {
    return subscription.tier;
  }
  return "free";
}

/** Statuses that keep a founding price alive (PROGRESS assumption 22). */
export function keepsFoundingPrice(status: SubscriptionStatus): boolean {
  return status === "active" || status === "past_due";
}
