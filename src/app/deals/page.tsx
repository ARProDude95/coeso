import type { Metadata } from "next";
import { Suspense } from "react";
import { DealLog } from "@/components/deal-log";
import { requireMember } from "@/lib/auth";
import { listDealsForUser, listWorkableOffers } from "@/lib/deals";

export const metadata: Metadata = {
  title: "My deals",
};

async function Deals() {
  const ctx = await requireMember();
  const [deals, offers] = await Promise.all([
    listDealsForUser(ctx.user.id),
    listWorkableOffers(ctx.user.id),
  ]);

  return (
    <DealLog
      deals={deals}
      offers={offers.map((offer) => ({
        id: offer.id,
        title: offer.title,
        company: offer.company,
      }))}
      hideEarnings={ctx.user.hideEarnings}
      username={ctx.user.username}
    />
  );
}

export default function DealsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          My deals
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Log closed deals and your earnings range per offer. Your public
          profile shows your totals — you decide whether earnings are visible.
        </p>
      </header>
      <Suspense fallback={<div className="skeleton h-96 w-full" />}>
        <Deals />
      </Suspense>
    </div>
  );
}
