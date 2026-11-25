import { getDb, type SqlValue } from "./db";
import type { ApplicationInput, OfferInput } from "./validation";

export type RoleType = "setter" | "closer" | "both";

export interface Offer {
  id: string;
  title: string;
  company: string;
  role_type: RoleType;
  commission: string;
  pay_type: string;
  description: string;
  requirements: string;
  status: "open" | "closed";
  featured: number;
  created_at: string;
}

export interface Application {
  id: string;
  offer_id: string;
  offer_title?: string;
  name: string;
  email: string;
  discord: string;
  experience: string;
  availability_hours: number;
  message: string;
  status: "new" | "reviewed";
  created_at: string;
}

export interface BoardStats {
  open: number;
  total: number;
  fresh: number;
  applications: number;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS offers (
     id          TEXT PRIMARY KEY,
     title       TEXT NOT NULL,
     company     TEXT NOT NULL,
     role_type   TEXT NOT NULL CHECK (role_type IN ('setter', 'closer', 'both')),
     commission  TEXT NOT NULL,
     pay_type    TEXT NOT NULL,
     description TEXT NOT NULL,
     requirements TEXT NOT NULL DEFAULT '',
     status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
     featured    INTEGER NOT NULL DEFAULT 0,
     created_at  TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS offers_status_idx ON offers (status)`,
  `CREATE TABLE IF NOT EXISTS applications (
     id                 TEXT PRIMARY KEY,
     offer_id           TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
     name               TEXT NOT NULL,
     email              TEXT NOT NULL,
     discord            TEXT NOT NULL,
     experience         TEXT NOT NULL,
     availability_hours INTEGER NOT NULL,
     message            TEXT NOT NULL DEFAULT '',
     status             TEXT NOT NULL DEFAULT 'new',
     created_at         TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS applications_offer_idx ON applications (offer_id)`,
];

const DEMO_OFFERS: Array<{
  title: string;
  company: string;
  role_type: RoleType;
  commission: string;
  pay_type: string;
  description: string;
  requirements: string;
  featured: boolean;
}> = [
  {
    title: "High-ticket closer — B2B SaaS",
    company: "Northwind Growth",
    role_type: "closer",
    commission: "18% of contract value",
    pay_type: "Commission only",
    description:
      "We book 40+ qualified demos a month for a $2.4k/mo retention platform aimed at agencies. You take the demos, run a structured discovery call and close on a two-call cycle.\n\nDeals close at 15–25% of annual contract value. Average cycle is 9 days.",
    requirements:
      "12+ months closing B2B deals over Zoom\nComfortable with a 2-call close and a 30% baseline\nReliable wired connection and a quiet room",
    featured: true,
  },
  {
    title: "Setter for a coaching offer (warm inbound)",
    company: "Halden & Co",
    role_type: "setter",
    commission: "$120 per held call + 2% deal bonus",
    pay_type: "Base + commission",
    description:
      "All leads are inbound from a paid funnel — no cold calling. Your job is to qualify, book, and hand off to two senior closers.\n\nTarget is 12 booked calls per week. Scripts, dialler and CRM seat are provided.",
    requirements:
      "Comfortable on the phone for 4–5 hours a day\nSets 12+ calls per week consistently\nWrites clean call notes",
    featured: false,
  },
  {
    title: "Full-cycle sales — DTC brand launch",
    company: "Palewood",
    role_type: "both",
    commission: "20% first order, 5% recurring for 6 months",
    pay_type: "Commission only",
    description:
      "One product, one market, one quarter. You own outreach through close for a DTC skincare launch, working directly with the founders.\n\nExpect a mix of inbound DM interest and outbound list work.",
    requirements:
      "Can build and run a small outbound list yourself\nAvailable 20+ hours per week\nTrack record in DTC or e-commerce is a plus",
    featured: false,
  },
  {
    title: "Closer — solar, pre-set appointments",
    company: "Lumen Field Energy",
    role_type: "closer",
    commission: "$900 per install + weekly draw",
    pay_type: "Base + commission",
    description:
      "Two appointments per day, pre-set and confirmed by our in-house setting team. In-home and Zoom track available.\n\nThis is a high-volume role: 4–6 closes per month expected from a 40-appointment calendar.",
    requirements:
      "Previous solar, home improvement or insurance closing\nCan travel within your metro area\nComfortable with a same-day close",
    featured: false,
  },
  {
    title: "Setter — agency retainers (US hours)",
    company: "Coeso Talent",
    role_type: "setter",
    commission: "$75 per qualified meeting",
    pay_type: "Commission only",
    description:
      "Outbound to agency owners for a $3k/mo white-label fulfilment service. Lists, dialler and opener scripts are supplied; you refine the pitch.",
    requirements:
      "Available 4 hours/day overlap with US Eastern\nComfortable with 100+ dials per day\nGood written English for follow-ups",
    featured: false,
  },
  {
    title: "Closer — partnerships programme",
    company: "Ridgeline Partners",
    role_type: "closer",
    commission: "12% of first-year fees",
    pay_type: "Commission only",
    description:
      "Warm intros only: our partnerships team qualifies every lead before it reaches you. You run the call, scope the engagement and close with a founder on stand-by.\n\nExpect 8–10 qualified conversations a month.",
    requirements:
      "Experience selling services or consulting\nCan run a scoping call without a script\nWrites proposals the same day",
    featured: false,
  },
];

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

let ready: Promise<void> | null = null;

async function ensureReady(): Promise<void> {
  ready ??= bootstrap().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  await ready;
}

async function bootstrap(): Promise<void> {
  const db = await getDb();
  for (const statement of SCHEMA) {
    await db.query(statement);
  }

  if (process.env.SEED_DEMO_DATA === "false") return;

  const count = await db.query("SELECT COUNT(*) AS count FROM offers");
  if (Number(count.rows[0]?.count ?? 0) > 0) return;

  for (const [index, offer] of DEMO_OFFERS.entries()) {
    await db.query(
      `INSERT INTO offers (
         id, title, company, role_type, commission, pay_type, description,
         requirements, status, featured, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      [
        crypto.randomUUID(),
        offer.title,
        offer.company,
        offer.role_type,
        offer.commission,
        offer.pay_type,
        offer.description,
        offer.requirements,
        offer.featured ? 1 : 0,
        isoDaysFromNow(-(index * 2 + 1)),
      ],
    );
  }
}

/* ------------------------------ offers ------------------------------ */

export async function listOffers(
  options: { q?: string; role?: string; includeClosed?: boolean } = {},
): Promise<Offer[]> {
  await ensureReady();
  const db = await getDb();

  const where: string[] = [];
  const params: SqlValue[] = [];

  if (!options.includeClosed) where.push("status = 'open'");

  if (options.role && options.role !== "all") {
    where.push("role_type = ?");
    params.push(options.role);
  }

  const q = options.q?.trim();
  if (q) {
    where.push(
      "(title LIKE ? OR company LIKE ? OR description LIKE ? OR requirements LIKE ?)",
    );
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const sql = `SELECT * FROM offers${
    where.length ? ` WHERE ${where.join(" AND ")}` : ""
  } ORDER BY featured DESC, created_at DESC LIMIT 200`;

  const result = await db.query(sql, params);
  return result.rows as unknown as Offer[];
}

export async function getOffer(id: string): Promise<Offer | null> {
  await ensureReady();
  const db = await getDb();
  const result = await db.query("SELECT * FROM offers WHERE id = ?", [id]);
  return (result.rows[0] as unknown as Offer) ?? null;
}

export async function createOffer(input: OfferInput): Promise<Offer> {
  await ensureReady();
  const db = await getDb();
  const id = crypto.randomUUID();

  await db.query(
    `INSERT INTO offers (
       id, title, company, role_type, commission, pay_type, description,
       requirements, status, featured, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    [
      id,
      input.title,
      input.company,
      input.role_type,
      input.commission,
      input.pay_type,
      input.description,
      input.requirements,
      input.featured ? 1 : 0,
      new Date().toISOString(),
    ],
  );

  const created = await getOffer(id);
  if (!created) throw new Error("[store] Offer insert failed");
  return created;
}

export async function setOfferStatus(
  id: string,
  status: Offer["status"],
): Promise<boolean> {
  await ensureReady();
  const db = await getDb();
  const result = await db.query("UPDATE offers SET status = ? WHERE id = ?", [
    status,
    id,
  ]);
  return result.changes > 0;
}

/* --------------------------- applications --------------------------- */

export async function createApplication(
  input: ApplicationInput,
): Promise<Application> {
  await ensureReady();
  const db = await getDb();
  const id = crypto.randomUUID();

  await db.query(
    `INSERT INTO applications (
       id, offer_id, name, email, discord, experience, availability_hours,
       message, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
    [
      id,
      input.offer_id,
      input.name,
      input.email,
      input.discord,
      input.experience,
      input.availability_hours,
      input.message,
      new Date().toISOString(),
    ],
  );

  return {
    id,
    offer_id: input.offer_id,
    name: input.name,
    email: input.email,
    discord: input.discord,
    experience: input.experience,
    availability_hours: input.availability_hours,
    message: input.message,
    status: "new",
    created_at: new Date().toISOString(),
  };
}

export async function listApplications(): Promise<Application[]> {
  await ensureReady();
  const db = await getDb();
  const result = await db.query(
    `SELECT a.*, o.title AS offer_title
       FROM applications a
       JOIN offers o ON o.id = a.offer_id
      ORDER BY a.created_at DESC
      LIMIT 300`,
  );
  return result.rows as unknown as Application[];
}

/* ------------------------------- stats ------------------------------ */

export async function boardStats(): Promise<BoardStats> {
  await ensureReady();
  const db = await getDb();

  const [open, total, fresh, applications] = await Promise.all([
    db.query("SELECT COUNT(*) AS count FROM offers WHERE status = 'open'"),
    db.query("SELECT COUNT(*) AS count FROM offers"),
    db.query("SELECT COUNT(*) AS count FROM offers WHERE created_at >= ?", [
      isoDaysFromNow(-7),
    ]),
    db.query("SELECT COUNT(*) AS count FROM applications"),
  ]);

  const value = (result: { rows: Record<string, unknown>[] }) =>
    Number(result.rows[0]?.count ?? 0);

  return {
    open: value(open),
    total: value(total),
    fresh: value(fresh),
    applications: value(applications),
  };
}
