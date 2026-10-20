-- Completes the mastermind-pods spec:
--   1. Grouping is "by industry AND revenue stage" — the stage lives on the
--      same per-member profile intros already owns (nullable, so existing
--      profiles keep working and pods fall back to industry-only labels).
--   2. Every pod gets a private thread — messages are readable/writable only
--      by the pod's members and workspace admins (enforced in the service),
--      scoped by (workspace_id, pod_id) like the rest of the pod tables.

ALTER TABLE member_profiles
  ADD COLUMN revenue_stage VARCHAR(40) NULL
    COMMENT 'growth band used for pod grouping, e.g. Seed / Series B / ₹1-5Cr';

CREATE TABLE pod_messages (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT        NOT NULL,
  pod_id       BIGINT        NOT NULL,
  user_id      BIGINT        NOT NULL COMMENT 'global users id',
  body         VARCHAR(1000) NOT NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pod_messages_ws_id (workspace_id, id),
  KEY idx_pod_messages_ws_pod (workspace_id, pod_id, id),
  CONSTRAINT fk_pod_messages_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_pod_messages_pod FOREIGN KEY (workspace_id, pod_id)
    REFERENCES pods (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
