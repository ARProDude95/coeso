import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireStaffApi } from "@/lib/auth";
import { getApplicationOfferId, reviewApplication } from "@/lib/admin";
import { getOffer } from "@/lib/offers";
import { canManageOffer, PARTNER_ROLE } from "@/lib/partners";
import { applicationReviewSchema } from "@/lib/validation";

/**
 * Applicant review: accept / reject, plus the private note that is never
 * returned to the applicant. Admins may review any application; a partner
 * only applications on offers they submitted.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    const ctx = await requireStaffApi();
    const { id } = await params;

    if (ctx.isPartner) {
      const offerId = await getApplicationOfferId(id);
      const offer = offerId ? await getOffer(offerId) : null;
      if (
        !offer ||
        !canManageOffer({ ...ctx.user, roles: [PARTNER_ROLE] }, offer)
      ) {
        // 404, not 403: another partner's application must not even be
        // confirmed to exist.
        throw new ApiError(404, "Application not found", "not_found");
      }
    }

    const patch = applicationReviewSchema.parse(await readJson(request));
    const updated = await reviewApplication(id, patch);
    if (!updated) {
      throw new ApiError(404, "Application not found", "not_found");
    }

    return ok({ ok: true, status: patch.status ?? null });
  });
}
