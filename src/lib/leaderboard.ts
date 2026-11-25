/**
 * Monthly leaderboard (feature 7) — pure rules.
 *
 * The Discord half is a best-effort REST call elsewhere; everything that
 * decides *who* wins, *which* month is current, and *which* awards expire
 * lives here so `tests/leaderboard.test.ts` can pin it down.
 */

/** `YYYY-MM` for the current UTC month. */
export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** The month before a `YYYY-MM` string (`2026-01` → `2025-12`). */
export function previousMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return date.toISOString().slice(0, 7);
}

export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
}

export function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  username: string;
  deals: number;
}

/**
 * Deals descending, then name (case-insensitive), then user id — so equal
 * scores never shuffle between reads and the top-3 cut is deterministic.
 */
export function rankEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.deals !== a.deals) return b.deals - a.deals;
    const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.userId.localeCompare(b.userId);
  });
}

export interface Award {
  id: string;
  month: string;
  userId: string;
  rank: number;
  roleGranted: boolean;
  revokedAt: string | null;
}

/** Awards from an earlier month whose role has not been taken back yet. */
export function awardsToRevoke(awards: Award[], month: string): Award[] {
  return awards.filter(
    (award) => award.month < month && award.revokedAt === null,
  );
}

/** Award the month once; a month with no deals gets no winners. */
export function shouldAward(
  awardsThisMonth: Award[],
  entries: LeaderboardEntry[],
): boolean {
  return awardsThisMonth.length === 0 && entries.some((entry) => entry.deals > 0);
}
