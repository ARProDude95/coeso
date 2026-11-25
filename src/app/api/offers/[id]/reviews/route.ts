import type { NextRequest } from "next/server";
import { ApiError, created, ok, readJson, runApi } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import { getOffer } from "@/lib/offers";
import { canViewOffer, loadViewer } from "@/lib/roles";
import {
  createReview,
  getReview,
  hasAcceptedApplication,
  isDuplicateReviewError,
  listReviews,
  reviewEligibility,
  summariseReviews,
} from "@/lib/reviews";
import { reviewInputSchema } from "@/lib/validation";

/**
 * Offer reviews (Elite). GET never leaks Elite-only comments: they are
 * stripped here for viewers who aren't Elite (or admin), while the averages
 * are returned to everyone who can see the offer at all.
 */
export async function GET(
  _request: NextRequest,
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

    const reviews = await listReviews(id);
    const canSeeComments = ctx.user.isAdmin || ctx.user.tier === "elite";
    const eligibility = reviewEligibility({
      hasAcceptedApplication: await hasAcceptedApplication(id, ctx.user.id),
      tier: ctx.user.tier,
      isAdmin: ctx.user.isAdmin,
    });

    return ok({
      summary: summariseReviews(reviews),
      comments: canSeeComments
        ? reviews.filter((review) => review.comment.trim() !== "")
        : null,
      commentsVisible: canSeeComments,
      eligibility,
      mine: await getReview(id, ctx.user.id),
    });
  });
}

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

    const input = reviewInputSchema.parse(await readJson(request));
    const eligibility = reviewEligibility({
      hasAcceptedApplication: await hasAcceptedApplication(id, ctx.user.id),
      tier: ctx.user.tier,
      isAdmin: ctx.user.isAdmin,
    });

    try {
      const review = await createReview(id, ctx.user.id, eligibility, input);
      return created({ review });
    } catch (error) {
      if (isDuplicateReviewError(error)) {
        throw new ApiError(409, "You have already reviewed this offer", "already_reviewed");
      }
      throw error;
    }
  });
}
