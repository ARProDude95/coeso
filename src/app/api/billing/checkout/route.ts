import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import {
  getFoundingState,
  getSubscription,
} from "@/lib/subscriptions";
import { billingCheckoutSchema } from "@/lib/validation";
import { checkoutConfigured, createWhopCheckout } from "@/lib/whop";
import { planByKey } from "@/lib/pricing";

/**
 * Creates a hosted Whop checkout for one plan and returns its URL.
 *
 * The user id comes from the session, never the request body, and founding
 * availability is re-checked here — the pricing page's count is only a hint.
 */
export async function POST(request: NextRequest) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const input = billingCheckoutSchema.parse(await readJson(request));

    const plan = planByKey(input.planKey);
    if (!plan) throw new ApiError(404, "Unknown plan", "unknown_plan");

    if (!checkoutConfigured(plan)) {
      throw new ApiError(
        503,
        `Checkout is not configured yet (${plan.envVar})`,
        "billing_not_configured",
      );
    }

    if (plan.founding) {
      const founding = await getFoundingState();
      if (!founding.available) {
        throw new ApiError(
          409,
          "All founding spots are taken — choose the standard plan",
          "founding_full",
        );
      }
      // Someone already on a founding plan should not buy a second one.
      const current = await getSubscription(ctx.user.id);
      if (current?.founding) {
        throw new ApiError(
          409,
          "You already have a founding membership",
          "already_founding",
        );
      }
    }

    try {
      const url = await createWhopCheckout(plan, ctx.user.id);
      return ok({ url, planKey: plan.key });
    } catch (error) {
      console.error("[billing] checkout creation failed:", error);
      throw new ApiError(
        502,
        "Whop could not create the checkout — please try again",
        "checkout_failed",
      );
    }
  });
}
