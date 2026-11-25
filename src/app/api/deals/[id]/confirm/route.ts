import { ApiError, ok, runApi } from "@/lib/api";
import { requireStaffApi } from "@/lib/auth";
import { confirmDeal, getDeal } from "@/lib/deals";
import { getOffer } from "@/lib/offers";
import { PARTNER_ROLE } from "@/lib/partners";
import { canConfirmDeal } from "@/lib/reps";

/**
 * Partner confirmation of a rep's logged result. Only the partner who
 * submitted the offer (or an admin) may confirm, and the endpoint is
 * idempotent — pressing confirm twice keeps the first timestamp.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    const ctx = await requireStaffApi();
    const { id } = await params;

    const deal = await getDeal(id);
    const offer = deal ? await getOffer(deal.offerId) : null;
    if (
      !deal ||
      !offer ||
      !canConfirmDeal(
        { ...ctx.user, roles: ctx.isPartner ? [PARTNER_ROLE] : [] },
        offer,
      )
    ) {
      // 404 so another partner's offer data is never confirmed to exist.
      throw new ApiError(404, "Deal not found", "not_found");
    }

    await confirmDeal(deal.id, ctx.user.id);
    return ok({ ok: true });
  });
}
