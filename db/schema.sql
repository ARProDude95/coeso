-- ============================================================
-- Coeso Offers Board — Cloudflare D1 (SQLite) schema
--
-- For reference only: the app creates these objects itself on first
-- request (see src/lib/d1.ts), so there is no migration step to run.
-- Timestamps are ISO-8601 strings; booleans are 0/1.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,           -- pbkdf2$<iterations>$<salt>$<hash>
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  -- Added after the first deployment; src/lib/d1.ts adds these with guarded
  -- ALTER TABLEs on databases that predate them (same for offers.tier and
  -- offers.commission_amount).
  tier          TEXT NOT NULL DEFAULT 'free', -- free | pro | elite
  discord_id    TEXT,                     -- NULL until a Discord sync exists
  -- Public rep-profile handle (/reps/[username]) and the rep's switch that
  -- hides their earnings range. Backfilled from the email local part.
  username      TEXT,
  hide_earnings INTEGER NOT NULL DEFAULT 0
);

-- Site-wide settings: exactly one row, keyed on the constant 'singleton'.
-- `plan` gates the paid features (Discord channel announcement, role gating);
-- `discord_webhook_url` is written from /admin/settings and falls back to the
-- DISCORD_WEBHOOK_URL environment variable when empty; `whop_checkout_url` is
-- the hosted Whop checkout buyers use to purchase the paid plan.
CREATE TABLE IF NOT EXISTS settings (
  id                  TEXT PRIMARY KEY,  -- always 'singleton'
  plan                TEXT NOT NULL DEFAULT 'free', -- free | paid
  discord_webhook_url TEXT NOT NULL DEFAULT '',
  whop_checkout_url   TEXT NOT NULL DEFAULT '',
  updated_at          TEXT NOT NULL
);

-- Access roles on paid plans. Assigned by the admin today; the shape is
-- deliberately Discord-shaped (one row per user per role) so guild roles can
-- be synced in later without changing this schema.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,              -- e.g. 'closer-vip'
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS offers (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  company      TEXT NOT NULL,
  description  TEXT NOT NULL,
  role_type    TEXT NOT NULL,            -- setter | closer | both
  commission   TEXT NOT NULL,
  pay_type     TEXT NOT NULL,
  requirements TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open', -- open | paused | closed
  expires_at   TEXT,                     -- NULL = never expires
  featured     INTEGER NOT NULL DEFAULT 0,
  -- Paid plan only: members lacking this role do not see the offer at all.
  -- Added after the first deployment, so src/lib/d1.ts adds it with a guarded
  -- ALTER TABLE on databases that predate it (same for settings.
  -- whop_checkout_url).
  required_role TEXT,
  -- Audience tier for saved-search filters, and a numeric commission for the
  -- "minimum commission" filter (commission above stays free text).
  tier            TEXT NOT NULL DEFAULT 'free', -- free | pro | elite
  commission_amount INTEGER,
  -- Partner portal: NULL = submitted by an admin. Partner submissions start
  -- 'pending' and only reach the public board once an admin approves them.
  partner_id      TEXT,
  approval_status TEXT NOT NULL DEFAULT 'approved', -- approved | pending | rejected
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Saved searches: a Pro/Elite member's subscribed filter set. The limit per
-- tier (0/5/15) is enforced in src/lib/saved-searches.ts.
CREATE TABLE IF NOT EXISTS saved_searches (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  role_type      TEXT NOT NULL DEFAULT 'all',  -- setter | closer | both | all
  tier           TEXT NOT NULL DEFAULT 'all',  -- free | pro | elite | all
  keywords       TEXT NOT NULL DEFAULT '',
  min_commission INTEGER,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS saved_searches_user_idx ON saved_searches (user_id);

-- In-app notifications (saved-search alerts, reports, admin notices).
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  offer_id   TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id);

-- Offer reviews (Elite feature): ratings from members with an accepted
-- application on that offer, one per user per offer.
CREATE TABLE IF NOT EXISTS offer_reviews (
  id             TEXT PRIMARY KEY,
  offer_id       TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payout_rating  INTEGER NOT NULL,      -- 1..5 payout reliability
  lead_rating    INTEGER NOT NULL,      -- 1..5 lead quality
  support_rating INTEGER NOT NULL,      -- 1..5 support
  comment        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS offer_reviews_offer_user_idx
  ON offer_reviews (offer_id, user_id);

-- Offer reports: one row per reporter per offer. Three *open* unique reports
-- auto-pause the offer (src/lib/reports.ts); dismissing one lowers the count.
CREATE TABLE IF NOT EXISTS offer_reports (
  id          TEXT PRIMARY KEY,
  offer_id    TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open', -- open | dismissed
  created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS offer_reports_offer_reporter_idx
  ON offer_reports (offer_id, reporter_id);
CREATE INDEX IF NOT EXISTS offer_reports_status_idx ON offer_reports (status);

-- Rep performance profile: one logged result per rep per offer (unique
-- index), an optional whole-dollar earnings range, and the owning partner's
-- confirmation.
CREATE TABLE IF NOT EXISTS deals (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id             TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  deals_closed         INTEGER NOT NULL,
  earnings_min         INTEGER,
  earnings_max         INTEGER,
  month                TEXT NOT NULL DEFAULT '', -- YYYY-MM, for the leaderboard
  partner_confirmed_at TEXT,
  partner_confirmed_by TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS deals_user_offer_month_idx
  ON deals (user_id, offer_id, month);
CREATE INDEX IF NOT EXISTS deals_user_idx ON deals (user_id);
CREATE INDEX IF NOT EXISTS deals_offer_idx ON deals (offer_id);
CREATE INDEX IF NOT EXISTS deals_month_idx ON deals (month);

-- Monthly Top Closer awards. One row per month per winner (unique index), so
-- the lazy award job is idempotent; `revoked_at` records the month-end role
-- removal.
CREATE TABLE IF NOT EXISTS leaderboard_awards (
  id           TEXT PRIMARY KEY,
  month        TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank         INTEGER NOT NULL,
  role_granted INTEGER NOT NULL DEFAULT 0,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_awards_month_user_idx
  ON leaderboard_awards (month, user_id);
CREATE INDEX IF NOT EXISTS leaderboard_awards_month_idx
  ON leaderboard_awards (month);

-- Offer analytics: one view per member per offer per UTC day. Applications
-- come from the existing table; this only adds the view counter.
CREATE TABLE IF NOT EXISTS offer_views (
  id         TEXT PRIMARY KEY,
  offer_id   TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  viewer_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_on  TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS offer_views_offer_viewer_day_idx
  ON offer_views (offer_id, viewer_id, viewed_on);
CREATE INDEX IF NOT EXISTS offer_views_offer_idx ON offer_views (offer_id);

CREATE TABLE IF NOT EXISTS applications (
  id                 TEXT PRIMARY KEY,
  offer_id           TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message            TEXT NOT NULL,
  experience_level   TEXT NOT NULL,      -- entry | junior | mid | senior | expert
  availability_hours INTEGER NOT NULL,
  past_results       TEXT,
  status             TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected
  admin_note         TEXT,               -- private: never selected for applicants
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- One application per user per offer, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS applications_offer_user_idx
  ON applications (offer_id, user_id);

CREATE INDEX IF NOT EXISTS applications_user_idx ON applications (user_id);
CREATE INDEX IF NOT EXISTS offers_status_idx ON offers (status);

-- ============================================================
-- Billing (Whop)
--
-- One subscription row per account. Access is always derived from this table
-- (`effectiveTier` in src/lib/pricing.ts), never from client state or from the
-- legacy users.tier column.
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier                 TEXT NOT NULL DEFAULT 'free', -- free | pro | elite
  status               TEXT NOT NULL DEFAULT 'inactive',
                       -- active | past_due | canceled | expired | granted | inactive
  plan_key             TEXT,                       -- key in src/lib/pricing.ts
  whop_membership_id   TEXT,
  whop_plan_id         TEXT,
  current_period_end   TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  founding             INTEGER NOT NULL DEFAULT 0, -- consumed a founding slot
  founding_slot        INTEGER,                    -- 1..FOUNDING_SLOTS, never reused
  source               TEXT NOT NULL DEFAULT 'whop', -- whop | admin
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_membership_idx
  ON subscriptions (whop_membership_id)
  WHERE whop_membership_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_founding_slot_idx
  ON subscriptions (founding_slot)
  WHERE founding_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_founding_idx
  ON subscriptions (founding);

-- Duplicate webhook deliveries lose this INSERT and become no-ops.
CREATE TABLE IF NOT EXISTS whop_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- Manual work for an admin (founding price charged after the last slot, …).
CREATE TABLE IF NOT EXISTS billing_flags (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS billing_flags_open_idx
  ON billing_flags (kind) WHERE resolved_at IS NULL;
