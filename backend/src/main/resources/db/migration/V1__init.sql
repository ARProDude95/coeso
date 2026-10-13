-- Roster: core multi-tenant schema (MySQL 8, InnoDB).
--
-- Conventions:
--   * Every tenant-owned table carries workspace_id, has UNIQUE (workspace_id, id),
--     and references parent tenant tables through COMPOSITE foreign keys
--     (workspace_id, x_id) -> parent(workspace_id, id), so the database itself
--     rejects cross-tenant links.
--   * Global tables (no workspace_id): plans, users.
--   * "Placed" and "Filled" are derived: no stored columns for them.
--     placements.active_rep_id is a generated column enforcing at most one
--     ACTIVE placement per rep per workspace (NULL for ended rows, and MySQL
--     unique keys allow multiple NULLs).

-- ---------------------------------------------------------------- global ----

CREATE TABLE plans (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  code        VARCHAR(32)  NOT NULL,
  name        VARCHAR(100) NOT NULL,
  max_reps    INT          NULL COMMENT 'NULL = unlimited',
  max_members INT          NULL COMMENT 'NULL = unlimited',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plans_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  display_name  VARCHAR(120) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE workspaces (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120) NOT NULL,
  slug          VARCHAR(63)  NOT NULL,
  plan_id       BIGINT       NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'active',
  logo_url      VARCHAR(500) NULL,
  accent_color  VARCHAR(16)  NULL,
  custom_domain VARCHAR(255) NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workspaces_slug (slug),
  KEY idx_workspaces_status (status),
  CONSTRAINT fk_workspaces_plan FOREIGN KEY (plan_id) REFERENCES plans (id),
  CONSTRAINT chk_workspaces_status CHECK (status IN ('active', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------- tenant lookups ---

CREATE TABLE verticals (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT       NOT NULL,
  name         VARCHAR(100) NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_verticals_ws_id (workspace_id, id),
  UNIQUE KEY uq_verticals_ws_name (workspace_id, name),
  CONSTRAINT fk_verticals_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE rep_statuses (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  name         VARCHAR(60) NOT NULL,
  kind         VARCHAR(16) NOT NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rep_statuses_ws_id (workspace_id, id),
  UNIQUE KEY uq_rep_statuses_ws_name (workspace_id, name),
  CONSTRAINT fk_rep_statuses_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT chk_rep_statuses_kind CHECK (kind IN ('bench', 'training', 'inactive'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE experience_levels (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  name         VARCHAR(60) NOT NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_experience_levels_ws_id (workspace_id, id),
  UNIQUE KEY uq_experience_levels_ws_name (workspace_id, name),
  CONSTRAINT fk_experience_levels_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------------------------------------- core tables ----

CREATE TABLE reps (
  id                  BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id        BIGINT       NOT NULL,
  name                VARCHAR(120) NOT NULL,
  email               VARCHAR(255) NULL,
  discord_user_id     VARCHAR(40)  NULL,
  vertical_id         BIGINT       NULL,
  status_id           BIGINT       NULL,
  experience_level_id BIGINT       NULL,
  notes               TEXT         NULL,
  joined_date         DATE         NULL,
  deleted_at          TIMESTAMP    NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reps_ws_id (workspace_id, id),
  KEY idx_reps_ws_deleted (workspace_id, deleted_at),
  KEY idx_reps_ws_vertical (workspace_id, vertical_id),
  KEY idx_reps_ws_status (workspace_id, status_id),
  KEY idx_reps_ws_experience (workspace_id, experience_level_id),
  KEY idx_reps_ws_name (workspace_id, name),
  CONSTRAINT fk_reps_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_reps_vertical FOREIGN KEY (workspace_id, vertical_id)
    REFERENCES verticals (workspace_id, id),
  CONSTRAINT fk_reps_status FOREIGN KEY (workspace_id, status_id)
    REFERENCES rep_statuses (workspace_id, id),
  CONSTRAINT fk_reps_experience FOREIGN KEY (workspace_id, experience_level_id)
    REFERENCES experience_levels (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE clients (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id  BIGINT       NOT NULL,
  name          VARCHAR(120) NOT NULL,
  contact_email VARCHAR(255) NULL,
  notes         TEXT         NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clients_ws_id (workspace_id, id),
  KEY idx_clients_ws_name (workspace_id, name),
  CONSTRAINT fk_clients_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE offers (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT       NOT NULL,
  client_id    BIGINT       NOT NULL,
  vertical_id  BIGINT       NULL,
  title        VARCHAR(200) NOT NULL,
  seats        INT          NOT NULL DEFAULT 1,
  notes        TEXT         NULL,
  opens_at     DATE         NULL,
  closes_at    DATE         NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'open',
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_offers_ws_id (workspace_id, id),
  KEY idx_offers_ws_status (workspace_id, status),
  KEY idx_offers_ws_vertical (workspace_id, vertical_id),
  KEY idx_offers_ws_title (workspace_id, title),
  CONSTRAINT fk_offers_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_offers_client FOREIGN KEY (workspace_id, client_id)
    REFERENCES clients (workspace_id, id),
  CONSTRAINT fk_offers_vertical FOREIGN KEY (workspace_id, vertical_id)
    REFERENCES verticals (workspace_id, id),
  CONSTRAINT chk_offers_status CHECK (status IN ('open', 'closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE placements (
  id            BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id  BIGINT      NOT NULL,
  offer_id      BIGINT      NOT NULL,
  rep_id        BIGINT      NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'active',
  placed_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at      TIMESTAMP   NULL,
  end_reason    VARCHAR(255) NULL,
  placed_by     BIGINT      NULL,
  -- Generated: rep_id while the placement is active, NULL once ended.
  -- The unique key below is what enforces one active placement per rep.
  active_rep_id BIGINT      GENERATED ALWAYS AS
      (CASE WHEN status = 'active' THEN rep_id ELSE NULL END) STORED,
  created_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_placements_ws_id (workspace_id, id),
  UNIQUE KEY uq_placements_ws_active_rep (workspace_id, active_rep_id),
  KEY idx_placements_ws_status (workspace_id, status),
  KEY idx_placements_ws_placed_at (workspace_id, placed_at),
  CONSTRAINT fk_placements_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_placements_offer FOREIGN KEY (workspace_id, offer_id)
    REFERENCES offers (workspace_id, id),
  CONSTRAINT fk_placements_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id),
  CONSTRAINT fk_placements_placed_by FOREIGN KEY (placed_by) REFERENCES users (id),
  CONSTRAINT chk_placements_status CHECK (status IN ('active', 'ended'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE placement_requests (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT       NOT NULL,
  offer_id     BIGINT       NOT NULL,
  rep_id       BIGINT       NOT NULL,
  requested_by BIGINT       NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'pending',
  decided_by   BIGINT       NULL,
  decided_at   TIMESTAMP    NULL,
  note         TEXT         NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_placement_requests_ws_id (workspace_id, id),
  KEY idx_placement_requests_ws_status (workspace_id, status),
  KEY idx_placement_requests_ws_offer (workspace_id, offer_id),
  KEY idx_placement_requests_ws_rep (workspace_id, rep_id),
  CONSTRAINT fk_placement_requests_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_placement_requests_offer FOREIGN KEY (workspace_id, offer_id)
    REFERENCES offers (workspace_id, id),
  CONSTRAINT fk_placement_requests_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id),
  CONSTRAINT fk_placement_requests_requested_by FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_placement_requests_decided_by FOREIGN KEY (decided_by) REFERENCES users (id),
  CONSTRAINT chk_placement_requests_status CHECK (status IN ('pending', 'approved', 'declined'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE memberships (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  user_id      BIGINT      NOT NULL,
  role         VARCHAR(16) NOT NULL,
  rep_id       BIGINT      NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_memberships_ws_id (workspace_id, id),
  UNIQUE KEY uq_memberships_ws_user (workspace_id, user_id),
  KEY idx_memberships_user (user_id),
  CONSTRAINT fk_memberships_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_memberships_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id),
  CONSTRAINT chk_memberships_role CHECK (role IN ('owner', 'admin', 'manager', 'rep'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE invites (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  email        VARCHAR(255) NOT NULL,
  role         VARCHAR(16) NOT NULL,
  token_hash   CHAR(64)    NOT NULL COMMENT 'SHA-256 hex of the raw token; raw token is never stored',
  expires_at   TIMESTAMP   NOT NULL,
  created_by   BIGINT      NULL,
  accepted_at  TIMESTAMP   NULL,
  accepted_by  BIGINT      NULL,
  revoked_at   TIMESTAMP   NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invites_ws_id (workspace_id, id),
  UNIQUE KEY uq_invites_ws_token (workspace_id, token_hash),
  KEY idx_invites_token_hash (token_hash),
  KEY idx_invites_ws_email (workspace_id, email),
  CONSTRAINT fk_invites_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_invites_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_invites_accepted_by FOREIGN KEY (accepted_by) REFERENCES users (id),
  CONSTRAINT chk_invites_role CHECK (role IN ('admin', 'manager', 'rep'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE subscriptions (
  id                      BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id            BIGINT      NOT NULL,
  plan_id                 BIGINT      NOT NULL,
  provider                VARCHAR(32) NULL,
  provider_customer_id    VARCHAR(128) NULL,
  provider_subscription_id VARCHAR(128) NULL,
  status                  VARCHAR(16) NOT NULL DEFAULT 'trialing',
  trial_ends_at           TIMESTAMP   NULL,
  current_period_end      TIMESTAMP   NULL,
  created_at              TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscriptions_ws_id (workspace_id, id),
  KEY idx_subscriptions_ws_status (workspace_id, status),
  CONSTRAINT fk_subscriptions_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES plans (id),
  CONSTRAINT chk_subscriptions_status
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE billing_events (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT       NOT NULL,
  provider     VARCHAR(32)  NOT NULL,
  event_id     VARCHAR(128) NOT NULL,
  type         VARCHAR(128) NULL,
  payload      JSON         NULL,
  received_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_events_ws_id (workspace_id, id),
  UNIQUE KEY uq_billing_events_provider_event (provider, event_id),
  KEY idx_billing_events_ws_received (workspace_id, received_at),
  CONSTRAINT fk_billing_events_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE workspace_discord (
  id                    BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id          BIGINT      NOT NULL,
  guild_id              VARCHAR(40) NOT NULL,
  notification_channel_id VARCHAR(40) NULL,
  role_map              JSON        NULL COMMENT 'Discord role id -> workspace role',
  created_at            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workspace_discord_ws_id (workspace_id, id),
  UNIQUE KEY uq_workspace_discord_ws (workspace_id),
  CONSTRAINT fk_workspace_discord_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_log (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id  BIGINT       NOT NULL,
  actor_user_id BIGINT       NULL,
  action        VARCHAR(32)  NOT NULL COMMENT 'CREATE | UPDATE | DELETE | PLACE | UNPLACE',
  entity_type   VARCHAR(48)  NOT NULL,
  entity_id     BIGINT       NOT NULL,
  details       JSON         NULL,
  created_at    TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_audit_log_ws_id (workspace_id, id),
  KEY idx_audit_log_ws_created (workspace_id, created_at),
  KEY idx_audit_log_ws_entity (workspace_id, entity_type, entity_id),
  CONSTRAINT fk_audit_log_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_audit_log_actor FOREIGN KEY (actor_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
