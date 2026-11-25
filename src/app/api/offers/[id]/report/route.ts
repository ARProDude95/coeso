import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import { getOffer } from "@/lib/offers";
import { createReport } from "@/lib/reports";
import { canViewOffer, loadViewer } from "@/lib/roles";
import { reportInputSchema } from "@/lib/validation";

/**
 * Member-only report endpoint. One report per member per offer (unique index
 * → 409), and the third unique open report auto-pauses the offer, notifying
 * admins in-app and via the channel webhook.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const { id } = await params;

    const viewer = await loadViewer(ctx.user);
    const offer = await getOffer(id);
    if (!offer || !canViewOffer(offer, viewer)) {
      throw new ApiError(404, "Offer not found", "not_found");
    }

    const input = reportInputSchema.parse(await readJson(request));
    const result = await createReport(offer, ctx.user.id, input.reason);

    return ok({
      ok: true,
      openCount: result.openCount,
      paused: result.paused,
    });
  });
}
