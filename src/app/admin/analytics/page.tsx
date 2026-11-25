import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminHeader, AdminNav } from "@/components/admin-nav";
import { listOfferAnalytics } from "@/lib/analytics-data";
import { requireStaff } from "@/lib/auth";
import { OFFER_STATUS_LABELS } from "@/lib/types";

export const metadata: Metadata = {
  title: "Analytics",
};

const STATUS_CLASS: Record<string, string> = {
  open: "badge badge-open",
  paused: "badge badge-paused",
  closed: "badge badge-closed",
};

async function Analytics() {
  const ctx = await requireStaff();
  const offers = await listOfferAnalytics(
    ctx.isPartner ? ctx.user.id : undefined,
  );

  return (
    <>
      <AdminHeader
        eyebrow={ctx.isPartner ? "Partner portal" : "Admin"}
        title="Offer analytics"
        description={
          ctx.isPartner
            ? "Views, applications and acceptance rate for the offers you submitted."
            : "Views, applications and acceptance rate for every offer on the board."
        }
      />
      <AdminNav current="analytics" partner={ctx.isPartner} />

      {offers.length === 0 ? (
        <div className="panel px-6 py-12 text-center">
          <p className="text-sm text-zinc-400">No offers to report on yet.</p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-3 font-medium">Offer</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Views</th>
                <th className="px-5 py-3 text-right font-medium">
                  Applications
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  Acceptance
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr
                  key={offer.offerId}
                  className="border-b border-zinc-800/60 last:border-0"
                >
                  <td className="px-5 py-3">
                    <p className="font-medium text-zinc-100">{offer.title}</p>
                    <p className="text-xs text-zinc-500">{offer.company}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={STATUS_CLASS[offer.status]}>
                      {OFFER_STATUS_LABELS[offer.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
                    {offer.views}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
                    {offer.applications}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
                    {offer.acceptanceRate === null
                      ? "—"
                      : `${offer.acceptanceRate}%`}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/analytics/${offer.offerId}`}
                      className="btn btn-secondary"
                    >
                      30-day chart
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function AnalyticsPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="skeleton h-96 w-full" />}>
        <Analytics />
      </Suspense>
    </div>
  );
}
