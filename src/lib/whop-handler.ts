import "server-only";
import type { D1Database } from "./d1";
import {
  counterpartPlan,
  FOUNDING_SLOTS,
  planByKey,
  planByWhopId,
  planId,
  type PricingPlan,
} from "./pricing";
import {
  applyCancelAtPeriodEnd,
  applyMembershipDeactivated,
  applyPaymentFailed,
  assignFoundingSlot,
  createBillingFlag,
  ensureSubscriptionRow,
  getSubscription,
  getSubscriptionByMembershipId,
  upsertWhopSubscription,
} from "./subscriptions";
import {
  appUserId,
  cancelAtPeriodEndOf,
  eventMetadata,
  eventType,
  membershipIdOf,
  metadataString,
  paymentSummary,
  periodEndOf,
  whopPlanIdOf,
  type WhopEvent,
  type WhopEventKind,
} from "./whop-events";

/**
 * Turns a verified Whop webhook into subscription state.
 *
 * Order of authority: our `metadata.user_id` → the subscription already bound
 * to the membership id. Nothing in the payload can choose a different account
 * after the fact.
 */

function resolvePlan(event: WhopEvent): PricingPlan | null {
  const byPlanId = planByWhopId(whopPlanIdOf(event));
  if (byPlanId) return byPlanId;
  const key = metadataString(event, "plan_key");
  return key ? planByKey(key) : null;
}

async function resolveUserId(
  event: WhopEvent,
  kind: WhopEventKind,
  db?: D1Database,
): Promise<string | null> {
  const direct = appUserId(event);
  if (direct) return direct;

  const membershipId = membershipIdOf(event, kind);
  if (membershipId) {
    const subscription = await getSubscriptionByMembershipId(membershipId, db);
    if (subscription) return subscription.userId;
  }
  return null;
}

function logIgnored(event: WhopEvent, reason: string): void {
  console.warn(
    `[whop] ignored ${eventType(event) || "unknown"} (${reason})`,
    eventMetadata(event),
  );
}

export async function handleWhopEvent(
  event: WhopEvent,
  kind: WhopEventKind,
  db?: D1Database,
): Promise<void> {
  if (kind === "ignored") return;

  const membershipId = membershipIdOf(event, kind);
  const receivedPlanId = whopPlanIdOf(event);

  if (kind === "payment_succeeded" || kind === "membership_activated") {
    const userId = await resolveUserId(event, kind, db);
    const plan = resolvePlan(event);
    if (!userId) return logIgnored(event, "no app user id in metadata");
    if (!plan) return logIgnored(event, "unknown Whop plan");

    const periodEnd = periodEndOf(event);

    // Founding pricing is allocated here, at the first confirmed payment /
    // activation, with a single atomic UPDATE. Losing the race (or arriving
    // after the 20th slot) falls back to the standard plan and is flagged for
    // an admin instead of silently granting a slot that does not exist.
    if (plan.founding) {
      const claim = await assignFoundingSlot(userId, db);
      if (claim === "full") {
        const fallback =
          counterpartPlan(plan) ?? plan;
        await upsertWhopSubscription(
          {
            userId,
            tier: fallback.tier,
            status: "active",
            planKey: fallback.key,
            whopMembershipId: membershipId,
            whopPlanId: receivedPlanId ?? planId(plan),
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
          },
          db,
        );
        await createBillingFlag(
          {
            userId,
            kind: "founding_overflow",
            detail: `Founding checkout completed after all ${FOUNDING_SLOTS} slots were used; moved to ${fallback.label}. ${paymentSummary(event)}`.trim(),
          },
          db,
        );
        return;
      }
    }

    await upsertWhopSubscription(
      {
        userId,
        tier: plan.tier,
        status: "active",
        planKey: plan.key,
        whopMembershipId: membershipId,
        whopPlanId: receivedPlanId ?? planId(plan),
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
      db,
    );
    return;
  }

  if (kind === "membership_deactivated") {
    const userId = await resolveUserId(event, kind, db);
    if (userId) await ensureSubscriptionRow(userId, db);
    if (!membershipId && !userId) {
      return logIgnored(event, "no membership id or app user id");
    }
    await applyMembershipDeactivated(
      membershipId ?? "",
      db,
      userId ?? undefined,
    );
    return;
  }

  if (kind === "cancel_at_period_end") {
    if (!membershipId) return logIgnored(event, "no membership id");
    await applyCancelAtPeriodEnd(
      membershipId,
      cancelAtPeriodEndOf(event),
      db,
    );
    return;
  }

  if (kind === "payment_failed") {
    const userId = await resolveUserId(event, kind, db);
    if (userId) {
      const existing = await getSubscription(userId, db);
      if (!existing) await ensureSubscriptionRow(userId, db);
    }
    if (!membershipId && !userId) {
      return logIgnored(event, "no membership id or app user id");
    }
    await applyPaymentFailed(membershipId ?? "", db, userId ?? undefined);
  }
}
