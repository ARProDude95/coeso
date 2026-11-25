import type { NextRequest } from "next/server";
import { created, readJson, runApi } from "@/lib/api";
import { requireStaffApi } from "@/lib/auth";
import { createOffer } from "@/lib/offers";
import { alertSavedSearches } from "@/lib/saved-searches";
import { requirePaidPlan } from "@/lib/settings";
import { announceOffer } from "@/lib/webhook";
import { offerInputSchema } from "@/lib/validation";

/**
 * Offer creation for admins and partners. Admin offers publish immediately
 * and are announced; a partner submission is forced to `pending` and only
 * goes live (and announces) once an admin approves it.
 */
export async function POST(request: NextRequest) {
  return runApi(async () => {
    const ctx = await requireStaffApi();
    const input = offerInputSchema.parse(await readJson(request));

    if (ctx.isPartner) {
      // Partners never get admin-only switches: no featuring, no role gating,
      // and no way to skip approval by posting `status: "open"` themselves.
      const offer = await createOffer(
        ctx.user.id,
        {
          ...input,
          status: "open",
          featured: false,
          requiredRole: null,
        },
        { partnerId: ctx.user.id, approvalStatus: "pending" },
      );
      return created({ offer });
    }

    if (input.requiredRole) await requirePaidPlan("Role gating");

    const offer = await createOffer(ctx.user.id, input);

    // Only a freshly published offer is announced; both helpers never throw,
    // so a webhook or alert outage can't fail the create.
    if (offer.status === "open") {
      await announceOffer(offer);
      await alertSavedSearches(offer);
    }

    return created({ offer });
  });
}
