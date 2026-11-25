import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ApplyForm } from "@/components/apply-form";
import { recordOfferView } from "@/lib/analytics-data";
import { OfferReviews } from "@/components/offer-reviews";
import { ReportOffer } from "@/components/report-offer";
import { getApplicationForOffer } from "@/lib/applications";
import { requireMember } from "@/lib/auth";
import { formatDate, formatRelative, isExpired, pluralise } from "@/lib/format";
import { getOffer } from "@/lib/offers";
import { canViewOfferApproval } from "@/lib/partners";
import {
  getReview,
  hasAcceptedApplication,
  listReviews,
  reviewEligibility,
  summariseReviews,
} from "@/lib/reviews";
import { canViewOffer, loadViewer } from "@/lib/roles";
import {
  APPLICATION_STATUS_LABELS,
  OFFER_STATUS_LABELS,
  ROLE_TYPE_LABELS,
  type Application,
  type OfferWithCounts,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "Offer",
};

const STATUS_CLASS: Record<string, string> = {
  open: "badge badge-open",
  paused: "badge badge-paused",
  closed: "badge badge-closed",
};

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-sm font-medium text-zinc-200">{value}</dd>
    </div>
  );
}

const APPLICATION_BADGE: Record<Application["status"], string> = {
  pending: "badge badge-pending",
  accepted: "badge badge-accepted",
  rejected: "badge badge-rejected",
};

function ApplyPanel({
  offer,
  existing,
}: {
  offer: OfferWithCounts;
  existing: Application | null;
}) {
  if (existing) {
    return (
      <div className="panel flex flex-col items-start gap-3 p-5">
        <div className="flex items-center gap-2">
          <span className={APPLICATION_BADGE[existing.status]}>
            {APPLICATION_STATUS_LABELS[existing.status]}
          </span>
          <span className="text-xs text-zinc-500">
            applied {formatRelative(existing.createdAt)}
          </span>
        </div>
        <p className="text-sm leading-6 text-zinc-300">
          You&apos;ve already applied to this offer. Track its status from your
          applications page.
        </p>
        <Link href="/applications" className="btn btn-secondary w-full">
          My applications
        </Link>
      </div>
    );
  }

  if (offer.status !== "open") {
    return (
      <div className="panel flex flex-col items-start gap-2 p-5">
        <span className="badge badge-closed">Not accepting applications</span>
        <p className="text-sm leading-6 text-zinc-400">
          This offer is {OFFER_STATUS_LABELS[offer.status].toLowerCase()}, so
          new applications are closed.
        </p>
      </div>
    );
  }

  return <ApplyForm offerId={offer.id} />;
}

interface ReviewsProps {
  summary: ReturnType<typeof summariseReviews>;
  comments: Awaited<ReturnType<typeof listReviews>> | null;
  commentsVisible: boolean;
  eligibility: { can: boolean; code: "ok" | "not_accepted" | "tier_required" };
  hasExisting: boolean;
}

function Detail({
  offer,
  existingApplication,
  reviews,
}: {
  offer: OfferWithCounts;
  existingApplication: Application | null;
  reviews: ReviewsProps;
}) {
  const expired = isExpired(offer.expiresAt);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-6">
        <section className="panel p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={STATUS_CLASS[offer.status]}>
              {OFFER_STATUS_LABELS[offer.status]}
            </span>
            {offer.featured && <span className="badge badge-featured">Featured</span>}
            <span className="badge badge-neutral">
              {ROLE_TYPE_LABELS[offer.roleType]}
            </span>
            {offer.partnerId && (
              <span
                className="badge badge-verified"
                title="Submitted by a verified Coeso partner"
              >
                Verified Partner
              </span>
            )}
            {offer.requiredRole && (
              <span className="badge badge-accent">
                Role: {offer.requiredRole}
              </span>
            )}
          </div>

          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-50">
            {offer.title}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {offer.company} · posted {formatRelative(offer.createdAt)}
          </p>

          <div className="mt-6 whitespace-pre-wrap text-sm leading-7 text-zinc-300">
            {offer.description}
          </div>
        </section>

        {offer.requirements.trim() && (
          <section className="panel p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Requirements
            </h2>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-300">
              {offer.requirements}
            </div>
          </section>
        )}

        <OfferReviews
          offerId={offer.id}
          summary={reviews.summary}
          comments={
            reviews.comments?.map((review) => ({
              id: review.id,
              reviewerName: review.reviewerName,
              payoutRating: review.payoutRating,
              leadRating: review.leadRating,
              supportRating: review.supportRating,
              comment: review.comment,
              createdAt: review.createdAt,
            })) ?? null
          }
          commentsVisible={reviews.commentsVisible}
          eligibility={reviews.eligibility}
          hasExisting={reviews.hasExisting}
        />
      </div>

      <aside className="flex flex-col gap-4">
        <div className="panel p-5">
          <dl className="grid grid-cols-2 gap-4">
            <Meta label="Pay type" value={offer.payType} />
            <Meta label="Commission" value={offer.commission} />
            <Meta label="Role" value={ROLE_TYPE_LABELS[offer.roleType]} />
            <Meta label="Status" value={OFFER_STATUS_LABELS[offer.status]} />
            <Meta label="Posted" value={formatDate(offer.createdAt)} />
            <Meta
              label="Expires"
              value={
                offer.expiresAt ? (
                  <span className={expired ? "text-red-300" : undefined}>
                    {formatDate(offer.expiresAt)}
                  </span>
                ) : (
                  "Never"
                )
              }
            />
          </dl>
        </div>

        <div className="panel p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Applicants
          </p>
          <p className="mt-1 text-2xl font-semibold text-zinc-50">
            {offer.applicationCount}
          </p>
          <p className="text-xs text-zinc-500">
            {pluralise(offer.applicationCount, "application")} received
          </p>
        </div>

        <ApplyPanel offer={offer} existing={existingApplication} />

        <ReportOffer offerId={offer.id} />

        <Link href="/offers" className="btn btn-secondary w-full">
          ← Back to offers
        </Link>
      </aside>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="skeleton h-96 w-full" />
      <div className="skeleton h-64 w-full" />
    </div>
  );
}

async function OfferDetail({ id }: { id: string }) {
  const ctx = await requireMember();
  const viewer = await loadViewer(ctx.user);
  const offer = await getOffer(id);
  // A gated offer the viewer can't reach is reported as missing rather than
  // forbidden: it shouldn't leak that the offer exists at all. The same goes
  // for a partner submission that is still pending or was rejected.
  if (
    !offer ||
    !canViewOffer(offer, viewer) ||
    !canViewOfferApproval(viewer, offer)
  ) {
    notFound();
  }

  // Analytics: one view per member per offer per day. Admins and the offer's
  // own partner are excluded so management traffic doesn't inflate the chart.
  if (!ctx.user.isAdmin && offer.partnerId !== ctx.user.id) {
    await recordOfferView(offer.id, ctx.user.id);
  }

  const existingApplication = await getApplicationForOffer(id, ctx.user.id);
  const [reviews, mine] = await Promise.all([
    listReviews(id),
    getReview(id, ctx.user.id),
  ]);
  const commentsVisible = ctx.user.isAdmin || ctx.user.tier === "elite";
  const eligibility = reviewEligibility({
    hasAcceptedApplication: await hasAcceptedApplication(id, ctx.user.id),
    tier: ctx.user.tier,
    isAdmin: ctx.user.isAdmin,
  });

  return (
    <Detail
      offer={offer}
      existingApplication={existingApplication}
      reviews={{
        summary: summariseReviews(reviews),
        comments: commentsVisible ? reviews : null,
        commentsVisible,
        eligibility,
        hasExisting: mine !== null,
      }}
    />
  );
}

export default function OfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <OfferDetailSlot params={params} />
    </Suspense>
  );
}

async function OfferDetailSlot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OfferDetail id={id} />;
}
