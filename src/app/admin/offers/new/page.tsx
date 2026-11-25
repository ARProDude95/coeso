import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminHeader, AdminNav } from "@/components/admin-nav";
import { OfferForm } from "@/components/offer-form";
import { requireStaff } from "@/lib/auth";
import { listRolesInUse } from "@/lib/roles";
import { isPaidPlan } from "@/lib/settings";

export const metadata: Metadata = {
  title: "New offer",
};

async function NewOffer() {
  const ctx = await requireStaff();
  // Partners can't role-gate or feature an offer, so they never see those
  // switches in the form; the API enforces the same rule.
  const [canGate, roleSuggestions] = ctx.isPartner
    ? [false, []]
    : await Promise.all([isPaidPlan(), listRolesInUse()]);

  return (
    <>
      <AdminHeader
        eyebrow={ctx.isPartner ? "Partner portal" : "Admin"}
        title="New offer"
        description={
          ctx.isPartner
            ? "Submit an offer for admin approval. It goes live once it is approved."
            : "Publish a setter or closer role to the board. It can be paused or closed later."
        }
      />
      <AdminNav current="new" partner={ctx.isPartner} />
      <OfferForm
        canGate={canGate}
        roleSuggestions={roleSuggestions}
        partner={ctx.isPartner}
      />
    </>
  );
}

export default function NewOfferPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="skeleton h-[32rem] w-full" />}>
        <NewOffer />
      </Suspense>
    </div>
  );
}
