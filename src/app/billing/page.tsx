import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BillingAdmin } from "@/components/billing-admin";
import { requireMember } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { effectiveTier, planByKey } from "@/lib/pricing";
import {
  getSubscription,
  listOpenBillingFlags,
  listSubscriptions,
} from "@/lib/subscriptions";
import { listUsers } from "@/lib/users";
import type { SubscriptionStatus } from "@/lib/types";

export const metadata: Metadata = {
  title: "Billing",
};

const STATUS_CLASS: Record<SubscriptionStatus, string> = {
  active: "badge badge-open",
  past_due: "badge badge-paused",
  canceled: "badge badge-closed",
  expired: "badge badge-closed",
  granted: "badge badge-accent",
  inactive: "badge badge-neutral",
};

const STATUS_COPY: Record<SubscriptionStatus, string> = {
  active: "Active",
  past_due: "Payment failed — update your card on Whop",
  canceled: "Canceled",
  expired: "Expired",
  granted: "Granted by an admin",
  inactive: "Free plan",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-800/70 py-2.5 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-right text-sm text-zinc-200">{value}</dd>
    </div>
  );
}

async function Billing({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const ctx = await requireMember();
  const params = await searchParams;

  const subscription = await getSubscription(ctx.user.id);
  const plan = subscription?.planKey ? planByKey(subscription.planKey) : null;
  const tier = subscription ? effectiveTier(subscription) : ctx.user.tier;

  const isAdmin = ctx.user.isAdmin;
  const [flags, members, allSubscriptions] = isAdmin
    ? await Promise.all([
        listOpenBillingFlags(),
        listUsers(),
        listSubscriptions(),
      ])
    : [[], [], []];

  const foundingMembers = allSubscriptions.filter((row) => row.founding).length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Billing
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Your plan, its status, and the Whop portal where payment methods and
          cancellation live.
        </p>
      </header>

      {params.checkout === "success" && (
        <p className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          Checkout complete. Your plan updates as soon as Whop confirms the
          payment — refresh in a moment if it still shows the old one.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className="panel p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Current plan
              </p>
              <h2 className="mt-1 text-xl font-semibold capitalize text-zinc-50">
                {tier === "free" ? "Free" : tier}
              </h2>
            </div>
            {subscription && (
              <span className={STATUS_CLASS[subscription.status]}>
                {STATUS_COPY[subscription.status]}
              </span>
            )}
          </div>

          <dl className="mt-5">
            <Row
              label="Billing plan"
              value={plan?.label ?? (subscription ? "Custom" : "No subscription")}
            />
            <Row
              label="Status"
              value={
                subscription ? STATUS_COPY[subscription.status] : "Free plan"
              }
            />
            <Row
              label="Renews / ends"
              value={
                subscription?.currentPeriodEnd
                  ? formatDate(subscription.currentPeriodEnd)
                  : "—"
              }
            />
            {subscription?.founding && (
              <Row
                label="Founding member"
                value={
                  <span className="badge badge-featured">
                    Slot {subscription.foundingSlot ?? "—"} of 20
                  </span>
                }
              />
            )}
            {subscription?.cancelAtPeriodEnd && subscription.status === "active" && (
              <Row
                label="Cancellation"
                value="Scheduled for the end of the current period"
              />
            )}
            <Row
              label="Source"
              value={
                subscription?.source === "admin"
                  ? "Granted by an admin"
                  : subscription
                    ? "Whop"
                    : "—"
              }
            />
          </dl>

          <div className="mt-5 flex flex-wrap gap-2">
            {subscription && (
              <a
                href={env.whopManageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                Manage or cancel on Whop ↗
              </a>
            )}
            <Link href="/pricing" className="btn btn-secondary">
              {tier === "free" ? "See plans" : "Change plan"}
            </Link>
          </div>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Access is read from the subscription record, never from this page.
            Canceling on Whop removes paid access at the end of the billing
            period; founding pricing is not restored if you come back.
          </p>
        </section>

        <aside className="panel h-fit p-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Founding slots
          </p>
          <p className="mt-1 text-2xl font-semibold text-zinc-50">
            {foundingMembers} / 20 used
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            Slots are consumed for good: a founding member who cancels does not
            free one, so the public “spots left” count cannot go back up.
          </p>
          {isAdmin && (
            <p className="mt-3 text-xs text-zinc-400">
              {flags.length > 0
                ? `${flags.length} billing issue${flags.length === 1 ? "" : "s"} need attention below.`
                : "No billing issues need attention."}
            </p>
          )}
        </aside>
      </div>

      {isAdmin && (
        <BillingAdmin
          members={members.map((member) => ({
            id: member.id,
            name: member.name,
            email: member.email,
          }))}
          flags={flags.map((flag) => ({
            id: flag.id,
            name: flag.name,
            email: flag.email,
            kind: flag.kind,
            detail: flag.detail,
          }))}
        />
      )}

      {isAdmin && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            All subscriptions
          </h2>
          {allSubscriptions.length === 0 ? (
            <div className="panel px-6 py-8 text-center">
              <p className="text-sm text-zinc-400">No subscriptions yet.</p>
            </div>
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3 font-medium">Member</th>
                    <th className="px-5 py-3 font-medium">Plan</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Period end</th>
                    <th className="px-5 py-3 font-medium">Founding</th>
                  </tr>
                </thead>
                <tbody>
                  {allSubscriptions.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-zinc-800/60 last:border-0"
                    >
                      <td className="px-5 py-3">
                        <p className="text-zinc-100">{row.name}</p>
                        <p className="text-xs text-zinc-500">{row.email}</p>
                      </td>
                      <td className="px-5 py-3 text-zinc-300">
                        {row.planKey ? planByKey(row.planKey)?.label ?? row.planKey : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span className={STATUS_CLASS[row.status]}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-400">
                        {row.currentPeriodEnd
                          ? formatDate(row.currentPeriodEnd)
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-zinc-400">
                        {row.founding ? `#${row.foundingSlot ?? "?"}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="skeleton h-96 w-full" />}>
        <Billing searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
