-- Roster demo seed (idempotent: INSERT OR IGNORE, explicit ids).
-- Gives the hosted preview a real, logged-in workspace to explore:
--   demo@example.test / password123  ->  "Demo Agency" (owner)

-- plans (global)
INSERT OR IGNORE INTO plans (id, code, name, max_reps, max_members) VALUES
  (1,'free','Free',10,3),
  (2,'starter','Starter',50,10),
  (3,'pro','Pro',250,50),
  (4,'unlimited','Unlimited',NULL,NULL);

-- demo owner (password = password123, pbkdf2-sha256/100k)
INSERT OR IGNORE INTO users (id, email, password_hash, display_name) VALUES
  (1,'demo@example.test',
   'pbkdf2$100000$63fb75f6f46456fedb6e894f099be22cab12f2d5258dfa54967d6e3c24b5837e$f270bb662dd3571f40d05ad19c93a5edeabbc4e8683deb860451a60fc5a7dd4c',
   'Demo Owner');

-- demo workspace + owner membership
INSERT OR IGNORE INTO workspaces (id, name, slug, plan_id, status) VALUES
  (1,'Demo Agency','demo-agency',1,'active');
INSERT OR IGNORE INTO memberships (workspace_id, user_id, role) VALUES (1,1,'owner');
INSERT OR IGNORE INTO subscriptions (workspace_id, plan_id, status) VALUES (1,1,'trialing');

-- default lookups for workspace 1
INSERT OR IGNORE INTO verticals (id, workspace_id, name) VALUES (1,1,'Sales'),(2,1,'Advertising'),(3,1,'Partnerships');
INSERT OR IGNORE INTO rep_statuses (id, workspace_id, name, kind) VALUES (1,1,'Bench','bench'),(2,1,'Training','training'),(3,1,'Inactive','inactive');
INSERT OR IGNORE INTO experience_levels (id, workspace_id, name) VALUES (1,1,'Junior'),(2,1,'Mid'),(3,1,'Senior');
INSERT OR IGNORE INTO pipeline_stages (id, workspace_id, name, position) VALUES (1,1,'Sourcing',1),(2,1,'Interviewing',2),(3,1,'Onboarding',3),(4,1,'Live',4);
INSERT OR IGNORE INTO metric_types (workspace_id, name, unit) VALUES
  (1,'Calls','count'),(1,'Meetings','count'),(1,'Deals closed','count'),(1,'Revenue generated','currency');

-- clients
INSERT OR IGNORE INTO clients (id, workspace_id, name) VALUES
  (1,1,'Northwind Retail'),(2,1,'Acme SaaS'),(3,1,'Bluebird Fintech'),(4,1,'Verdant Health'),(5,1,'Lumen Media');

-- reps (workspace 1)
INSERT OR IGNORE INTO reps (id, workspace_id, name, vertical_id, status_id, experience_level_id, joined_date) VALUES
  (1,1,'Amara Okafor',1,1,3,'2026-08-12'),
  (2,1,'Diego Ramirez',1,1,2,'2026-07-28'),
  (3,1,'Priya Nair',1,2,1,'2026-09-30'),
  (4,1,'Sofia Almeida',2,1,3,'2026-06-15'),
  (5,1,'Lucas Meyer',2,2,2,'2026-09-10'),
  (6,1,'Fatima Hassan',3,1,3,'2026-05-20'),
  (7,1,'Ethan Brooks',1,1,2,'2026-08-02'),
  (8,1,'Yuki Tanaka',2,1,2,'2026-07-05'),
  (9,1,'Nadia Petrova',3,2,1,'2026-09-22'),
  (10,1,'Marcus Bell',1,3,3,'2026-04-18');

-- offers (2 per board column)
INSERT OR IGNORE INTO offers (id, workspace_id, client_id, vertical_id, title, seats, stage_id) VALUES
  (1,1,1,1,'Retail Sales Lead',1,1),
  (2,1,5,2,'Media Buyer',2,1),
  (3,1,2,1,'BDR Team Lead',1,2),
  (4,1,2,1,'Outbound SDR',2,2),
  (5,1,1,1,'Enterprise AE',2,3),
  (6,1,4,3,'Client Success Manager',2,3),
  (7,1,3,3,'Partnership Manager',1,4),
  (8,1,5,2,'Growth Marketer',3,4);

-- placements (Enterprise AE filled 2/2; the rest partial)
INSERT OR IGNORE INTO placements (id, workspace_id, offer_id, rep_id, status) VALUES
  (1,1,5,2,'active'),
  (2,1,5,7,'active'),
  (3,1,6,6,'active'),
  (4,1,8,1,'active'),
  (5,1,8,4,'active');
