import type { Viewer } from "./roles";

/**
 * Offer analytics (feature 6) — pure shape-building.
 *
 * Kept database-free so `tests/analytics.test.ts` can check the maths: the
 * acceptance rate, the zero-filled 30-day window, and who may read a chart.
 */

export interface DailyPoint {
  /** `YYYY-MM-DD` (UTC). */
  date: string;
  views: number;
  applications: number;
}

export interface PartialPoint {
  date: string;
  count: number;
}

/**
 * The last `days` calendar days (UTC), oldest first, ending today. All-zero
 * days are included, so a chart never silently compresses quiet periods.
 */
export function lastNDays(days: number, now = new Date()): string[] {
  const dates: string[] = [];
  const cursor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(cursor);
    day.setUTCDate(cursor.getUTCDate() - offset);
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

/** Merges two sparse count lists (views, applications) into the day window. */
export function buildSeries(
  dates: string[],
  views: PartialPoint[],
  applications: PartialPoint[],
): DailyPoint[] {
  const viewMap = new Map(views.map((point) => [point.date, point.count]));
  const appMap = new Map(
    applications.map((point) => [point.date, point.count]),
  );
  return dates.map((date) => ({
    date,
    views: viewMap.get(date) ?? 0,
    applications: appMap.get(date) ?? 0,
  }));
}

/** Accepted / total as a percentage with one decimal; null with no applicants. */
export function acceptanceRate(
  accepted: number,
  total: number,
): number | null {
  if (total <= 0) return null;
  return Math.round((accepted / total) * 1000) / 10;
}

/** Bar height as a percentage of the busiest day (0 when everything is 0). */
export function barPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100));
}

/**
 * Admins see every offer's numbers; a partner only the offers they submitted.
 * Mirrors the partner portal's `canManageOffer` for the read path.
 */
export function canViewAnalytics(
  viewer: Pick<Viewer, "id" | "isAdmin" | "roles">,
  offer: { partnerId: string | null },
): boolean {
  if (viewer.isAdmin) return true;
  if (!viewer.roles.includes("partner")) return false;
  return offer.partnerId !== null && offer.partnerId === viewer.id;
}
