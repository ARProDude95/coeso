-- Engagement health (churn signals) + weekly digest:
-- engagement_snapshots stores one row per (workspace, member, day) with the
-- member's weighted activity over the trailing 30 days plus days-inactive,
-- written by the nightly job or the owner's "refresh" action. At-risk
-- detection compares a member's latest snapshot against the one before it
-- (sharp drop) and against the inactivity threshold.
-- digest_logs stores the rendered weekly digest per workspace and ISO week;
-- building it is idempotent (unique per week) so cron retries are safe.

CREATE TABLE engagement_snapshots (
  id             BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id   BIGINT      NOT NULL,
  user_id        BIGINT      NOT NULL COMMENT 'global users id',
  snapshot_date  DATE        NOT NULL COMMENT 'the day the window was measured',
  score          INT         NOT NULL DEFAULT 0 COMMENT 'weighted 30-day activity: audit*1 + checkins*4 + messages*2 + intros*3 + bookings*3',
  audit_actions  INT         NOT NULL DEFAULT 0 COMMENT 'audit_log rows by the member in the window',
  pod_checkins   INT         NOT NULL DEFAULT 0,
  pod_messages   INT         NOT NULL DEFAULT 0,
  intro_activity INT         NOT NULL DEFAULT 0 COMMENT 'intro requests sent or received in the window',
  bookings       INT         NOT NULL DEFAULT 0 COMMENT 'office-hour bookings (as member or expert) in the window',
  days_inactive  INT         NOT NULL DEFAULT 0 COMMENT 'days since the member''s last tracked activity of any kind',
  created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_engagement_ws_user_day (workspace_id, user_id, snapshot_date),
  KEY idx_engagement_ws_day (workspace_id, snapshot_date),
  KEY idx_engagement_ws_user (workspace_id, user_id, snapshot_date),
  CONSTRAINT fk_engagement_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE digest_logs (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  week_start   DATE        NOT NULL COMMENT 'ISO Monday of the digest week',
  body         TEXT        NOT NULL COMMENT 'rendered plain-text digest',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_digest_ws_week (workspace_id, week_start),
  KEY idx_digest_ws_week (workspace_id, week_start),
  CONSTRAINT fk_digest_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
