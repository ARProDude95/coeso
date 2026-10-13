-- Phase 5: "Login with Discord".
-- users is a global table (no workspace_id). discord_id links the Discord
-- account to the login identity; password_hash becomes nullable because a user
-- created through Discord never sets a password (password login then fails
-- safely on the null hash).
ALTER TABLE users
  ADD COLUMN discord_id VARCHAR(40) NULL,
  ADD UNIQUE KEY uq_users_discord_id (discord_id),
  MODIFY password_hash VARCHAR(100) NULL;
