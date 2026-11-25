import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/auth";
import { grantTier, assignFoundingSlot } from "@/lib/subscriptions";
import { getUserById } from "@/lib/users";
import { billingGrantSchema } from "@/lib/validation";

/**
 * Admin-only: grant one of the founding slots to a specific member as well as
 * the tier. Useful for comps and for fixing a founding checkout that could not
 * claim a slot automatically. The slot claim is the same atomic UPDATE the
 * webhook uses, so it cannot exceed FOUNDING_SLOTS.
 */
export async function POST(request: NextRequest) {
  return runApi(async () => {
    await requireAdminApi();
    const input = billingGrantSchema.parse(await readJson(request));

    if (input.tier === "free") {
      throw new ApiError(
        400,
        "Pick Pro or Elite to grant a founding slot",
        "invalid_tier",
      );
    }

    const user = await getUserById(input.userId);
    if (!user) throw new ApiError(404, "Account not found", "not_found");

    const claim = await assignFoundingSlot(input.userId);
    if (claim === "full") {
      throw new ApiError(
        409,
        "All founding slots are used",
        "founding_full",
      );
    }

    // grantTier does not clear founding/founding_slot, so the slot survives.
    const subscription = await grantTier(input.userId, input.tier);

    return ok({
      ok: true,
      claim,
      tier: subscription.tier,
      founding: subscription.founding,
      slot: subscription.foundingSlot,
    });
  });
}
