-- Phase 6 — skills, profiles and smart matching.
-- Additive only: new columns and new tenant-owned tables, each carrying
-- workspace_id, UNIQUE (workspace_id, id) and COMPOSITE foreign keys, exactly
-- like V1.

-- ------------------------------------------------------------ rep profile ---

ALTER TABLE reps
  ADD COLUMN bio            TEXT        NULL,
  ADD COLUMN timezone       VARCHAR(64) NULL COMMENT 'IANA zone id, e.g. Europe/Berlin',
  ADD COLUMN hours_per_week INT         NULL COMMENT 'weekly availability 0-168',
  ADD COLUMN available_from DATE        NULL COMMENT 'first date the rep can start';

-- ---------------------------------------------------------- offer needs ----

ALTER TABLE offers
  ADD COLUMN required_level_id BIGINT      NULL,
  ADD COLUMN required_language VARCHAR(60) NULL,
  ADD COLUMN tz_window_start   INT         NULL COMMENT 'minutes from UTC, inclusive (0-1439)',
  ADD COLUMN tz_window_end     INT         NULL COMMENT 'minutes from UTC, inclusive (0-1439, wraps if end < start)',
  ADD COLUMN start_date        DATE        NULL;

ALTER TABLE offers
  ADD CONSTRAINT fk_offers_required_level FOREIGN KEY (workspace_id, required_level_id)
    REFERENCES experience_levels (workspace_id, id);

-- ---------------------------------------------------------- skill tags -----

CREATE TABLE skill_tags (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  name         VARCHAR(80) NOT NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_skill_tags_ws_id (workspace_id, id),
  UNIQUE KEY uq_skill_tags_ws_name (workspace_id, name),
  CONSTRAINT fk_skill_tags_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ rep skills ---

CREATE TABLE rep_skills (
  id           BIGINT    NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT    NOT NULL,
  rep_id       BIGINT    NOT NULL,
  tag_id       BIGINT    NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rep_skills_ws_id (workspace_id, id),
  UNIQUE KEY uq_rep_skills_ws_rep_tag (workspace_id, rep_id, tag_id),
  KEY idx_rep_skills_ws_rep (workspace_id, rep_id),
  KEY idx_rep_skills_ws_tag (workspace_id, tag_id),
  CONSTRAINT fk_rep_skills_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_rep_skills_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id),
  CONSTRAINT fk_rep_skills_tag FOREIGN KEY (workspace_id, tag_id)
    REFERENCES skill_tags (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------- rep languages ---

CREATE TABLE rep_languages (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  rep_id       BIGINT      NOT NULL,
  language     VARCHAR(60) NOT NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rep_languages_ws_id (workspace_id, id),
  UNIQUE KEY uq_rep_languages_ws_rep_lang (workspace_id, rep_id, language),
  KEY idx_rep_languages_ws_lang (workspace_id, language),
  CONSTRAINT fk_rep_languages_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_rep_languages_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------- preferred verticals ----

CREATE TABLE rep_preferred_verticals (
  id           BIGINT NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT NOT NULL,
  rep_id       BIGINT NOT NULL,
  vertical_id  BIGINT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rep_pref_ws_id (workspace_id, id),
  UNIQUE KEY uq_rep_pref_ws_rep_vertical (workspace_id, rep_id, vertical_id),
  KEY idx_rep_pref_ws_rep (workspace_id, rep_id),
  CONSTRAINT fk_rep_pref_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_rep_pref_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id),
  CONSTRAINT fk_rep_pref_vertical FOREIGN KEY (workspace_id, vertical_id)
    REFERENCES verticals (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------- photos -----

-- One photo per rep (unique on workspace_id + rep_id); conversationally sized
-- avatars only — the service validates type (png/jpeg/webp/gif) and 2 MB cap.
CREATE TABLE rep_photos (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT       NOT NULL,
  rep_id       BIGINT       NOT NULL,
  content_type VARCHAR(60)  NOT NULL,
  size_bytes   INT          NOT NULL,
  data         LONGBLOB     NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rep_photos_ws_id (workspace_id, id),
  UNIQUE KEY uq_rep_photos_ws_rep (workspace_id, rep_id),
  CONSTRAINT fk_rep_photos_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_rep_photos_rep FOREIGN KEY (workspace_id, rep_id)
    REFERENCES reps (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------- offer required skills -

CREATE TABLE offer_required_skills (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  offer_id     BIGINT      NOT NULL,
  tag_id       BIGINT      NOT NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_offer_req_skills_ws_id (workspace_id, id),
  UNIQUE KEY uq_offer_req_skills_ws_offer_tag (workspace_id, offer_id, tag_id),
  KEY idx_offer_req_skills_ws_offer (workspace_id, offer_id),
  CONSTRAINT fk_offer_req_skills_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_offer_req_skills_offer FOREIGN KEY (workspace_id, offer_id)
    REFERENCES offers (workspace_id, id),
  CONSTRAINT fk_offer_req_skills_tag FOREIGN KEY (workspace_id, tag_id)
    REFERENCES skill_tags (workspace_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;