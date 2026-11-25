/**
 * Billing schema (Whop subscriptions, processed webhook events, manual-action
 * flags). Kept in its own module so `src/lib/d1.ts` can append it to the
 * startup schema and `tests/subscriptions.test.ts` can create the exact same
 * tables in an in-memory SQLite database.
 */
export const BILLING_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS subscriptions (
     id                  TEXT PRIMARY KEY,
     user_id             TEXT NOT NULL UNIQUE
                           REFERENCES users(id) ON DELETE CASCADE,
     tier                TEXT NOT NULL DEFAULT 'free', -- free | pro | elite
     status              TEXT NOT NULL DEFAULT 'inactive',
     plan_key            TEXT,   -- PRICING_PLANS key
     whop_membership_id  TEXT,
     whop_plan_id        TEXT,
     current_period_end  TEXT,
     cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
     founding            INTEGER NOT NULL DEFAULT 0,
     founding_slot       INTEGER,
     source              TEXT NOT NULL DEFAULT 'whop', -- whop | admin
     created_at          TEXT NOT NULL,
     updated_at          TEXT NOT NULL
   )`,
  // One row per Whop membership, and never two subscribers on the same
  // founding slot — the index is the last line of defence for the race for
  // slot 20 (the claim itself is a single conditional UPDATE).
  `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_membership_idx
     ON subscriptions (whop_membership_id)
     WHERE whop_membership_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_founding_slot_idx
     ON subscriptions (founding_slot)
     WHERE founding_slot IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS subscriptions_founding_idx
     ON subscriptions (founding)`,
  // Idempotency ledger: a duplicate delivery loses the INSERT and is a no-op.
  `CREATE TABLE IF NOT EXISTS whop_events (
     id          TEXT PRIMARY KEY,
     type        TEXT NOT NULL,
     received_at TEXT NOT NULL
   )`,
  // Things an admin has to fix by hand (e.g. charged founding price after the
  // last slot was taken). Never auto-resolved.
  `CREATE TABLE IF NOT EXISTS billing_flags (
     id          TEXT PRIMARY KEY,
     user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind        TEXT NOT NULL,
     detail      TEXT NOT NULL DEFAULT '',
     created_at  TEXT NOT NULL,
     resolved_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS billing_flags_open_idx
     ON billing_flags (kind) WHERE resolved_at IS NULL`,
];
