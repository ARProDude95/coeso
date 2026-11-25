import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminHeader, AdminNav } from "@/components/admin-nav";
import { ApplicantReview } from "@/components/applicant-review";
import { DealConfirm } from "@/components/deal-confirm";
import { listApplicants } from "@/lib/admin";
import { listDealsForOffer } from "@/lib/deals";
import { formatRelative } from "@/lib/format";
import { requireStaff } from "@/lib/auth";
import { getOffer } from "@/lib/offers";
import { canManageOffer, PARTNER_ROLE } from "@/lib/partners";

export const metadata: Metadata = {
  title: "Applicants",
};

async function Applicants({ id }: { id: string }) {
  const ctx = await requireStaff();
  const offer = await getOffer(id);
  if (
    !offer ||
    !canManageOffer(
      { ...ctx.user, roles: ctx.isPartner ? [PARTNER_ROLE] : [] },
      offer,
    )
  ) {
    notFound();
  }

  const [applicants, deals] = await Promise.all([
    listApplicants(id),
    listDealsForOffer(id),
  ]);

  return (
    <>
      <AdminHeader
        eyebrow={ctx.isPartner ? "Partner portal" : "Admin"}
        title="Applicants"
        description="Accept or reject candidates and keep a private note on each one."
      />
      <AdminNav partner={ctx.isPartner} />
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin" className="btn btn-secondary">
            ← Dashboard
          </Link>
          <Link href={`/admin/offers/${id}`} className="btn btn-secondary">
            Edit offer
          </Link>
          <p className="text-sm text-zinc-400">
            {applicants.length}{" "}
            {applicants.length === 1 ? "applicant" : "applicants"} for “
            {offer.title}”
          </p>
        </div>

        {deals.length > 0 && (
          <section className="panel p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Deals reported
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Confirm a rep&apos;s numbers only if you verified them — the
              confirmation shows on their public profile.
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {deals.map((deal) => (
                <li
                  key={deal.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/reps/${deal.repUsername}`}
                      className="text-sm font-medium text-zinc-100 hover:text-indigo-300"
                    >
                      {deal.repName}
                    </Link>
                    <p className="text-xs text-zinc-500">
                      {deal.dealsClosed} closed · $
                      {(deal.earningsMin ?? 0).toLocaleString()}–$
                      {(deal.earningsMax ?? 0).toLocaleString()} · logged{" "}
                      {formatRelative(deal.updatedAt)}
                    </p>
                  </div>
                  {deal.partnerConfirmedAt ? (
                    <span className="badge badge-open">Confirmed</span>
                  ) : (
                    <DealConfirm dealId={deal.id} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {applicants.length === 0 ? (
          <div className="panel px-6 py-12 text-center">
            <p className="text-sm text-zinc-400">
              No applications for this offer yet.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {applicants.map((application) => (
              <ApplicantReview key={application.id} application={application} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export default function ApplicantsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="skeleton h-72 w-full" />}>
        <ApplicantsSlot params={params} />
      </Suspense>
    </div>
  );
}

async function ApplicantsSlot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Applicants id={id} />;
}
