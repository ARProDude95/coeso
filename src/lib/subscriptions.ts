import "server-only";
import { getDb, type D1Database } from "./d1";
import {
  effectiveTier,
  FOUNDING_SLOTS,
  foundingAvailable,
  foundingSpotsLeft,
  type PaidTier,
} from "./pricing";
import type {
  Subscription,
  SubscriptionStatus,
  Tier,
} from "./types";

/**
 * The subscriptions table is the source of truth for paid access.
 *
 * Every function takes an optional `database` so the SQLite-backed tests can
 * exercise the real statements (including the founding-slot race and webhook
 * idempotency) without a D1 binding. In the app the argument is omitted.
 */

export interface SubscriptionRow {
  id: string;
  user_id: string;
  tier: string;
  status: string;
  plan_key: string | null;
  whop_membership_id: string | null;
  whop_plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  founding: number;
  founding_slot: number | null;
  source: string;
  created_at: string;
  updated_at: string;
}

const TIERS: Tier[] = ["free", "pro", "elite"];
const STATUSES: SubscriptionStatus[] = [
  "active",
  "past_due",
  "canceled",
  "expired",
  "granted",
  "inactive",
];

function toTier(value: string): Tier {
  return TIERS.includes(value as Tier) ? (value as Tier) : "free";
}

function toStatus(value: string): SubscriptionStatus {
  return STATUSES.includes(value as SubscriptionStatus)
    ? (value as SubscriptionStatus)
    : "inactive";
}

export function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    tier: toTier(row.tier),
    status: toStatus(row.status),
    planKey: row.plan_key,
    whopMembershipId: row.whop_membership_id,
    whopPlanId: row.whop_plan_id,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    founding: row.founding === 1,
    foundingSlot: row.founding_slot,
    source: row.source === "admin" ? "admin" : "whop",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function database(db?: D1Database): Promise<D1Database> {
  return db ?? (await getDb());
}

export async function getSubscription(
  userId: string,
  db?: D1Database,
): Promise<Subscription | null> {
  const d1 = await database(db);
  const row = await d1
    .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .bind(userId)
    .first<SubscriptionRow>();
  return row ? toSubscription(row) : null;
}

export async function getSubscriptionByMembershipId(
  membershipId: string,
  db?: D1Database,
): Promise<Subscription | null> {
  if (!membershipId) return null;
  const d1 = await database(db);
  const row = await d1
    .prepare("SELECT * FROM subscriptions WHERE whop_membership_id = ?")
    .bind(membershipId)
    .first<SubscriptionRow>();
  return row ? toSubscription(row) : null;
}

export interface SubscriptionWithUser extends Subscription {
  name: string;
  email: string;
}

export async function listSubscriptions(
  db?: D1Database,
): Promise<SubscriptionWithUser[]> {
  const d1 = await database(db);
  const { results } = await d1
    .prepare(
      `SELECT s.*, u.name AS user_name, u.email AS user_email
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
        ORDER BY s.updated_at DESC`,
    )
    .all<SubscriptionRow & { user_name: string; user_email: string }>();

  return (results ?? []).map((row) => ({
    ...toSubscription(row),
    name: row.user_name,
    email: row.user_email,
  }));
}

/**
 * Effective tier per account, for admin listings. Accounts with no
 * subscription are absent from the map (the caller falls back to
 * `users.tier`), and canceled rows deliberately map to `free`.
 */
export async function getTiersForUsers(
  userIds: string[],
  db?: D1Database,
): Promise<Map<string, Tier>> {
  const tiers = new Map<string, Tier>();
  if (userIds.length === 0) return tiers;

  const d1 = await database(db);
  const CHUNK = 90; // D1 caps a statement at 100 bound parameters.

  for (let index = 0; index < userIds.length; index += CHUNK) {
    const chunk = userIds.slice(index, index + CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results } = await d1
      .prepare(
        `SELECT * FROM subscriptions WHERE user_id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<SubscriptionRow>();

    for (const row of results ?? []) {
      tiers.set(row.user_id, effectiveTier(toSubscription(row)));
    }
  }

  return tiers;
}

/** Slots consumed for good — a lapsed founding member does not free one. */
export async function countFoundingUsed(db?: D1Database): Promise<number> {
  const d1 = await database(db);
  const row = await d1
    .prepare("SELECT COUNT(*) AS count FROM subscriptions WHERE founding = 1")
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export interface FoundingState {
  used: number;
  slots: number;
  left: number;
  available: boolean;
}

export async function getFoundingState(db?: D1Database): Promise<FoundingState> {
  const used = await countFoundingUsed(db);
  return {
    used,
    slots: FOUNDING_SLOTS,
    left: foundingSpotsLeft(used),
    available: foundingAvailable(used),
  };
}

/** Creates the (free, inactive) row a claim or webhook can update. */
export async function ensureSubscriptionRow(
  userId: string,
  db?: D1Database,
): Promise<void> {
  const d1 = await database(db);
  const now = new Date().toISOString();
  await d1
    .prepare(
      `INSERT INTO subscriptions (
         id, user_id, tier, status, plan_key, whop_membership_id,
         whop_plan_id, current_period_end, cancel_at_period_end, founding,
         founding_slot, source, created_at, updated_at
       ) VALUES (?, ?, 'free', 'inactive', NULL, NULL, NULL, NULL, 0, 0, NULL,
                 'whop', ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), userId, now, now)
    .run();
}

export interface WhopSubscriptionInput {
  userId: string;
  tier: PaidTier | Tier;
  status: SubscriptionStatus;
  planKey: string | null;
  whopMembershipId?: string | null;
  whopPlanId?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}

/**
 * Upserts by user. Founding fields are never touched here: a renewal (or a
 * standard-plan payment from a founding member) must not clear the slot they
 * already hold.
 */
export async function upsertWhopSubscription(
  input: WhopSubscriptionInput,
  db?: D1Database,
): Promise<Subscription> {
  const d1 = await database(db);
  const now = new Date().toISOString();

  await d1
    .prepare(
      `INSERT INTO subscriptions (
         id, user_id, tier, status, plan_key, whop_membership_id,
         whop_plan_id, current_period_end, cancel_at_period_end, founding,
         founding_slot, source, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'whop', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tier = excluded.tier,
         status = excluded.status,
         plan_key = excluded.plan_key,
         whop_membership_id = COALESCE(
           excluded.whop_membership_id, subscriptions.whop_membership_id
         ),
         whop_plan_id = COALESCE(
           excluded.whop_plan_id, subscriptions.whop_plan_id
         ),
         current_period_end = COALESCE(
           excluded.current_period_end, subscriptions.current_period_end
         ),
         cancel_at_period_end = excluded.cancel_at_period_end,
         source = 'whop',
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.tier,
      input.status,
      input.planKey,
      input.whopMembershipId ?? null,
      input.whopPlanId ?? null,
      input.currentPeriodEnd ?? null,
      input.cancelAtPeriodEnd ? 1 : 0,
      now,
      now,
    )
    .run();

  const subscription = await getSubscription(input.userId, d1);
  if (!subscription) {
    throw new Error("upsertWhopSubscription: row missing after upsert");
  }
  return subscription;
}

export type FoundingClaim = "claimed" | "already" | "full";

/**
 * Claims one of the FOUNDING_SLOTS for this user.
 *
 * The claim is a single conditional UPDATE — SQLite executes it atomically, so
 * two simultaneous checkouts can never both read 19/20 and take slot 20. The
 * partial unique index on `founding_slot` is the second guard; a loser falls
 * through to `"full"` and the caller redirects it to the standard plan.
 */
export async function assignFoundingSlot(
  userId: string,
  db?: D1Database,
): Promise<FoundingClaim> {
  const d1 = await database(db);
  await ensureSubscriptionRow(userId, d1);

  const existing = await getSubscription(userId, d1);
  if (existing?.founding) return "already";

  const now = new Date().toISOString();
  try {
    await d1
      .prepare(
        `UPDATE subscriptions
            SET founding = 1,
                founding_slot = (
                  SELECT COALESCE(MAX(founding_slot), 0) + 1
                    FROM subscriptions WHERE founding = 1
                ),
                updated_at = ?
          WHERE user_id = ?
            AND founding = 0
            AND (SELECT COUNT(*) FROM subscriptions WHERE founding = 1) < ?`,
      )
      .bind(now, userId, FOUNDING_SLOTS)
      .run();
  } catch (error) {
    // A concurrent claim won the slot; the unique index rejected ours.
    console.error("[subscriptions] founding slot race lost:", error);
  }

  const after = await getSubscription(userId, d1);
  return after?.founding ? "claimed" : "full";
}

/** membership.deactivated: access stops now, the recorded tier stays for history. */
export async function applyMembershipDeactivated(
  membershipId: string,
  db?: D1Database,
  userId?: string,
): Promise<boolean> {
  const d1 = await database(db);
  const now = new Date().toISOString();
  const result = membershipId
    ? await d1
        .prepare(
          `UPDATE subscriptions
              SET status = 'canceled', cancel_at_period_end = 1, updated_at = ?
            WHERE whop_membership_id = ?`,
        )
        .bind(now, membershipId)
        .run()
    : await d1
        .prepare(
          `UPDATE subscriptions
              SET status = 'canceled', cancel_at_period_end = 1, updated_at = ?
            WHERE user_id = ?`,
        )
        .bind(now, userId ?? "")
        .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Scheduled cancellation: still active until the period ends. */
export async function applyCancelAtPeriodEnd(
  membershipId: string,
  cancel: boolean,
  db?: D1Database,
): Promise<boolean> {
  const d1 = await database(db);
  const result = await d1
    .prepare(
      `UPDATE subscriptions
          SET cancel_at_period_end = ?, updated_at = ?
        WHERE whop_membership_id = ?`,
    )
    .bind(cancel ? 1 : 0, new Date().toISOString(), membershipId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** A failed payment moves the subscription into dunning, not straight to free. */
export async function applyPaymentFailed(
  membershipId: string,
  db?: D1Database,
  userId?: string,
): Promise<boolean> {
  const d1 = await database(db);
  const now = new Date().toISOString();
  const result = membershipId
    ? await d1
        .prepare(
          `UPDATE subscriptions SET status = 'past_due', updated_at = ?
            WHERE whop_membership_id = ?`,
        )
        .bind(now, membershipId)
        .run()
    : await d1
        .prepare(
          `UPDATE subscriptions SET status = 'past_due', updated_at = ?
            WHERE user_id = ?`,
        )
        .bind(now, userId ?? "")
        .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Admin-only override. Writes the authoritative subscription row (status
 * `granted`), and the caller also updates `users.tier` so the legacy admin
 * listing agrees. A later Whop webhook takes the row back over.
 */
export async function grantTier(
  userId: string,
  tier: Tier,
  db?: D1Database,
): Promise<Subscription> {
  const d1 = await database(db);
  const now = new Date().toISOString();
  await d1
    .prepare(
      `INSERT INTO subscriptions (
         id, user_id, tier, status, plan_key, whop_membership_id,
         whop_plan_id, current_period_end, cancel_at_period_end, founding,
         founding_slot, source, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, 0,
                 NULL, 'admin', ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         tier = excluded.tier,
         status = excluded.status,
         source = 'admin',
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      tier,
      tier === "free" ? "inactive" : "granted",
      now,
      now,
    )
    .run();

  const subscription = await getSubscription(userId, d1);
  if (!subscription) throw new Error("grantTier: row missing after upsert");
  return subscription;
}

/** True when this event id was new (and is now recorded). Idempotency gate. */
export async function claimWhopEvent(
  id: string,
  type: string,
  db?: D1Database,
): Promise<boolean> {
  const d1 = await database(db);
  const result = await d1
    .prepare(
      "INSERT OR IGNORE INTO whop_events (id, type, received_at) VALUES (?, ?, ?)",
    )
    .bind(id, type, new Date().toISOString())
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Lets Whop retry an event whose processing failed after it was claimed. */
export async function releaseWhopEvent(
  id: string,
  db?: D1Database,
): Promise<void> {
  const d1 = await database(db);
  await d1.prepare("DELETE FROM whop_events WHERE id = ?").bind(id).run();
}

export async function createBillingFlag(
  input: { userId: string; kind: string; detail: string },
  db?: D1Database,
): Promise<void> {
  const d1 = await database(db);
  await d1
    .prepare(
      `INSERT INTO billing_flags (id, user_id, kind, detail, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.kind,
      input.detail,
      new Date().toISOString(),
    )
    .run();
}

export interface BillingFlag {
  id: string;
  userId: string;
  name: string;
  email: string;
  kind: string;
  detail: string;
  createdAt: string;
}

export async function listOpenBillingFlags(
  db?: D1Database,
): Promise<BillingFlag[]> {
  const d1 = await database(db);
  const { results } = await d1
    .prepare(
      `SELECT f.*, u.name AS user_name, u.email AS user_email
         FROM billing_flags f
         JOIN users u ON u.id = f.user_id
        WHERE f.resolved_at IS NULL
        ORDER BY f.created_at DESC`,
    )
    .all<{
      id: string;
      user_id: string;
      kind: string;
      detail: string;
      created_at: string;
      user_name: string;
      user_email: string;
    }>();

  return (results ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.user_name,
    email: row.user_email,
    kind: row.kind,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

export async function resolveBillingFlag(
  id: string,
  db?: D1Database,
): Promise<boolean> {
  const d1 = await database(db);
  const result = await d1
    .prepare(
      "UPDATE billing_flags SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL",
    )
    .bind(new Date().toISOString(), id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
