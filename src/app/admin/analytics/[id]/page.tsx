import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminHeader, AdminNav } from "@/components/admin-nav";
import { AnalyticsChart } from "@/components/analytics-chart";
import { canViewAnalytics } from "@/lib/analytics";
import { getOfferAnalytics } from "@/lib/analytics-data";
import { requireStaff } from "@/lib/auth";
import { getOffer } from "@/lib/offers";
import { PARTNER_ROLE } from "@/lib/partners";

export const metadata: Metadata = {
  title: "Offer analytics",
};

function Stat({
  label,
  value,
  caption,
}: {
  label: string;
  value: string | number;
  caption?: string;
}) {
  return (
    <div className="panel p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1.5 text-3xl font-semibold text-zinc-50">{value}</p>
      {caption && <p className="mt-1 text-xs text-zinc-500">{caption}</p>}
    </div>
  );
}

async function OfferAnalytics({ id }: { id: string }) {
  const ctx = await requireStaff();
  const offer = await getOffer(id);
  if (
    !offer ||
    !canViewAnalytics(
      { ...ctx.user, roles: ctx.isPartner ? [PARTNER_ROLE] : [] },
      offer,
    )
  ) {
    notFound();
  }

  const analytics = await getOfferAnalytics(offer.id);

  return (
    <>
      <AdminHeader
        eyebrow={ctx.isPartner ? "Partner portal" : "Admin"}
        title={offer.title}
        description={`${offer.company} · views, applications and acceptance over the last 30 days.`}
      />
      <AdminNav partner={ctx.isPartner} />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/analytics" className="btn btn-secondary">
          ← All analytics
        </Link>
        <Link href={`/admin/offers/${offer.id}`} className="btn btn-secondary">
          Edit offer
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Views" value={analytics.views} caption="all time" />
        <Stat
          label="Applications"
          value={analytics.applications}
          caption={`${analytics.accepted} accepted`}
        />
        <Stat
          label="Acceptance rate"
          value={
            analytics.acceptanceRate === null
              ? "—"
              : `${analytics.acceptanceRate}%`
          }
          caption="accepted / applications"
        />
        <Stat
          label="Views · 30 days"
          value={analytics.series.reduce((sum, day) => sum + day.views, 0)}
          caption="one per member per day"
        />
      </div>

      <AnalyticsChart series={analytics.series} />
    </>
  );
}

export default function OfferAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="skeleton h-96 w-full" />}>
        <OfferAnalyticsSlot params={params} />
      </Suspense>
    </div>
  );
}

async function OfferAnalyticsSlot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OfferAnalytics id={id} />;
}
