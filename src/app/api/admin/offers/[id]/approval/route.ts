import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/auth";
import { getOffer, setApprovalStatus } from "@/lib/offers";
import { alertSavedSearches } from "@/lib/saved-searches";
import { announceOffer } from "@/lib/webhook";
import { offerApprovalSchema } from "@/lib/validation";

/**
 * Admin-only approval for partner submissions. Approving is the moment the
 * offer becomes public, so that is when the Discord announcement and the
 * saved-search alerts fire (never on the partner's original submit).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    await requireAdminApi();
    const { id } = await params;

    const existing = await getOffer(id);
    if (!existing) throw new ApiError(404, "Offer not found", "not_found");

    const input = offerApprovalSchema.parse(await readJson(request));
    const status = input.action === "approve" ? "approved" : "rejected";

    const offer = await setApprovalStatus(id, status);
    if (!offer) throw new ApiError(404, "Offer not found", "not_found");

    if (status === "approved" && offer.status === "open") {
      await announceOffer(offer);
      await alertSavedSearches(offer);
    }

    return ok({ offer });
  });
}
