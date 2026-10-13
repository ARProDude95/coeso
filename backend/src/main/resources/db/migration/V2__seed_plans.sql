-- Seed the four plans (global table, seeded once by Flyway).
INSERT INTO plans (code, name, max_reps, max_members) VALUES
  ('free',      'Free',      10,   3),
  ('starter',   'Starter',   50,   10),
  ('pro',       'Pro',       250,  50),
  ('unlimited', 'Unlimited', NULL, NULL);
