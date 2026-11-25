import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminHeader, AdminNav } from "@/components/admin-nav";
import { OfferForm } from "@/components/offer-form";
import { requireStaff } from "@/lib/auth";
import { pluralise } from "@/lib/format";
import { getOffer } from "@/lib/offers";
import { canManageOffer, PARTNER_ROLE } from "@/lib/partners";
import { listRolesInUse } from "@/lib/roles";
import { isPaidPlan } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Edit offer",
};

async function EditOffer({ id }: { id: string }) {
  const ctx = await requireStaff();
  const offer = await getOffer(id);
  // Partner isolation: another partner's offer is reported as missing.
  if (
    !offer ||
    !canManageOffer(
      { ...ctx.user, roles: ctx.isPartner ? [PARTNER_ROLE] : [] },
      offer,
    )
  ) {
    notFound();
  }

  const [canGate, roleSuggestions] = ctx.isPartner
    ? [false, []]
    : await Promise.all([isPaidPlan(), listRolesInUse()]);

  return (
    <>
      <AdminHeader
        eyebrow={ctx.isPartner ? "Partner portal" : "Admin"}
        title="Edit offer"
        description="Update the posting, change its status, or set when it expires."
      />
      <AdminNav partner={ctx.isPartner} />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/admin" className="btn btn-secondary">
            ← Dashboard
          </Link>
          <Link
            href={`/admin/offers/${offer.id}/applicants`}
            className="btn btn-secondary"
          >
            {pluralise(offer.applicationCount, "applicant")}
          </Link>
          {offer.approvalStatus === "pending" && (
            <span className="badge badge-pending">Pending approval</span>
          )}
          {offer.approvalStatus === "rejected" && (
            <span className="badge badge-rejected">Rejected</span>
          )}
        </div>
        <OfferForm
          offer={offer}
          canGate={canGate}
          roleSuggestions={roleSuggestions}
          partner={ctx.isPartner}
        />
      </div>
    </>
  );
}

export default function EditOfferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="skeleton h-[32rem] w-full" />}>
        <EditOfferSlot params={params} />
      </Suspense>
    </div>
  );
}

async function EditOfferSlot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditOffer id={id} />;
}
