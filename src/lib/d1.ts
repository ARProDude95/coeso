import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { BILLING_SCHEMA } from "./billing-schema";

/**
 * Minimal structural types for the D1 binding, so the app does not depend on
 * a global `@cloudflare/workers-types` install. The real binding satisfies
 * these shapes.
 */
export interface D1Result<T> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
     id            TEXT PRIMARY KEY,
     email         TEXT NOT NULL UNIQUE,
     name          TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     is_admin      INTEGER NOT NULL DEFAULT 0,
     created_at    TEXT NOT NULL,
     username      TEXT,
     hide_earnings INTEGER NOT NULL DEFAULT 0
   )`,
  // Site-level plan flag, the Discord channel webhook and the Whop checkout
  // link. One row with the constant id 'singleton'; see src/lib/settings.ts.
  `CREATE TABLE IF NOT EXISTS settings (
     id                  TEXT PRIMARY KEY,
     plan                TEXT NOT NULL DEFAULT 'free',
     discord_webhook_url TEXT NOT NULL DEFAULT '',
     whop_checkout_url   TEXT NOT NULL DEFAULT '',
     updated_at          TEXT NOT NULL
   )`,
  // Paid-plan access roles, currently assigned by the admin. Designed to be
  // filled from Discord's API later without a schema change.
  `CREATE TABLE IF NOT EXISTS user_roles (
     user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role       TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (user_id, role)
   )`,
  `CREATE TABLE IF NOT EXISTS offers (
     id            TEXT PRIMARY KEY,
     title         TEXT NOT NULL,
     company       TEXT NOT NULL,
     description   TEXT NOT NULL,
     role_type     TEXT NOT NULL,
     commission    TEXT NOT NULL,
     pay_type      TEXT NOT NULL,
     requirements  TEXT NOT NULL DEFAULT '',
     status        TEXT NOT NULL DEFAULT 'open',
     expires_at    TEXT,
     featured      INTEGER NOT NULL DEFAULT 0,
     required_role TEXT,
     created_by    TEXT NOT NULL,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS applications (
     id                 TEXT PRIMARY KEY,
     offer_id           TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
     user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     message            TEXT NOT NULL,
     experience_level   TEXT NOT NULL,
     availability_hours INTEGER NOT NULL,
     past_results       TEXT,
     status             TEXT NOT NULL DEFAULT 'pending',
     admin_note         TEXT,
     created_at         TEXT NOT NULL,
     updated_at         TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS applications_offer_user_idx
     ON applications (offer_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS applications_user_idx ON applications (user_id)`,
  `CREATE INDEX IF NOT EXISTS offers_status_idx ON offers (status)`,
  // Saved searches (Pro/Elite) — a filter set a member subscribes to.
  `CREATE TABLE IF NOT EXISTS saved_searches (
     id             TEXT PRIMARY KEY,
     user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name           TEXT NOT NULL,
     role_type      TEXT NOT NULL DEFAULT 'all',
     tier           TEXT NOT NULL DEFAULT 'all',
     keywords       TEXT NOT NULL DEFAULT '',
     min_commission INTEGER,
     created_at     TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS saved_searches_user_idx ON saved_searches (user_id)`,
  // In-app notifications: the delivery path that always works, with or
  // without a Discord bot configured.
  `CREATE TABLE IF NOT EXISTS notifications (
     id         TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind       TEXT NOT NULL,
     title      TEXT NOT NULL,
     body       TEXT NOT NULL DEFAULT '',
     offer_id   TEXT,
     read_at    TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id)`,
  // Offer reviews (Elite): one per user per offer, enforced by the index.
  `CREATE TABLE IF NOT EXISTS offer_reviews (
     id             TEXT PRIMARY KEY,
     offer_id       TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
     user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     payout_rating  INTEGER NOT NULL,
     lead_rating    INTEGER NOT NULL,
     support_rating INTEGER NOT NULL,
     comment        TEXT NOT NULL DEFAULT '',
     created_at     TEXT NOT NULL,
     updated_at     TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS offer_reviews_offer_user_idx
     ON offer_reviews (offer_id, user_id)`,
  // Offer reports: one row per reporter per offer ("3 unique reports"),
  // tracked as open until an admin dismisses them.
  `CREATE TABLE IF NOT EXISTS offer_reports (
     id          TEXT PRIMARY KEY,
     offer_id    TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
     reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     reason      TEXT NOT NULL,
     status      TEXT NOT NULL DEFAULT 'open', -- open | dismissed
     created_at  TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS offer_reports_offer_reporter_idx
     ON offer_reports (offer_id, reporter_id)`,
  `CREATE INDEX IF NOT EXISTS offer_reports_status_idx ON offer_reports (status)`,
  // Rep performance profile: one logged result per rep per offer, with an
  // optional earnings range and the owning partner's confirmation.
  `CREATE TABLE IF NOT EXISTS deals (
     id                  TEXT PRIMARY KEY,
     user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     offer_id            TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
     deals_closed        INTEGER NOT NULL,
     earnings_min        INTEGER,
     earnings_max        INTEGER,
     month               TEXT NOT NULL DEFAULT '',
     partner_confirmed_at TEXT,
     partner_confirmed_by TEXT,
     created_at          TEXT NOT NULL,
     updated_at          TEXT NOT NULL
   )`,
  // One log per rep per offer per calendar month: the monthly leaderboard
  // needs the month, and the profile sums every month together.
  `DROP INDEX IF EXISTS deals_user_offer_idx`,
  `CREATE UNIQUE INDEX IF NOT EXISTS deals_user_offer_month_idx
     ON deals (user_id, offer_id, month)`,
  `CREATE INDEX IF NOT EXISTS deals_user_idx ON deals (user_id)`,
  `CREATE INDEX IF NOT EXISTS deals_offer_idx ON deals (offer_id)`,
  `CREATE INDEX IF NOT EXISTS deals_month_idx ON deals (month)`,
  // Monthly Top Closer awards; the unique index makes the lazy award job
  // idempotent however many times the leaderboard is read.
  `CREATE TABLE IF NOT EXISTS leaderboard_awards (
     id           TEXT PRIMARY KEY,
     month        TEXT NOT NULL,
     user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     rank         INTEGER NOT NULL,
     role_granted INTEGER NOT NULL DEFAULT 0,
     revoked_at   TEXT,
     created_at   TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_awards_month_user_idx
     ON leaderboard_awards (month, user_id)`,
  `CREATE INDEX IF NOT EXISTS leaderboard_awards_month_idx
     ON leaderboard_awards (month)`,
  // Offer analytics: one view per member per offer per UTC day, so a refresh
  // loop cannot inflate the numbers, and the 30-day chart stays cheap.
  `CREATE TABLE IF NOT EXISTS offer_views (
     id         TEXT PRIMARY KEY,
     offer_id   TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
     viewer_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     viewed_on  TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS offer_views_offer_viewer_day_idx
     ON offer_views (offer_id, viewer_id, viewed_on)`,
  `CREATE INDEX IF NOT EXISTS offer_views_offer_idx ON offer_views (offer_id)`,
  // Whop subscriptions, processed webhook ids and manual-action flags.
  ...BILLING_SCHEMA,
];

/** Sample offers written once into an empty board so a fresh deploy isn't blank. */
const DEMO_OFFERS: Array<{
  title: string;
  company: string;
  description: string;
  roleType: "setter" | "closer" | "both";
  commission: string;
  payType: string;
  requirements: string;
  featured: boolean;
  days: number;
  expiresInDays: number | null;
}> = [
  {
    title: "High-ticket closer — B2B SaaS",
    company: "Northwind Growth",
    description:
      "We book 40+ qualified demos a month for a $2.4k/mo retention platform aimed at agencies. You take the demos, run a structured discovery call and close on a two-call cycle.\n\nDeals close at 15–25% of annual contract value. Average cycle is 9 days.",
    roleType: "closer",
    commission: "18% of contract value",
    payType: "Commission only",
    requirements:
      "• 12+ months closing B2B deals over Zoom\n• Comfortable with a 2-call close and a 30% baseline\n• Reliable wired connection and a quiet room",
    featured: true,
    days: 1,
    expiresInDays: 30,
  },
  {
    title: "Setter for a coaching offer (warm inbound)",
    company: "Halden & Co",
    description:
      "All leads are inbound from a paid funnel — no cold calling. Your job is to qualify, book, and hand off to two senior closers.\n\nTarget is 12 booked calls per week. Scripts, dialler and CRM seat are provided.",
    roleType: "setter",
    commission: "$120 per held call + 2% deal bonus",
    payType: "Base + commission",
    requirements:
      "• Comfortable on the phone for 4–5 hours a day\n• Sets 12+ calls per week consistently\n• Writes clean call notes",
    featured: false,
    days: 3,
    expiresInDays: 21,
  },
  {
    title: "Full-cycle sales — DTC brand launch",
    company: "Palewood",
    description:
      "One product, one market, one quarter. You own outreach through close for a DTC skincare launch, working directly with the founders.\n\nExpect a mix of inbound DM interest and outbound list work.",
    roleType: "both",
    commission: "20% first order, 5% recurring for 6 months",
    payType: "Commission only",
    requirements:
      "• Can build and run a small outbound list yourself\n• Available 20+ hours per week\n• Track record in DTC or e-commerce is a plus",
    featured: false,
    days: 6,
    expiresInDays: 14,
  },
  {
    title: "Closer — solar, pre-set appointments",
    company: "Lumen Field Energy",
    description:
      "Two appointments per day, pre-set and confirmed by our in-house setting team. In-home and Zoom track available.\n\nThis is a high-volume role: 4–6 closes per month expected from a 40-appointment calendar.",
    roleType: "closer",
    commission: "$900 per install + weekly draw",
    payType: "Base + commission",
    requirements:
      "• Previous solar, home improvement or insurance closing\n• Can travel within your metro area\n• Comfortable with a same-day close",
    featured: false,
    days: 9,
    expiresInDays: 45,
  },
  {
    title: "Setter — agency retainers (US hours)",
    company: "Coeso Talent",
    description:
      "Outbound to agency owners for a $3k/mo white-label fulfilment service. Lists, dialler and opener scripts are supplied; you refine the pitch.\n\nThis offer is on pause while we rewrite the script — kept public so you can see the format.",
    roleType: "setter",
    commission: "$75 per qualified meeting",
    payType: "Commission only",
    requirements:
      "• Available 4 hours/day overlap with US Eastern\n• Comfortable with 100+ dials per day\n• Good written English for follow-ups",
    featured: false,
    days: 12,
    expiresInDays: null,
  },
];

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Adds a column to a table that predates it. SQLite has no
 * `ALTER TABLE ... IF NOT EXISTS`, so the live column list is checked first and
 * the ALTER only runs when the column is missing — keeping the migration
 * idempotent on every isolate, on both local and hosted D1. `ddl` is the full
 * column definition so a column can carry its own default.
 */
async function ensureColumn(
  database: D1Database,
  table: "users" | "offers" | "settings" | "deals",
  column: string,
  ddl = "TEXT",
): Promise<void> {
  const columns = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM pragma_table_info('${table}') WHERE name = ?`,
    )
    .bind(column)
    .first<{ count: number }>();
  if ((columns?.count ?? 0) > 0) return;

  await database
    .prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
    .run();
}

/**
 * Gives every account that predates profiles a handle derived from its email
 * local part. Runs only while NULL handles exist, so it is a no-op on later
 * boots. Handles stay non-unique at the database level (a tiny board and a
 * nullable column), and the profile route resolves the first match — new
 * accounts get a collision-free handle at signup.
 */
async function backfillUsernames(database: D1Database): Promise<void> {
  const { results } = await database
    .prepare("SELECT id, email FROM users WHERE username IS NULL")
    .all<{ id: string; email: string }>();
  if (!results || results.length === 0) return;

  const { handleFromEmail, slugifyHandle } = await import("./reps");
  await database.batch(
    results.map((row) =>
      database
        .prepare("UPDATE users SET username = ? WHERE id = ?")
        .bind(slugifyHandle(handleFromEmail(row.email)), row.id),
    ),
  );
}

async function migrate(database: D1Database): Promise<void> {
  for (const statement of SCHEMA) {
    await database.prepare(statement).run();
  }

  await ensureColumn(database, "offers", "required_role");
  await ensureColumn(database, "settings", "whop_checkout_url");
  // Per-member tier (free/pro/elite) and the Discord id a bot would DM or
  // role — NULL for every account until a Discord sync exists.
  await ensureColumn(database, "users", "tier", "TEXT NOT NULL DEFAULT 'free'");
  await ensureColumn(database, "users", "discord_id");
  // Offer audience tier + a numeric commission used by saved-search filters
  // (`commission` itself stays free text).
  await ensureColumn(database, "offers", "tier", "TEXT NOT NULL DEFAULT 'free'");
  await ensureColumn(database, "offers", "commission_amount");
  // Partner portal: who submitted the offer, and whether an admin has
  // approved it for the public board.
  await ensureColumn(database, "offers", "partner_id");
  await ensureColumn(
    database,
    "offers",
    "approval_status",
    "TEXT NOT NULL DEFAULT 'approved'",
  );
  // Rep profile handle and the rep's own earnings-visibility switch.
  await ensureColumn(database, "users", "username");
  await ensureColumn(
    database,
    "users",
    "hide_earnings",
    "INTEGER NOT NULL DEFAULT 0",
  );
  // Monthly deal attribution (feature 7); existing rows take their creation
  // month, which is the best available answer for a pre-feature log.
  await ensureColumn(database, "deals", "month", "TEXT NOT NULL DEFAULT ''");
  await database
    .prepare(
      "UPDATE deals SET month = substr(created_at, 1, 7) WHERE month IS NULL OR month = ''",
    )
    .run();
  await backfillUsernames(database);

  if (process.env.SEED_DEMO_DATA === "false") return;

  const existing = await database
    .prepare("SELECT COUNT(*) AS count FROM offers")
    .first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;

  const now = new Date().toISOString();
  await database.batch(
    DEMO_OFFERS.map((offer) =>
      database
        .prepare(
          `INSERT INTO offers (
             id, title, company, description, role_type, commission, pay_type,
             requirements, status, expires_at, featured, created_by,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          offer.title,
          offer.company,
          offer.description,
          offer.roleType,
          offer.commission,
          offer.payType,
          offer.requirements,
          offer.title.includes("on pause") ? "paused" : "open",
          offer.expiresInDays === null
            ? null
            : isoDaysFromNow(offer.expiresInDays),
          offer.featured ? 1 : 0,
          "seed",
          isoDaysFromNow(-offer.days),
          now,
        ),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Access
 * ------------------------------------------------------------------ */

let ready: Promise<void> | null = null;

/**
 * Returns the D1 database, running the idempotent schema migration (and the
 * one-off demo seed) the first time it is touched in a worker isolate.
 */
export async function getDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const database = (env as Record<string, unknown>).DB as
    | D1Database
    | undefined;

  if (!database) {
    throw new Error(
      "[db] Missing D1 binding `DB`. Add it in the deployment environment.",
    );
  }

  ready ??= migrate(database).catch((error: unknown) => {
    // Allow the next request to retry instead of caching a failed migration.
    ready = null;
    throw error;
  });
  await ready;

  return database;
}

/** `?` placeholders take only null/string/number in D1. */
export function toSqlBool(value: boolean): number {
  return value ? 1 : 0;
}
