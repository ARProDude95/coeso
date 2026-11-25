import type { NextRequest } from "next/server";
import { created, readJson, runApi, ApiError } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import { getOffer } from "@/lib/offers";
import { canViewOfferApproval } from "@/lib/partners";
import { canViewOffer, loadViewer } from "@/lib/roles";
import { createApplication } from "@/lib/applications";
import { applicationInputSchema } from "@/lib/validation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const { id } = await params;

    const viewer = await loadViewer(ctx.user);
    const offer = await getOffer(id);
    if (
      !offer ||
      !canViewOffer(offer, viewer) ||
      !canViewOfferApproval(viewer, offer)
    ) {
      throw new ApiError(404, "Offer not found", "not_found");
    }
    if (offer.status !== "open") {
      throw new ApiError(409, "This offer is no longer open", "offer_closed");
    }

    const input = applicationInputSchema.parse(await readJson(request));

    const application = await createApplication(id, ctx.user.id, {
      message: input.message,
      experienceLevel: input.experienceLevel,
      availabilityHours: input.availabilityHours,
      pastResults: input.pastResults,
    });

    if (!application) {
      throw new ApiError(
        409,
        "You have already applied to this offer",
        "already_applied",
      );
    }

    return created({
      application: {
        id: application.id,
        status: application.status,
        createdAt: application.createdAt,
      },
    });
  });
}
