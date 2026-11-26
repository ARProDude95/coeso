import { commissionRank } from "@/lib/offer-format";
import type { Offer } from "@/lib/store";

export type Sort = "newest" | "oldest" | "commission" | "company";

export const SORT_LABELS: Record<Sort, string> = {
  newest: "Newest first",
  commission: "Biggest commission",
  oldest: "Oldest first",
  company: "Company A–Z",
};

export interface BoardFilters {
  q: string;
  roles: Offer["role_type"][];
  pays: string[];
  sort: Sort;
  shortlistOnly: boolean;
  shortlist: string[];
}

/** The searchable text of one offer, lowercased once per comparison. */
function haystack(offer: Offer): string {
  return [
    offer.title,
    offer.company,
    offer.description,
    offer.requirements,
    offer.pay_type,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Everything the board filters and sorts on, in one pure function so it can be
 * checked without a browser. Featured offers keep their server-side priority
 * only for the default sort; an explicit sort wins over it.
 */
export function filterAndSortOffers(
  offers: Offer[],
  filters: BoardFilters,
): Offer[] {
  const needle = filters.q.trim().toLowerCase();

  const matched = offers.filter((offer) => {
    if (filters.shortlistOnly && !filters.shortlist.includes(offer.id)) {
      return false;
    }
    if (filters.roles.length > 0 && !filters.roles.includes(offer.role_type)) {
      return false;
    }
    if (filters.pays.length > 0 && !filters.pays.includes(offer.pay_type)) {
      return false;
    }
    if (!needle) return true;
    return haystack(offer).includes(needle);
  });

  const sorted = [...matched];
  switch (filters.sort) {
    case "commission":
      sorted.sort(
        (a, b) => commissionRank(b.commission) - commissionRank(a.commission),
      );
      break;
    case "oldest":
      sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
      break;
    case "company":
      sorted.sort(
        (a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title),
      );
      break;
    default:
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return sorted;
}

/** Pay structures actually present on the board, for the chip row. */
export function payOptions(offers: Offer[]): string[] {
  return Array.from(new Set(offers.map((offer) => offer.pay_type))).sort();
}
