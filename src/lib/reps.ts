import type { Viewer } from "./roles";
import type { Deal } from "./types";

/**
 * Rep performance profile (feature 5) — pure rules.
 *
 * No database and no `server-only`, so `tests/reps.test.ts` can pin down the
 * handle generation, who may see an earnings range, and how a profile adds up.
 */

/** Public profile handles: lowercase letters, numbers and single hyphens. */
export function slugifyHandle(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : `rep-${slug || "user"}`.slice(0, 24);
}

/**
 * A handle nobody has yet: the slug itself, then `-2`, `-3`, … (deterministic,
 * so a retry for the same name picks the same candidate). The caller still
 * guards with a unique index — this is only the friendly choice.
 */
export function uniqueHandle(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const slug = slugifyHandle(base);
  if (!used.has(slug)) return slug;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${slug}-${suffix}`.slice(0, 32);
    if (!used.has(candidate)) return candidate;
  }
  return `${slug}-${Date.now().toString(36)}`.slice(0, 32);
}

export function handleFromEmail(email: string): string {
  return email.split("@")[0] ?? email;
}

/**
 * Earnings are the rep's own data: visible to the rep and to admins, hidden
 * from everybody else when the rep turns the switch off.
 */
export function earningsVisible(
  hideEarnings: boolean,
  viewer: { id: string; isAdmin: boolean },
  ownerId: string,
): boolean {
  if (!hideEarnings) return true;
  return viewer.isAdmin || viewer.id === ownerId;
}

/** A deal counts as worked only once the rep has logged one. */
export interface RepTotals {
  totalDeals: number;
  offersWorked: number;
  confirmedDeals: number;
  /** Summed across logs that carry a range; null when none do. */
  earningsMin: number | null;
  earningsMax: number | null;
}

type DealNumbers = Pick<
  Deal,
  "id" | "dealsClosed" | "earningsMin" | "earningsMax" | "partnerConfirmedAt"
>;

export function summariseDeals(deals: DealNumbers[]): RepTotals {
  let totalDeals = 0;
  let confirmedDeals = 0;
  let earningsMin: number | null = null;
  let earningsMax: number | null = null;

  for (const deal of deals) {
    totalDeals += deal.dealsClosed;
    if (deal.partnerConfirmedAt) confirmedDeals += 1;
    if (deal.earningsMin !== null || deal.earningsMax !== null) {
      earningsMin = (earningsMin ?? 0) + (deal.earningsMin ?? 0);
      earningsMax = (earningsMax ?? 0) + (deal.earningsMax ?? 0);
    }
  }

  return {
    totalDeals,
    offersWorked: deals.length,
    confirmedDeals,
    earningsMin,
    earningsMax,
  };
}

/** Mean rating to one decimal; null when nobody has rated yet. */
export function averageRating(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

/**
 * Partner confirmation is the owning partner's (or an admin's) action on a
 * deal logged against their offer. Mirrors `canManageOffer`, narrowed to the
 * fields a deal exposes.
 */
export function canConfirmDeal(
  viewer: Pick<Viewer, "id" | "isAdmin" | "roles">,
  offer: { partnerId: string | null },
): boolean {
  if (viewer.isAdmin) return true;
  if (!viewer.roles.includes("partner")) return false;
  return offer.partnerId !== null && offer.partnerId === viewer.id;
}
