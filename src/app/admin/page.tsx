import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminHeader, AdminNav } from "@/components/admin-nav";
import { OfferApproval } from "@/components/offer-approval";
import { OfferStatusButtons } from "@/components/offer-status-buttons";
import { getAdminStats } from "@/lib/admin";
import { requireStaff } from "@/lib/auth";
import { countPendingOffers, listOffersForStaff } from "@/lib/offers";
import { formatDate, isExpired, pluralise } from "@/lib/format";
import {
  OFFER_STATUS_LABELS,
  ROLE_TYPE_LABELS,
  type OfferWithCounts,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "Admin",
};

const STATUS_CLASS: Record<string, string> = {
  open: "badge badge-open",
  paused: "badge badge-paused",
  closed: "badge badge-closed",
};

function Stat({
  label,
  value,
  accent,
  caption,
}: {
  label: string;
  value: number;
  accent?: string;
  caption?: string;
}) {
  return (
    <div className="panel p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className={`mt-1.5 text-3xl font-semibold ${accent ?? "text-zinc-50"}`}>
        {value}
      </p>
      {caption && <p className="mt-1 text-xs text-zinc-500">{caption}</p>}
    </div>
  );
}

function OfferRow({
  offer,
  isAdmin,
}: {
  offer: OfferWithCounts;
  isAdmin: boolean;
}) {
  return (
    <li className="panel flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={STATUS_CLASS[offer.status]}>
            {OFFER_STATUS_LABELS[offer.status]}
          </span>
          {offer.featured && <span className="badge badge-featured">Featured</span>}
          {offer.approvalStatus === "pending" && (
            <span className="badge badge-pending">Pending approval</span>
          )}
          {offer.approvalStatus === "rejected" && (
            <span className="badge badge-rejected">Rejected</span>
          )}
          {offer.approvalStatus === "approved" && offer.partnerId && (
            <span className="badge badge-verified">Verified Partner</span>
          )}
          <span className="badge badge-neutral">
            {ROLE_TYPE_LABELS[offer.roleType]}
          </span>
          {offer.requiredRole && (
            <span className="badge badge-accent">{offer.requiredRole}</span>
          )}
        </div>
        <h3 className="mt-2 truncate text-sm font-semibold text-zinc-100">
          {offer.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {offer.company} · {pluralise(offer.applicationCount, "applicant")} ·{" "}
          {offer.expiresAt
            ? `expires ${formatDate(offer.expiresAt)}${
                isExpired(offer.expiresAt) && offer.status !== "closed"
                  ? " (expired)"
                  : ""
              }`
            : "no expiry"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/offers/${offer.id}/applicants`}
          className="btn btn-secondary"
        >
          Applicants ({offer.applicationCount})
        </Link>
        <Link href={`/admin/offers/${offer.id}`} className="btn btn-secondary">
          Edit
        </Link>
        {isAdmin && offer.approvalStatus === "pending" ? (
          <OfferApproval offerId={offer.id} />
        ) : (
          <OfferStatusButtons offerId={offer.id} status={offer.status} />
        )}
      </div>
    </li>
  );
}

async function AdminDashboard() {
  const ctx = await requireStaff();
  const partnerId = ctx.isPartner ? ctx.user.id : undefined;
  const [stats, offers, pending] = await Promise.all([
    getAdminStats(partnerId),
    listOffersForStaff(ctx.user),
    countPendingOffers(partnerId),
  ]);

  return (
    <>
      <AdminHeader
        eyebrow={ctx.isPartner ? "Partner portal" : "Admin"}
        title={ctx.isPartner ? "Your offers" : "Dashboard"}
        description={
          ctx.isPartner
            ? "Submit offers for approval and review applicants on the offers you own."
            : "Publish offers, manage their status, and review applicants."
        }
      />
      <AdminNav current="dashboard" partner={ctx.isPartner} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Open offers"
          value={stats.openOffers}
          accent="text-emerald-300"
          caption={`${stats.pausedOffers} paused · ${stats.closedOffers} closed`}
        />
        <Stat
          label="Applicants"
          value={stats.pendingApplicants}
          accent="text-indigo-300"
          caption="awaiting review"
        />
        <Stat
          label="All applicants"
          value={stats.totalApplicants}
          caption={`${stats.acceptedApplicants} accepted`}
        />
        <Stat
          label={ctx.isPartner ? "Awaiting approval" : "Pending approval"}
          value={pending}
          caption={ctx.isPartner ? "submitted by you" : "partner submissions"}
        />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            {ctx.isPartner ? "Offers you submitted" : "All offers"}
          </h2>
          <Link href="/admin/offers/new" className="btn btn-primary">
            New offer
          </Link>
        </div>

        {offers.length === 0 ? (
          <div className="panel px-6 py-12 text-center">
            <p className="text-sm text-zinc-400">
              {ctx.isPartner
                ? "No offers yet — submit one for admin approval."
                : "No offers yet — publish the first one to get the board started."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {offers.map((offer) => (
              <OfferRow
                key={offer.id}
                offer={offer}
                isAdmin={ctx.user.isAdmin}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="skeleton h-20 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-24 w-full" />
        ))}
      </div>
      <div className="skeleton h-64 w-full" />
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<DashboardSkeleton />}>
        <AdminDashboard />
      </Suspense>
    </div>
  );
}
