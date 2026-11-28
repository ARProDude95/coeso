import type { Offer } from "@/lib/store";

export const ROLE_LABELS: Record<Offer["role_type"], string> = {
  setter: "Setter",
  closer: "Closer",
  both: "Full cycle",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** "Northwind Growth" → "NG", "Palewood" → "P". */
export function monogram(company: string): string {
  const words = company.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function isNewThisWeek(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && Date.now() - created < WEEK_MS;
}

/** "18% of contract value" → 18, "$1,200 per close" → 1200. For sorting only. */
export function commissionRank(commission: string): number {
  const match = commission.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

/**
 * Closing dates are calendar days, not moments, so they are stored and
 * compared as `YYYY-MM-DD` strings in UTC. "Apply until 30 Nov" then means the
 * same day on the server and for a member reading it from another timezone.
 */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * One gate for every place that cares: an offer takes applications while it is
 * open and the day after its closing date hasn't arrived.
 */
export function isTakingApplications(
  offer: Pick<Offer, "status" | "closes_at">,
): boolean {
  if (offer.status !== "open") return false;
  return !offer.closes_at || offer.closes_at >= todayIso();
}

/** "2026-11-30" → "30 Nov 2026". */
export function formatClosingDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatPosted(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
