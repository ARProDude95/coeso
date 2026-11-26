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

export function formatPosted(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
