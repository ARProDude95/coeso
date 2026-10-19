-- Paid office hours: members flagged "expert" publish bookable, paid time
-- slots; other members book and pay through Razorpay; the platform keeps a
-- configurable commission (default 10% = 1000 basis points).
--
-- MONEY: integer minor units (paise) + a currency code, like phase 5/7.
-- Percentages are basis points (commission_bp: 1000 = 10.00%).

ALTER TABLE memberships
  ADD COLUMN expert TINYINT(1) NOT NULL DEFAULT 0
      COMMENT 'expert: may publish paid office-hour slots';

ALTER TABLE workspaces
  ADD COLUMN office_hours_commission_bp INT NOT NULL DEFAULT 1000
      COMMENT 'platform commission on office-hour bookings, basis points (cap 5000)';

-- ------------------------------------------------------------ slots --------
CREATE TABLE office_hour_slots (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id     BIGINT       NOT NULL,
  expert_user_id   BIGINT       NOT NULL COMMENT 'memberships.expert user (global users)',
  starts_at        TIMESTAMP    NOT NULL,
  duration_minutes INT          NOT NULL COMMENT '15..240',
  price_minor      BIGINT       NOT NULL COMMENT 'bookings charge this, in minor units',
  currency         VARCHAR(3)   NOT NULL,
  status           VARCHAR(16)  NOT NULL DEFAULT 'open' COMMENT 'open | booked | cancelled',
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_slots_ws_id (workspace_id, id),
  KEY idx_slots_ws_expert (workspace_id, expert_user_id, status),
  KEY idx_slots_ws_start (workspace_id, starts_at),
  CONSTRAINT fk_slots_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT chk_slots_duration CHECK (duration_minutes BETWEEN 15 AND 240),
  CONSTRAINT chk_slots_price CHECK (price_minor >= 0),
  CONSTRAINT chk_slots_status CHECK (status IN ('open', 'booked', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------- bookings -------
-- A booking is only CONFIRMED by the verified payment webhook; the client
-- never reports success. Cancellation and refund each have their own status
-- and audit trail (audit_log entity_type = 'office_hour_booking').

CREATE TABLE office_hour_bookings (
  id                BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id      BIGINT       NOT NULL,
  slot_id           BIGINT       NOT NULL,
  expert_user_id    BIGINT       NOT NULL COMMENT 'denormalised from the slot',
  member_user_id    BIGINT       NOT NULL COMMENT 'the booking member (global users)',
  status            VARCHAR(24)  NOT NULL COMMENT 'pending | confirmed | cancelled | refund_pending | refunded',
  price_minor       BIGINT       NOT NULL,
  commission_bp     INT          NOT NULL COMMENT 'commission captured at booking time',
  expert_amount_minor  BIGINT    NOT NULL COMMENT 'price minus commission',
  platform_amount_minor BIGINT   NOT NULL COMMENT 'commission captured at booking time',
  currency          VARCHAR(3)   NOT NULL,
  provider          VARCHAR(16)  NULL,
  provider_order_id VARCHAR(64)  NULL,
  provider_payment_id VARCHAR(64) NULL,
  meeting_link      VARCHAR(500) NULL COMMENT 'pasteable, editable by either party',
  confirmed_at      TIMESTAMP    NULL,
  cancelled_at      TIMESTAMP    NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookings_ws_id (workspace_id, id),
  KEY idx_bookings_ws_slot (workspace_id, slot_id),
  KEY idx_bookings_ws_member (workspace_id, member_user_id, status),
  KEY idx_bookings_ws_expert (workspace_id, expert_user_id, status),
  KEY idx_bookings_order (provider_order_id),
  CONSTRAINT fk_bookings_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_bookings_slot FOREIGN KEY (workspace_id, slot_id)
    REFERENCES office_hour_slots (workspace_id, id),
  CONSTRAINT chk_bookings_status CHECK
    (status IN ('pending', 'confirmed', 'cancelled', 'refund_pending', 'refunded')),
  CONSTRAINT chk_bookings_split CHECK (expert_amount_minor >= 0
    AND platform_amount_minor >= 0
    AND expert_amount_minor + platform_amount_minor = price_minor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------- payout ledger entries ---
-- Append-only, reversing style like ledger_entries: refunds are negative
-- reversal rows pointing at the entry they cancel.

CREATE TABLE payout_ledger_entries (
  id                  BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id        BIGINT       NOT NULL,
  booking_id          BIGINT       NOT NULL,
  expert_user_id      BIGINT       NOT NULL,
  status              VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending | paid | reversed',
  amount_minor        BIGINT       NOT NULL COMMENT 'expert proceeds; negative = reversal',
  platform_amount_minor BIGINT     NOT NULL COMMENT 'commission booked; negative = reversal',
  currency            VARCHAR(3)   NOT NULL,
  reverses_entry_id   BIGINT       NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payout_ledger_ws_id (workspace_id, id),
  KEY idx_payout_ledger_ws_expert (workspace_id, expert_user_id, status),
  KEY idx_payout_ledger_ws_booking (workspace_id, booking_id),
  CONSTRAINT fk_payout_ledger_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_payout_ledger_booking FOREIGN KEY (workspace_id, booking_id)
    REFERENCES office_hour_bookings (workspace_id, id),
  CONSTRAINT fk_payout_ledger_reverses FOREIGN KEY (workspace_id, reverses_entry_id)
    REFERENCES payout_ledger_entries (workspace_id, id),
  CONSTRAINT chk_payout_ledger_status CHECK (status IN ('pending', 'paid', 'reversed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
