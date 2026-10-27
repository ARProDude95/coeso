-- Roster — SQLite/D1 port of the MySQL 8 schema (Flyway V1-V11, 40 tables).
-- Conventions preserved from MySQL:
--   * every tenant table carries workspace_id, UNIQUE(workspace_id,id), and
--     COMPOSITE foreign keys (workspace_id, x_id) -> parent(workspace_id, id)
--     so the DB itself rejects cross-tenant links.
--   * global tables (no workspace_id): plans, users.
--   * "active_rep_id" is a generated column enforcing one ACTIVE placement per
--     rep per workspace (NULL when ended; SQLite unique keys allow many NULLs).
-- Dialect notes: INTEGER PK AUTOINCREMENT; JSON/BLOB/DATE/TIMESTAMP -> TEXT/BLOB;
--   MySQL COMMENT/ENGINE/CHARSET clauses dropped; indexes declared separately.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- global ----

CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  max_reps    INTEGER,                -- NULL = unlimited
  max_members INTEGER,                -- NULL = unlimited
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,                 -- nullable: Discord-created users have none
  display_name  TEXT NOT NULL,
  discord_id    TEXT UNIQUE,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspaces (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  name                        TEXT NOT NULL,
  slug                        TEXT NOT NULL UNIQUE,
  plan_id                     INTEGER NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  logo_url                    TEXT,
  accent_color                TEXT,
  custom_domain               TEXT,
  leaderboard_show_names      INTEGER NOT NULL DEFAULT 0,
  office_hours_commission_bp  INTEGER NOT NULL DEFAULT 1000,
  created_at                  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES plans (id)
);
CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces (status);

-- --------------------------------------------------------- tenant lookups ---

CREATE TABLE IF NOT EXISTS verticals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS rep_statuses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('bench','training','inactive')),
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS experience_levels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_ws_position ON pipeline_stages (workspace_id, position);

CREATE TABLE IF NOT EXISTS skill_tags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

-- ----------------------------------------------------------- core tables ----

CREATE TABLE IF NOT EXISTS reps (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id        INTEGER NOT NULL,
  name                TEXT NOT NULL,
  email               TEXT,
  discord_user_id     TEXT,
  vertical_id         INTEGER,
  status_id           INTEGER,
  experience_level_id INTEGER,
  notes               TEXT,
  joined_date         TEXT,
  bio                 TEXT,
  timezone            TEXT,
  hours_per_week      INTEGER,
  available_from      TEXT,
  deleted_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, vertical_id) REFERENCES verticals (workspace_id, id),
  FOREIGN KEY (workspace_id, status_id) REFERENCES rep_statuses (workspace_id, id),
  FOREIGN KEY (workspace_id, experience_level_id) REFERENCES experience_levels (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS idx_reps_ws_deleted ON reps (workspace_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_reps_ws_vertical ON reps (workspace_id, vertical_id);
CREATE INDEX IF NOT EXISTS idx_reps_ws_status ON reps (workspace_id, status_id);
CREATE INDEX IF NOT EXISTS idx_reps_ws_name ON reps (workspace_id, name);

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  INTEGER NOT NULL,
  name          TEXT NOT NULL,
  contact_email TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
CREATE INDEX IF NOT EXISTS idx_clients_ws_name ON clients (workspace_id, name);

CREATE TABLE IF NOT EXISTS offers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id        INTEGER NOT NULL,
  client_id           INTEGER NOT NULL,
  vertical_id         INTEGER,
  title               TEXT NOT NULL,
  seats               INTEGER NOT NULL DEFAULT 1,
  notes               TEXT,
  opens_at            TEXT,
  closes_at           TEXT,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  required_level_id   INTEGER,
  required_language   TEXT,
  tz_window_start     INTEGER,
  tz_window_end       INTEGER,
  start_date          TEXT,
  stage_id            INTEGER,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, client_id) REFERENCES clients (workspace_id, id),
  FOREIGN KEY (workspace_id, vertical_id) REFERENCES verticals (workspace_id, id),
  FOREIGN KEY (workspace_id, required_level_id) REFERENCES experience_levels (workspace_id, id),
  FOREIGN KEY (workspace_id, stage_id) REFERENCES pipeline_stages (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS idx_offers_ws_status ON offers (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_ws_stage ON offers (workspace_id, stage_id);

CREATE TABLE IF NOT EXISTS placements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  INTEGER NOT NULL,
  offer_id      INTEGER NOT NULL,
  rep_id        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  placed_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at      TEXT,
  end_reason    TEXT,
  placed_by     INTEGER,
  active_rep_id INTEGER GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN rep_id ELSE NULL END) STORED,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, active_rep_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, offer_id) REFERENCES offers (workspace_id, id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id),
  FOREIGN KEY (placed_by) REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS idx_placements_ws_status ON placements (workspace_id, status);

CREATE TABLE IF NOT EXISTS placement_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  offer_id     INTEGER NOT NULL,
  rep_id       INTEGER NOT NULL,
  requested_by INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  decided_by   INTEGER,
  decided_at   TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, offer_id) REFERENCES offers (workspace_id, id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id),
  FOREIGN KEY (requested_by) REFERENCES users (id),
  FOREIGN KEY (decided_by) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS memberships (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('owner','admin','manager','rep')),
  rep_id       INTEGER,
  expert       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id);

CREATE TABLE IF NOT EXISTS invites (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin','manager','rep')),
  token_hash   TEXT NOT NULL,          -- SHA-256 hex of raw token; raw never stored
  expires_at   TEXT NOT NULL,
  created_by   INTEGER,
  accepted_at  TEXT,
  accepted_by  INTEGER,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, token_hash),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (created_by) REFERENCES users (id),
  FOREIGN KEY (accepted_by) REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS idx_invites_token_hash ON invites (token_hash);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id            INTEGER NOT NULL,
  plan_id                 INTEGER NOT NULL,
  provider                TEXT,
  provider_customer_id    TEXT,
  provider_subscription_id TEXT,
  status                  TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','canceled')),
  trial_ends_at           TEXT,
  current_period_end      TEXT,
  created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (plan_id) REFERENCES plans (id)
);

CREATE TABLE IF NOT EXISTS billing_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  type         TEXT,
  payload      TEXT,
  received_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (provider, event_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS workspace_discord (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id           INTEGER NOT NULL UNIQUE,
  guild_id               TEXT NOT NULL,
  notification_channel_id TEXT,
  role_map               TEXT,        -- JSON: Discord role id -> workspace role
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  INTEGER NOT NULL,
  actor_user_id INTEGER,
  action        TEXT NOT NULL,        -- CREATE | UPDATE | DELETE | PLACE | UNPLACE
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  details       TEXT,                 -- JSON
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (actor_user_id) REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ws_created ON audit_log (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_ws_entity ON audit_log (workspace_id, entity_type, entity_id);

-- --------------------------------------------------- skills / profile (P6) --

CREATE TABLE IF NOT EXISTS rep_skills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  rep_id       INTEGER NOT NULL,
  tag_id       INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, rep_id, tag_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id),
  FOREIGN KEY (workspace_id, tag_id) REFERENCES skill_tags (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS rep_languages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  rep_id       INTEGER NOT NULL,
  language     TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, rep_id, language),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS rep_preferred_verticals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  rep_id       INTEGER NOT NULL,
  vertical_id  INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, rep_id, vertical_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id),
  FOREIGN KEY (workspace_id, vertical_id) REFERENCES verticals (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS rep_photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  rep_id       INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  data         BLOB NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, rep_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS offer_required_skills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  offer_id     INTEGER NOT NULL,
  tag_id       INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, offer_id, tag_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, offer_id) REFERENCES offers (workspace_id, id),
  FOREIGN KEY (workspace_id, tag_id) REFERENCES skill_tags (workspace_id, id)
);

-- -------------------------------------------- performance & commissions (P7) --

CREATE TABLE IF NOT EXISTS metric_types (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name         TEXT NOT NULL,
  unit         TEXT NOT NULL CHECK (unit IN ('count','currency')),
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS activity_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id   INTEGER NOT NULL,
  placement_id   INTEGER NOT NULL,
  rep_id         INTEGER NOT NULL,
  metric_type_id INTEGER NOT NULL,
  occurred_on    TEXT NOT NULL,
  value_minor    INTEGER NOT NULL CHECK (value_minor >= 0),
  notes          TEXT,
  logged_by      INTEGER,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, placement_id) REFERENCES placements (workspace_id, id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id),
  FOREIGN KEY (workspace_id, metric_type_id) REFERENCES metric_types (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS payouts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id   INTEGER NOT NULL,
  rep_id         INTEGER NOT NULL,
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  entry_count    INTEGER NOT NULL,
  paid_on        TEXT NOT NULL,
  reference_note TEXT,
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS commission_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  offer_id     INTEGER,
  rep_id       INTEGER,
  kind         TEXT NOT NULL CHECK (kind IN ('percent','flat','tiered')),
  rate_bp      INTEGER,
  flat_minor   INTEGER,
  currency     TEXT,
  tiers        TEXT,                 -- JSON: [{upToMinor|null, rateBp}, ...]
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, offer_id) REFERENCES offers (workspace_id, id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       INTEGER NOT NULL,
  placement_id       INTEGER NOT NULL,
  rep_id             INTEGER NOT NULL,
  activity_entry_id  INTEGER NOT NULL,
  commission_rule_id INTEGER,
  payout_id          INTEGER,
  reverses_entry_id  INTEGER,
  status             TEXT NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','approved','paid')),
  amount_minor       INTEGER NOT NULL,   -- positive owed; negative = reversal
  currency           TEXT NOT NULL,
  entered_on         TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, placement_id) REFERENCES placements (workspace_id, id),
  FOREIGN KEY (workspace_id, rep_id) REFERENCES reps (workspace_id, id),
  FOREIGN KEY (workspace_id, activity_entry_id) REFERENCES activity_entries (workspace_id, id),
  FOREIGN KEY (workspace_id, commission_rule_id) REFERENCES commission_rules (workspace_id, id),
  FOREIGN KEY (workspace_id, payout_id) REFERENCES payouts (workspace_id, id),
  FOREIGN KEY (workspace_id, reverses_entry_id) REFERENCES ledger_entries (workspace_id, id)
);

-- ---------------------------------------------------- office hours (P7+) ----

CREATE TABLE IF NOT EXISTS office_hour_slots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id     INTEGER NOT NULL,
  expert_user_id   INTEGER NOT NULL,
  starts_at        TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  price_minor      INTEGER NOT NULL CHECK (price_minor >= 0),
  currency         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','booked','cancelled')),
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS office_hour_bookings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id         INTEGER NOT NULL,
  slot_id              INTEGER NOT NULL,
  expert_user_id       INTEGER NOT NULL,
  member_user_id       INTEGER NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('pending','confirmed','cancelled','refund_pending','refunded')),
  price_minor          INTEGER NOT NULL,
  commission_bp        INTEGER NOT NULL,
  expert_amount_minor  INTEGER NOT NULL,
  platform_amount_minor INTEGER NOT NULL,
  currency             TEXT NOT NULL,
  provider             TEXT,
  provider_order_id    TEXT,
  provider_payment_id  TEXT,
  meeting_link         TEXT,
  confirmed_at         TEXT,
  cancelled_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, slot_id) REFERENCES office_hour_slots (workspace_id, id),
  CHECK (expert_amount_minor + platform_amount_minor = price_minor)
);
CREATE INDEX IF NOT EXISTS idx_bookings_order ON office_hour_bookings (provider_order_id);

CREATE TABLE IF NOT EXISTS payout_ledger_entries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id         INTEGER NOT NULL,
  booking_id           INTEGER NOT NULL,
  expert_user_id       INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','reversed')),
  amount_minor         INTEGER NOT NULL,
  platform_amount_minor INTEGER NOT NULL,
  currency             TEXT NOT NULL,
  reverses_entry_id    INTEGER,
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, booking_id) REFERENCES office_hour_bookings (workspace_id, id),
  FOREIGN KEY (workspace_id, reverses_entry_id) REFERENCES payout_ledger_entries (workspace_id, id)
);

-- ---------------------------------------------------- intros & pods (P8+) ----

CREATE TABLE IF NOT EXISTS member_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id     INTEGER NOT NULL,
  user_id          INTEGER NOT NULL,
  offering_tags    TEXT,             -- JSON array
  looking_for_tags TEXT,             -- JSON array
  industry         TEXT,
  revenue_stage    TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS intro_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  from_user_id INTEGER NOT NULL,
  to_user_id   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  reason       TEXT,
  contacted_at TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS pods (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name         TEXT NOT NULL,
  industry     TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS pod_members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  pod_id       INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, user_id, pod_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, pod_id) REFERENCES pods (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS pod_checkins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  pod_id       INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  week_start   TEXT NOT NULL,        -- ISO Monday
  wins         TEXT NOT NULL,
  blockers     TEXT NOT NULL,
  ask          TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, pod_id, user_id, week_start),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, pod_id) REFERENCES pods (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS pod_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  pod_id       INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  FOREIGN KEY (workspace_id, pod_id) REFERENCES pods (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS idx_pod_messages_ws_pod ON pod_messages (workspace_id, pod_id, id);

-- --------------------------------------------- engagement health + digest ----

CREATE TABLE IF NOT EXISTS engagement_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id   INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  snapshot_date  TEXT NOT NULL,
  score          INTEGER NOT NULL DEFAULT 0,
  audit_actions  INTEGER NOT NULL DEFAULT 0,
  pod_checkins   INTEGER NOT NULL DEFAULT 0,
  pod_messages   INTEGER NOT NULL DEFAULT 0,
  intro_activity INTEGER NOT NULL DEFAULT 0,
  bookings       INTEGER NOT NULL DEFAULT 0,
  days_inactive  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, user_id, snapshot_date),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS digest_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  week_start   TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workspace_id, week_start),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
