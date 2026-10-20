-- Mastermind pods: an owner/admin groups the workspace's active members into
-- pods of ~5-8 by industry (greedy, industry-adjacent sort; a preview is
-- shown and can be manually adjusted before publishing). Each pod has a
-- private space (only pod members and admins read it) and a weekly check-in
-- of wins / blockers / asks with an attendance streak.

CREATE TABLE pods (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  name         VARCHAR(80) NOT NULL,
  industry     VARCHAR(80) NULL COMMENT 'grouping key; NULL for buckets without a stated industry',
  status       VARCHAR(12) NOT NULL DEFAULT 'active' COMMENT 'active | archived',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pods_ws_id (workspace_id, id),
  KEY idx_pods_ws_status (workspace_id, status),
  CONSTRAINT fk_pods_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT chk_pods_status CHECK (status IN ('active', 'archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE pod_members (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  pod_id       BIGINT      NOT NULL,
  user_id      BIGINT      NOT NULL COMMENT 'global users id',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pod_members_ws_id (workspace_id, id),
  UNIQUE KEY uq_pod_members_once (workspace_id, user_id, pod_id),
  KEY idx_pod_members_ws_user (workspace_id, user_id),
  CONSTRAINT fk_pod_members_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_pod_members_pod FOREIGN KEY (workspace_id, pod_id)
    REFERENCES pods (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE pod_checkins (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT       NOT NULL,
  pod_id       BIGINT       NOT NULL,
  user_id      BIGINT       NOT NULL,
  week_start   DATE         NOT NULL COMMENT 'the ISO Monday of the check-in week',
  wins         VARCHAR(1000) NOT NULL,
  blockers     VARCHAR(1000) NOT NULL,
  ask          VARCHAR(1000) NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_checkins_ws_id (workspace_id, id),
  UNIQUE KEY uq_checkins_week (workspace_id, pod_id, user_id, week_start),
  KEY idx_checkins_ws_pod_week (workspace_id, pod_id, week_start),
  CONSTRAINT fk_checkins_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_checkins_pod FOREIGN KEY (workspace_id, pod_id)
    REFERENCES pods (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
