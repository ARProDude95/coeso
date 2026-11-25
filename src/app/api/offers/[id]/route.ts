import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireStaffApi } from "@/lib/auth";
import { getOffer, updateOffer } from "@/lib/offers";
import { canManageOffer, PARTNER_ROLE } from "@/lib/partners";
import { alertSavedSearches } from "@/lib/saved-searches";
import { requirePaidPlan } from "@/lib/settings";
import { offerPatchSchema } from "@/lib/validation";

/**
 * Offer edit / pause / close / reopen / feature, for admins and for the
 * partner who submitted the offer. Admin-only switches (featuring, role
 * gating) are rejected for partners rather than silently ignored.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    const ctx = await requireStaffApi();
    const { id } = await params;

    const existing = await getOffer(id);
    if (!existing) throw new ApiError(404, "Offer not found", "not_found");

    // Partner data isolation: a partner can only touch their own offers.
    if (
      !canManageOffer(
        { ...ctx.user, roles: ctx.isPartner ? [PARTNER_ROLE] : [] },
        existing,
      )
    ) {
      throw new ApiError(404, "Offer not found", "not_found");
    }

    const patch = offerPatchSchema.parse(await readJson(request));
    if (Object.keys(patch).length === 0) {
      throw new ApiError(400, "No fields to update", "empty_patch");
    }

    if (ctx.isPartner) {
      if (patch.featured !== undefined || patch.requiredRole !== undefined) {
        throw new ApiError(
          403,
          "Featuring and role gating are admin-only",
          "forbidden",
        );
      }
      // Approval is an admin decision; a partner edit never publishes.
      if (existing.approvalStatus === "pending") {
        patch.status = "open";
      }
    }

    if (patch.requiredRole) await requirePaidPlan("Role gating");

    const offer = await updateOffer(id, patch);
    if (!offer) throw new ApiError(404, "Offer not found", "not_found");

    // Re-opening an approved offer counts as publishing it again: subscribers
    // who never saw it (it was paused/closed) get their alert now.
    if (
      offer.approvalStatus === "approved" &&
      offer.status === "open" &&
      existing.status !== "open"
    ) {
      await alertSavedSearches(offer);
    }

    return ok({ offer });
  });
}
