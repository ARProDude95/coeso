-- Phase 8 — the offer pipeline. Each workspace owns an ordered set of stages;
-- an offer sits in exactly one stage, which is how the kanban board groups it.
-- The default stage names mirror DefaultSeedService.DEFAULT_STAGES.

CREATE TABLE pipeline_stages (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT      NOT NULL,
  name         VARCHAR(60) NOT NULL,
  position     INT         NOT NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pipeline_stages_ws_id (workspace_id, id),
  UNIQUE KEY uq_pipeline_stages_ws_name (workspace_id, name),
  KEY idx_pipeline_stages_ws_position (workspace_id, position),
  CONSTRAINT fk_pipeline_stages_ws FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The offer's column. NULL only transiently (the backfill below assigns one).
ALTER TABLE offers ADD COLUMN stage_id BIGINT NULL;
ALTER TABLE offers
  ADD CONSTRAINT fk_offers_stage FOREIGN KEY (workspace_id, stage_id)
    REFERENCES pipeline_stages (workspace_id, id);

-- Default stages for workspaces that already exist (new ones come from
-- DefaultSeedService; NOT EXISTS keeps this re-runnable and per-workspace).
INSERT INTO pipeline_stages (workspace_id, name, position)
SELECT w.id, d.name, d.position
FROM workspaces w
JOIN (
  SELECT 'Sourcing' AS name, 1 AS position
  UNION ALL SELECT 'Interviewing', 2
  UNION ALL SELECT 'Onboarding', 3
  UNION ALL SELECT 'Live', 4
) d
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages s WHERE s.workspace_id = w.id);

-- Existing offers start in the first column.
UPDATE offers
SET stage_id = (
  SELECT s.id FROM pipeline_stages s
  WHERE s.workspace_id = offers.workspace_id
  ORDER BY s.position ASC, s.id ASC
  LIMIT 1
)
WHERE stage_id IS NULL
  AND EXISTS (SELECT 1 FROM pipeline_stages s
              WHERE s.workspace_id = offers.workspace_id);