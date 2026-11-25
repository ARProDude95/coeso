import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, test } from "node:test";
import {
  FOUNDING_SLOTS,
  PRICING_PLANS,
  effectiveTier,
  foundingSpotsLeft,
  planByKey,
} from "../src/lib/pricing";
import {
  applyMembershipDeactivated,
  applyPaymentFailed,
  assignFoundingSlot,
  claimWhopEvent,
  countFoundingUsed,
  createBillingFlag,
  getFoundingState,
  getSubscription,
  getTiersForUsers,
  grantTier,
  listOpenBillingFlags,
  releaseWhopEvent,
  upsertWhopSubscription,
} from "../src/lib/subscriptions";
import { savedSearchLimit } from "../src/lib/tiers";
import { handleWhopEvent } from "../src/lib/whop-handler";
import { verifyWhopWebhook } from "../src/lib/whop";
import type { WhopEvent } from "../src/lib/whop-events";
import { createBillingDb } from "./helpers/memory-d1";

// Plan ids the app would receive from the environment.
process.env.WHOP_PLAN_ID_PRO_MONTHLY = "plan_pro_monthly";
process.env.WHOP_PLAN_ID_PRO_ANNUAL = "plan_pro_annual";
process.env.WHOP_PLAN_ID_ELITE_MONTHLY = "plan_elite_monthly";
process.env.WHOP_PLAN_ID_ELITE_ANNUAL = "plan_elite_annual";
process.env.WHOP_PLAN_ID_PRO_FOUNDING = "plan_pro_founding";
process.env.WHOP_PLAN_ID_ELITE_FOUNDING = "plan_elite_founding";
process.env.WHOP_WEBHOOK_SECRET = "ws_billing_test_secret";

after(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("WHOP_PLAN_ID_") || key === "WHOP_WEBHOOK_SECRET") {
      delete process.env[key];
    }
  }
});

/* ------------------------------ config ------------------------------ */

test("pricing config is the single source of amounts", () => {
  assert.equal(PRICING_PLANS.length, 6);
  assert.equal(new Set(PRICING_PLANS.map((plan) => plan.key)).size, 6);
  assert.equal(new Set(PRICING_PLANS.map((plan) => plan.envVar)).size, 6);

  const pro = planByKey("pro_monthly");
  const proAnnual = planByKey("pro_annual");
  const elite = planByKey("elite_monthly");
  const eliteAnnual = planByKey("elite_annual");
  const proFounding = planByKey("pro_founding");
  const eliteFounding = planByKey("elite_founding");

  assert.deepEqual(
    [pro?.usd, proAnnual?.usd, elite?.usd, eliteAnnual?.usd],
    [12, 99, 29, 249],
  );
  assert.deepEqual(
    [pro?.inr, elite?.inr, proAnnual?.inr, eliteAnnual?.inr],
    [499, 1_299, 4_999, 12_999],
  );
  assert.deepEqual([proFounding?.usd, eliteFounding?.usd], [9, 19]);
  assert.equal(proFounding?.founding, true);
  assert.equal(eliteFounding?.founding, true);
  assert.equal(pro?.founding, false);
});

test("founding spots never go negative or back up", () => {
  assert.equal(foundingSpotsLeft(0), FOUNDING_SLOTS);
  assert.equal(foundingSpotsLeft(7), 13);
  assert.equal(foundingSpotsLeft(FOUNDING_SLOTS), 0);
  assert.equal(foundingSpotsLeft(FOUNDING_SLOTS + 5), 0);
});

/* ---------------------------- entitlement ---------------------------- */

test("entitlement comes from the subscription status", () => {
  assert.equal(effectiveTier(null), "free");
  assert.equal(
    effectiveTier({ tier: "elite", status: "active" }),
    "elite",
  );
  assert.equal(
    effectiveTier({ tier: "pro", status: "past_due" }),
    "pro",
  );
  assert.equal(
    effectiveTier({ tier: "pro", status: "granted" }),
    "pro",
  );
  assert.equal(
    effectiveTier({ tier: "elite", status: "canceled" }),
    "free",
  );
  assert.equal(
    effectiveTier({ tier: "elite", status: "expired" }),
    "free",
  );
  assert.equal(
    effectiveTier({ tier: "elite", status: "inactive" }),
    "free",
  );
});

test("a canceled subscription loses gated tier access", () => {
  const active = effectiveTier({ tier: "pro", status: "active" });
  const canceled = effectiveTier({ tier: "pro", status: "canceled" });

  assert.equal(savedSearchLimit(active), 5);
  assert.equal(savedSearchLimit(canceled), 0);
  assert.equal(
    savedSearchLimit(effectiveTier({ tier: "elite", status: "canceled" })),
    0,
  );
  assert.equal(
    savedSearchLimit(effectiveTier({ tier: "elite", status: "active" })),
    15,
  );
});

/* ------------------------- webhook signature ------------------------- */

function signedHeaders(body: string, secret = "ws_billing_test_secret") {
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
    "content-type": "application/json",
  };
}

test("a valid SDK signature verifies and returns the event", () => {
  const body = JSON.stringify({
    id: "evt_sig_ok",
    type: "payment.succeeded",
    data: { metadata: { user_id: "u1" } },
  });
  const event = verifyWhopWebhook(body, signedHeaders(body));

  assert.equal(event.id, "evt_sig_ok");
  assert.equal(event.type, "payment.succeeded");
});

test("a wrong or tampered signature is rejected", () => {
  const body = JSON.stringify({
    id: "evt_sig_bad",
    type: "payment.succeeded",
    data: {},
  });
  const headers = signedHeaders(body);

  assert.throws(() =>
    verifyWhopWebhook(body, {
      ...headers,
      "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    }),
  );

  // Same header, different bytes: the raw body is what was signed.
  assert.throws(() =>
    verifyWhopWebhook(
      JSON.stringify({ id: "evt_sig_bad", type: "payment.succeeded", data: { x: 1 } }),
      headers,
    ),
  );

  assert.throws(() =>
    verifyWhopWebhook(body, {
      ...headers,
      "webhook-timestamp": "1",
    }),
  );
});

/* ---------------------------- idempotency ---------------------------- */

test("duplicate event ids are processed once", async () => {
  const db = await createBillingDb();

  assert.equal(await claimWhopEvent("evt_dup", "payment.succeeded", db), true);
  assert.equal(await claimWhopEvent("evt_dup", "payment.succeeded", db), false);

  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM whop_events")
    .first<{ count: number }>();
  assert.equal(row?.count, 1);

  // A failed handler releases the claim so a retry is not swallowed forever.
  await releaseWhopEvent("evt_dup", db);
  assert.equal(await claimWhopEvent("evt_dup", "payment.succeeded", db), true);
});

/* -------------------------- founding slots --------------------------- */

test("the last founding slot can only go to one of two racing checkouts", async () => {
  const db = await createBillingDb();

  for (let index = 0; index < FOUNDING_SLOTS - 1; index += 1) {
    assert.equal(await assignFoundingSlot(`user-${index}`, db), "claimed");
  }
  assert.equal((await getFoundingState(db)).left, 1);

  const [first, second] = await Promise.all([
    assignFoundingSlot("user-race-a", db),
    assignFoundingSlot("user-race-b", db),
  ]);

  const outcomes = [first, second].sort();
  assert.deepEqual(outcomes, ["claimed", "full"]);
  assert.equal(await countFoundingUsed(db), FOUNDING_SLOTS);
  assert.equal((await getFoundingState(db)).available, false);

  // A later claim is always full, and claiming twice does not consume two.
  assert.equal(await assignFoundingSlot("user-late", db), "full");
  const winnerId = first === "claimed" ? "user-race-a" : "user-race-b";
  assert.equal(await assignFoundingSlot(winnerId, db), "already");

  const slots = await db
    .prepare(
      "SELECT founding_slot FROM subscriptions WHERE founding = 1 ORDER BY founding_slot",
    )
    .all<{ founding_slot: number }>();
  assert.deepEqual(
    slots.results?.map((row) => row.founding_slot),
    Array.from({ length: FOUNDING_SLOTS }, (_, index) => index + 1),
  );
});

/* --------------------------- tier changes ---------------------------- */

test("renewal, cancellation and failed payments move the subscription correctly", async () => {
  const db = await createBillingDb();

  await upsertWhopSubscription(
    {
      userId: "u-billing",
      tier: "elite",
      status: "active",
      planKey: "elite_monthly",
      whopMembershipId: "mem_1",
      whopPlanId: "plan_elite_monthly",
      currentPeriodEnd: "2026-05-01T00:00:00.000Z",
    },
    db,
  );

  let subscription = await getSubscription("u-billing", db);
  assert.equal(subscription?.status, "active");
  assert.equal(effectiveTier(subscription), "elite");
  assert.equal(subscription?.currentPeriodEnd, "2026-05-01T00:00:00.000Z");

  // Cancel: access drops immediately, the recorded tier stays.
  await applyMembershipDeactivated("mem_1", db);
  subscription = await getSubscription("u-billing", db);
  assert.equal(subscription?.status, "canceled");
  assert.equal(subscription?.tier, "elite");
  assert.equal(effectiveTier(subscription), "free");

  // Renewal after a lapse re-activates the same row.
  await upsertWhopSubscription(
    {
      userId: "u-billing",
      tier: "elite",
      status: "active",
      planKey: "elite_monthly",
      whopMembershipId: "mem_1",
      currentPeriodEnd: "2026-06-01T00:00:00.000Z",
    },
    db,
  );
  subscription = await getSubscription("u-billing", db);
  assert.equal(subscription?.status, "active");
  assert.equal(effectiveTier(subscription), "elite");
  assert.equal(subscription?.currentPeriodEnd, "2026-06-01T00:00:00.000Z");

  // A failed payment is dunning, not an immediate downgrade.
  await applyPaymentFailed("mem_1", db);
  subscription = await getSubscription("u-billing", db);
  assert.equal(subscription?.status, "past_due");
  assert.equal(effectiveTier(subscription), "elite");
});

test("admin listings read the effective subscription tier, not users.tier", async () => {
  const db = await createBillingDb();
  await upsertWhopSubscription(
    {
      userId: "u-active",
      tier: "elite",
      status: "active",
      planKey: "elite_monthly",
    },
    db,
  );
  await upsertWhopSubscription(
    {
      userId: "u-canceled",
      tier: "pro",
      status: "canceled",
      planKey: "pro_monthly",
    },
    db,
  );

  const tiers = await getTiersForUsers(
    ["u-active", "u-canceled", "u-never-subscribed"],
    db,
  );

  assert.equal(tiers.get("u-active"), "elite");
  assert.equal(tiers.get("u-canceled"), "free");
  assert.equal(tiers.has("u-never-subscribed"), false);
});

/* --------------------------- event handler --------------------------- */

test("a standard payment activates the plan and stores the membership", async () => {
  const db = await createBillingDb();
  await db
    .prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)")
    .bind("u-pay", "Paying Rep", "pay@example.com")
    .run();

  const event: WhopEvent = {
    id: "evt_pay",
    type: "payment.succeeded",
    data: {
      id: "pay_1",
      plan_id: "plan_pro_monthly",
      membership_id: "mem_pay",
      renewal_period_end: 1_893_456_000,
      metadata: { user_id: "u-pay", plan_key: "pro_monthly" },
    },
  };

  await handleWhopEvent(event, "payment_succeeded", db);

  const subscription = await getSubscription("u-pay", db);
  assert.equal(subscription?.tier, "pro");
  assert.equal(subscription?.status, "active");
  assert.equal(subscription?.planKey, "pro_monthly");
  assert.equal(subscription?.whopMembershipId, "mem_pay");
  assert.equal(subscription?.currentPeriodEnd, "2030-01-01T00:00:00.000Z");
  assert.equal(effectiveTier(subscription), "pro");
});

test("a founding payment takes the last slot; the next one overflows to standard and is flagged", async () => {
  const db = await createBillingDb();
  for (let index = 0; index < FOUNDING_SLOTS; index += 1) {
    await assignFoundingSlot(`seed-${index}`, db);
  }
  for (const id of ["u-overflow", "u-overflow-flag"]) {
    await db
      .prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)")
      .bind(id, id, `${id}@example.com`)
      .run();
  }

  await handleWhopEvent(
    {
      id: "evt_overflow",
      type: "payment.succeeded",
      data: {
        id: "pay_overflow",
        plan_id: "plan_pro_founding",
        membership_id: "mem_overflow",
        metadata: { user_id: "u-overflow", plan_key: "pro_founding" },
      },
    },
    "payment_succeeded",
    db,
  );

  const subscription = await getSubscription("u-overflow", db);
  assert.equal(subscription?.founding, false);
  assert.equal(subscription?.planKey, "pro_monthly");
  assert.equal(subscription?.tier, "pro");
  assert.equal(subscription?.status, "active");

  const flags = await listOpenBillingFlags(db);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].kind, "founding_overflow");
  assert.match(flags[0].detail, /plan_pro_founding/);
});

test("deactivation and cancel-at-period-end events update the row", async () => {
  const db = await createBillingDb();
  await db
    .prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)")
    .bind("u-cancel", "Cancel Rep", "cancel@example.com")
    .run();

  await upsertWhopSubscription(
    {
      userId: "u-cancel",
      tier: "pro",
      status: "active",
      planKey: "pro_monthly",
      whopMembershipId: "mem_cancel",
    },
    db,
  );

  await handleWhopEvent(
    {
      id: "evt_cancel_flag",
      type: "membership.cancel_at_period_end_changed",
      data: { id: "mem_cancel", cancel_at_period_end: true },
    },
    "cancel_at_period_end",
    db,
  );

  let subscription = await getSubscription("u-cancel", db);
  assert.equal(subscription?.cancelAtPeriodEnd, true);
  assert.equal(effectiveTier(subscription), "pro");

  await handleWhopEvent(
    {
      id: "evt_deactivate",
      type: "membership.deactivated",
      data: { id: "mem_cancel" },
    },
    "membership_deactivated",
    db,
  );

  subscription = await getSubscription("u-cancel", db);
  assert.equal(subscription?.status, "canceled");
  assert.equal(effectiveTier(subscription), "free");
});

test("an admin grant overrides billing, and a flag can be closed", async () => {
  const db = await createBillingDb();
  await db
    .prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)")
    .bind("u-flag", "Flag Rep", "flag@example.com")
    .run();

  const granted = await grantTier("u-flag", "elite", db);
  assert.equal(granted.status, "granted");
  assert.equal(granted.source, "admin");
  assert.equal(effectiveTier(granted), "elite");

  await createBillingFlag(
    { userId: "u-flag", kind: "founding_overflow", detail: "manual check" },
    db,
  );
  const flags = await listOpenBillingFlags(db);
  assert.equal(flags.length, 1);

  const resolved = await db
    .prepare(
      "UPDATE billing_flags SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL",
    )
    .bind(new Date().toISOString(), flags[0].id)
    .run();
  assert.equal(resolved.meta?.changes, 1);
  assert.equal((await listOpenBillingFlags(db)).length, 0);
});
