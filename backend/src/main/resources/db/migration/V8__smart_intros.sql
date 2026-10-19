-- Smart intros: member profiles carry "offering" and "looking for" tags plus
-- an industry; the scorer matches one member's asks to another member's
-- offers inside the same workspace. Suggestions are persisted snapshots so
-- the page reason-string is stable; requests gate contact behind acceptance
-- (max 3 pending per member at a time).

CREATE TABLE member_profiles (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id     BIGINT       NOT NULL,
  user_id          BIGINT       NOT NULL COMMENT 'global users id',
  offering_tags    JSON         NULL COMMENT 'what this member can give: ["go-to-market", ...]',
  looking_for_tags JSON         NULL COMMENT 'what this member wants: ["fundraising", ...]',
  industry         VARCHAR(80)  NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_member_profiles_ws_user (workspace_id, user_id),
  CONSTRAINT fk_member_profiles_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE intro_requests (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id    BIGINT       NOT NULL,
  from_user_id    BIGINT       NOT NULL COMMENT 'the requester (global users)',
  to_user_id      BIGINT       NOT NULL COMMENT 'the member whose contact was requested',
  status          VARCHAR(12)  NOT NULL DEFAULT 'pending' COMMENT 'pending | accepted | declined',
  reason          VARCHAR(255) NULL COMMENT 'one-line reason carried from the suggestion',
  contacted_at    TIMESTAMP    NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_intro_requests_ws_id (workspace_id, id),
  KEY idx_intro_requests_ws_to (workspace_id, to_user_id, status),
  KEY idx_intro_requests_ws_from (workspace_id, from_user_id, status),
  CONSTRAINT fk_intro_requests_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT chk_intro_requests_status CHECK (status IN ('pending', 'accepted', 'declined'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
