-- Phase 7 — performance, commissions and payouts [PRO].
-- Additive only: per-workspace metric types, per-placement activity entries,
-- commission rules (default / per offer / per rep), an append-only earnings
-- ledger (reversing corrections), payout records, and one workspace setting.
--
-- MONEY: always integer minor units + a currency code, never floats.
-- Percentages are basis points (rate_bp: 2500 = 25.00%).

ALTER TABLE workspaces
  ADD COLUMN leaderboard_show_names TINYINT(1) NOT NULL DEFAULT 0
      COMMENT '1 = reps see other reps names on the leaderboard';

-- --------------------------------------------------------- metric types ----
-- Per-workspace vocabulary for activity: defaults are seeded for existing
-- workspaces right below; new rows come from the API (the "custom" metric).

CREATE TABLE metric_types (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  name         VARCHAR(60) NOT NULL,
  unit         VARCHAR(16) NOT NULL COMMENT 'count | currency (minor units)',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_metric_types_ws_id (workspace_id, id),
  UNIQUE KEY uq_metric_types_ws_name (workspace_id, name),
  CONSTRAINT fk_metric_types_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT chk_metric_types_unit CHECK (unit IN ('count', 'currency'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO metric_types (workspace_id, name, unit)
SELECT w.id, d.name, d.unit
FROM workspaces w
CROSS JOIN (
  SELECT 'Calls' AS name, 'count' AS unit
  UNION ALL SELECT 'Meetings', 'count'
  UNION ALL SELECT 'Deals closed', 'count'
  UNION ALL SELECT 'Revenue generated', 'currency'
) d;

-- ------------------------------------------------------- activity entries ---

CREATE TABLE activity_entries (
  id             BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id   BIGINT      NOT NULL,
  placement_id   BIGINT      NOT NULL,
  rep_id         BIGINT      NOT NULL COMMENT 'denormalised from the placement',
  metric_type_id BIGINT      NOT NULL,
  occurred_on    DATE        NOT NULL,
  value_minor    BIGINT      NOT NULL COMMENT 'count, or money in minor units',
  notes          VARCHAR(255) NULL,
  logged_by      BIGINT      NULL,
  created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_activity_ws_id (workspace_id, id),
  KEY idx_activity_ws_placement (workspace_id, placement_id),
  KEY idx_activity_ws_rep (workspace_id, rep_id),
  KEY idx_activity_ws_date (workspace_id, occurred_on),
  KEY idx_activity_ws_metric_date (workspace_id, metric_type_id, occurred_on),
  CONSTRAINT fk_activity_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_activity_placement FOREIGN KEY (workspace_id, placement_id)
    REFERENCES placements (workspace_id, id),
  CONSTRAINT fk_activity_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id),
  CONSTRAINT fk_activity_metric FOREIGN KEY (workspace_id, metric_type_id)
    REFERENCES metric_types (workspace_id, id),
  CONSTRAINT chk_activity_value CHECK (value_minor >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ payouts ------
-- Created before ledger_entries so the ledger can FK its payout_id.

CREATE TABLE payouts (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT       NOT NULL,
  rep_id          BIGINT       NOT NULL,
  amount_minor    BIGINT       NOT NULL COMMENT 'sum of the batched entries',
  currency        VARCHAR(3)   NOT NULL,
  entry_count     INT          NOT NULL,
  paid_on         DATE         NOT NULL,
  reference_note  VARCHAR(255) NULL,
  created_by      BIGINT       NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payouts_ws_id (workspace_id, id),
  KEY idx_payouts_ws_rep (workspace_id, rep_id),
  KEY idx_payouts_ws_paid_on (workspace_id, paid_on),
  CONSTRAINT fk_payouts_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_payouts_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------ commission rules ----
-- Scope is (offer_id, rep_id): workspace default = (NULL, NULL); per offer =
-- (offer, NULL); rep override = (NULL, rep); most specific wins at resolve.

CREATE TABLE commission_rules (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  offer_id     BIGINT      NULL,
  rep_id       BIGINT      NULL,
  kind         VARCHAR(16) NOT NULL COMMENT 'percent | flat | tiered',
  rate_bp      INT         NULL COMMENT 'percent: basis points (2500 = 25%)',
  flat_minor   BIGINT      NULL COMMENT 'flat: amount per revenue entry (minor units)',
  currency     VARCHAR(3)  NULL COMMENT 'currency of revenue these terms expect',
  tiers        JSON        NULL COMMENT 'tiered: [{upToMinor|null, rateBp}, ...] ascending',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_commission_rules_ws_id (workspace_id, id),
  KEY idx_commission_rules_scope (workspace_id, offer_id, rep_id),
  CONSTRAINT fk_commission_rules_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_commission_rules_offer FOREIGN KEY (workspace_id, offer_id)
    REFERENCES offers (workspace_id, id),
  CONSTRAINT fk_commission_rules_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id),
  CONSTRAINT chk_commission_rules_kind CHECK (kind IN ('percent', 'flat', 'tiered'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------- ledger entries ----
-- Append-only: rows are never edited in place. Corrections are new rows whose
-- reverses_entry_id points at the row they cancel (negative amount, same
-- status). Statuses move accrued -> approved -> paid; paid rows can never be
-- reversed.

CREATE TABLE ledger_entries (
  id                 BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id       BIGINT       NOT NULL,
  placement_id       BIGINT       NOT NULL,
  rep_id             BIGINT       NOT NULL,
  activity_entry_id  BIGINT       NOT NULL COMMENT 'the revenue row this was computed from',
  commission_rule_id BIGINT       NULL,
  payout_id          BIGINT       NULL,
  reverses_entry_id  BIGINT       NULL COMMENT 'corrections point at the row they cancel',
  status             VARCHAR(16)  NOT NULL DEFAULT 'accrued',
  amount_minor       BIGINT       NOT NULL COMMENT 'positive = owed to rep; negative = reversal',
  currency           VARCHAR(3)   NOT NULL,
  entered_on         DATE         NOT NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ledger_ws_id (workspace_id, id),
  KEY idx_ledger_ws_rep_status (workspace_id, rep_id, status),
  KEY idx_ledger_ws_activity (workspace_id, activity_entry_id),
  KEY idx_ledger_ws_payout (workspace_id, payout_id),
  CONSTRAINT fk_ledger_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_ledger_placement FOREIGN KEY (workspace_id, placement_id)
    REFERENCES placements (workspace_id, id),
  CONSTRAINT fk_ledger_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id),
  CONSTRAINT fk_ledger_activity FOREIGN KEY (workspace_id, activity_entry_id)
    REFERENCES activity_entries (workspace_id, id),
  CONSTRAINT fk_ledger_rule FOREIGN KEY (workspace_id, commission_rule_id)
    REFERENCES commission_rules (workspace_id, id),
  CONSTRAINT fk_ledger_payout FOREIGN KEY (workspace_id, payout_id)
    REFERENCES payouts (workspace_id, id),
  CONSTRAINT fk_ledger_reverses FOREIGN KEY (workspace_id, reverses_entry_id)
    REFERENCES ledger_entries (workspace_id, id),
  CONSTRAINT chk_ledger_status CHECK (status IN ('accrued', 'approved', 'paid'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;