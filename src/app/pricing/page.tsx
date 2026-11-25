import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { CheckoutButton } from "@/components/checkout-button";
import { getAuthContext } from "@/lib/auth";
import {
  FOUNDING_SLOTS,
  formatPrice,
  foundingPlan,
  planId,
  priceFor,
  standardPlans,
  type Currency,
  type PaidTier,
  type PricingPlan,
} from "@/lib/pricing";
import { getFoundingState, getSubscription } from "@/lib/subscriptions";

// Reads the live founding count and the session, so render per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Coeso Offers Board plans — Pro and Elite, paid through Whop. Founding pricing for the first 20 subscribers.",
};

const TIER_FEATURES: Record<PaidTier, string[]> = {
  pro: [
    "Everything on the free board",
    "5 saved searches with in-app and Discord DM alerts",
    "Keyword, tier and minimum-commission filters",
  ],
  elite: [
    "Everything in Pro",
    "15 saved searches",
    "Offer reviews: see ratings and individual partner comments",
  ],
};

function PlanRow({
  plan,
  currency,
  signedIn,
  currentPlanKey,
  spotsLeft,
}: {
  plan: PricingPlan;
  currency: Currency;
  signedIn: boolean;
  currentPlanKey: string | null;
  spotsLeft: number;
}) {
  const configured = Boolean(process.env.WHOP_API_KEY && planId(plan));
  const cadence = plan.interval === "monthly" ? "/mo" : "/yr";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-200">
            {plan.founding
              ? "Founding monthly"
              : plan.interval === "monthly"
                ? "Monthly"
                : "Annual"}
          </span>
          {plan.founding && (
            <span className="badge badge-featured">
              {spotsLeft} of {FOUNDING_SLOTS} left
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-zinc-100">
          {formatPrice(priceFor(plan, currency), currency)}
          <span className="font-normal text-zinc-500">{cadence}</span>
        </p>
      </div>
      <CheckoutButton
        planKey={plan.key}
        label={plan.founding ? "Claim founding price" : "Subscribe"}
        configured={configured}
        signedIn={signedIn}
        current={currentPlanKey === plan.key}
      />
    </div>
  );
}

async function Pricing({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  const params = await searchParams;
  const requestHeaders = await headers();
  const country =
    params.region === "in"
      ? "IN"
      : params.region === "global"
        ? "US"
        : requestHeaders.get("cf-ipcountry");
  const currency: Currency = country === "IN" ? "INR" : "USD";

  const auth = await getAuthContext();
  const [founding, subscription] = await Promise.all([
    getFoundingState(),
    auth ? getSubscription(auth.user.id) : Promise.resolve(null),
  ]);

  const signedIn = Boolean(auth);
  const currentPlanKey = subscription?.planKey ?? null;

  return (
    <div className="flex flex-col gap-8">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
          Pricing
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          The board itself is free. Pro and Elite add saved-search alerts and
          reviews. Checkout, billing and cancellation are handled by Whop.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Show prices in</span>
          <Link
            href="/pricing?region=global"
            className={
              currency === "USD"
                ? "badge badge-accent"
                : "badge badge-neutral"
            }
          >
            USD
          </Link>
          <Link
            href="/pricing?region=in"
            className={
              currency === "INR"
                ? "badge badge-accent"
                : "badge badge-neutral"
            }
          >
            INR
          </Link>
        </div>
      </div>

      <div
        className={`rounded-xl border px-5 py-4 ${
          founding.available
            ? "border-indigo-800/70 bg-indigo-950/30"
            : "border-zinc-800 bg-zinc-900/40"
        }`}
      >
        {founding.available ? (
          <>
            <p className="text-sm font-semibold text-indigo-200">
              Founding price: {founding.left} of {FOUNDING_SLOTS} spots left
            </p>
            <p className="mt-1 text-xs leading-5 text-indigo-200/70">
              The first {FOUNDING_SLOTS} paying subscribers keep founding
              pricing for as long as their subscription stays active. Cancel
              and return later and you pay standard prices — the spot is not
              restored.
            </p>
          </>
        ) : (
          <p className="text-sm font-semibold text-zinc-300">
            Founding spots are gone — standard pricing applies.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(["pro", "elite"] as PaidTier[]).map((tier) => {
          const foundingOption = foundingPlan(tier);
          const plans: PricingPlan[] = [
            ...(foundingOption && founding.available
              ? [foundingOption]
              : []),
            ...standardPlans(tier),
          ];

          return (
            <section key={tier} className="panel flex flex-col p-6">
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-semibold capitalize text-zinc-50">
                  {tier}
                </h2>
                {foundingOption && founding.available && (
                  <span className="badge badge-accent">Founding price</span>
                )}
              </div>
              <ul className="mt-4 flex flex-col gap-2.5 text-sm text-zinc-300">
                {TIER_FEATURES[tier].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 text-indigo-300">•</span>
                    <span className="leading-6">{item}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex flex-col gap-2.5">
                {plans.map((plan) => (
                  <PlanRow
                    key={plan.key}
                    plan={plan}
                    currency={currency}
                    signedIn={signedIn}
                    currentPlanKey={currentPlanKey}
                    spotsLeft={founding.left}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="panel flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-semibold text-zinc-100">Free</p>
          <p className="text-xs text-zinc-500">
            The offers board, applications and admin tools — no card needed.
          </p>
        </div>
        <Link href="/offers" className="btn btn-secondary">
          Go to the board
        </Link>
      </div>

      <p className="text-xs leading-5 text-zinc-500">
        All payments are collected by Whop. Prices are shown explicitly in USD
        or INR — Indian buyers are charged the INR amount above, never a
        converted total. Manage or cancel any time from{" "}
        <Link href="/billing" className="text-indigo-300 hover:text-indigo-200">
          Billing
        </Link>
        .
      </p>
    </div>
  );
}

export default function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  return <Pricing searchParams={searchParams} />;
}
