import type { NextRequest } from "next/server";
import { ApiError, created, readJson, runApi } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import { upsertDeal } from "@/lib/deals";
import { currentMonth } from "@/lib/leaderboard";
import { getOffer } from "@/lib/offers";
import { hasAcceptedApplication } from "@/lib/reviews";
import { dealInputSchema } from "@/lib/validation";

/**
 * Logs (or edits) the signed-in rep's result for one offer. Only offers where
 * their application was accepted can be logged — the same bar as reviews — so
 * a profile cannot claim results on offers the rep never worked.
 */
export async function POST(request: NextRequest) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const input = dealInputSchema.parse(await readJson(request));

    const offer = await getOffer(input.offerId);
    if (!offer) throw new ApiError(404, "Offer not found", "not_found");

    const accepted = await hasAcceptedApplication(offer.id, ctx.user.id);
    if (!accepted) {
      throw new ApiError(
        403,
        "You can only log results for offers you were accepted to",
        "not_accepted",
      );
    }

    // A missing month means "this month" — the form always sends one, but the
    // API stays usable from a script.
    const deal = await upsertDeal(ctx.user.id, {
      ...input,
      month: input.month ?? currentMonth(),
    });
    return created({ deal });
  });
}
