import "server-only";
import { getDb } from "./d1";
import { toApprovalStatus, type ApprovalStatus } from "./partners";
import { gatedOffersClause, type Viewer } from "./roles";
import type { Offer, OfferStatus, OfferWithCounts } from "./types";
import type { OfferFilters, OfferInput } from "./validation";

export interface OfferRow {
  id: string;
  title: string;
  company: string;
  description: string;
  role_type: "setter" | "closer" | "both";
  commission: string;
  pay_type: string;
  requirements: string;
  status: OfferStatus;
  expires_at: string | null;
  featured: number;
  required_role: string | null;
  tier: string;
  commission_amount: number | null;
  partner_id: string | null;
  approval_status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  application_count: number;
}

export function toOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    description: row.description,
    roleType: row.role_type,
    commission: row.commission,
    payType: row.pay_type,
    requirements: row.requirements,
    status: row.status,
    expiresAt: row.expires_at,
    featured: row.featured === 1,
    requiredRole: row.required_role ?? null,
    tier: row.tier === "pro" || row.tier === "elite" ? row.tier : "free",
    commissionAmount: row.commission_amount ?? null,
    partnerId: row.partner_id ?? null,
    approvalStatus: toApprovalStatus(row.approval_status),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOfferWithCounts(row: OfferRow): OfferWithCounts {
  return { ...toOffer(row), applicationCount: row.application_count ?? 0 };
}

/** Selects an offer plus its application count in one round trip. */
const SELECT_OFFER = `
  SELECT o.*,
         (SELECT COUNT(*) FROM applications a WHERE a.offer_id = o.id)
           AS application_count
    FROM offers o`;

/**
 * Closes every open offer whose `expires_at` has passed. Called before any
 * read so an expired offer never appears as open, without needing a cron job.
 */
export async function autoCloseExpired(): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE offers
          SET status = 'closed', updated_at = ?
        WHERE status = 'open'
          AND expires_at IS NOT NULL
          AND expires_at < ?`,
    )
    .bind(now, now)
    .run();
  return result.meta?.changes ?? 0;
}

const ROLE_FILTER: Record<OfferFilters["roleType"], string[]> = {
  setter: ["setter", "both"],
  closer: ["closer", "both"],
  both: ["both"],
  all: ["setter", "closer", "both"],
};

/**
 * Lists offers the viewer is allowed to see. Pass `null` for an unfiltered
 * read (the admin dashboard uses `listOffersForAdmin` instead).
 */
export async function listOffers(
  filters: OfferFilters,
  viewer: Viewer | null,
): Promise<OfferWithCounts[]> {
  await autoCloseExpired();
  const db = await getDb();

  const where: string[] = ["o.approval_status = 'approved'"];
  const values: unknown[] = [];

  if (filters.status !== "all") {
    where.push("o.status = ?");
    values.push(filters.status);
  }

  const roleTypes = ROLE_FILTER[filters.roleType];
  if (roleTypes.length < 3) {
    where.push(`o.role_type IN (${roleTypes.map(() => "?").join(", ")})`);
    values.push(...roleTypes);
  }

  if (filters.q) {
    // `instr` is a plain substring test: no LIKE wildcards, so user input can't
    // reshape the pattern and nothing needs escaping.
    where.push(
      "(instr(lower(o.title), lower(?)) > 0 " +
        "OR instr(lower(o.company), lower(?)) > 0 " +
        "OR instr(lower(o.description), lower(?)) > 0)",
    );
    values.push(filters.q, filters.q, filters.q);
  }

  const gated = gatedOffersClause(viewer);
  if (gated) {
    where.push(gated.sql);
    values.push(gated.value);
  }

  const sql = `${SELECT_OFFER}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY o.featured DESC, o.created_at DESC`;

  const { results } = await db
    .prepare(sql)
    .bind(...values)
    .all<OfferRow>();

  return (results ?? []).map(toOfferWithCounts);
}

export async function getOffer(id: string): Promise<OfferWithCounts | null> {
  await autoCloseExpired();
  const db = await getDb();
  const row = await db
    .prepare(`${SELECT_OFFER} WHERE o.id = ?`)
    .bind(id)
    .first<OfferRow>();
  return row ? toOfferWithCounts(row) : null;
}

/** Admin view: every offer regardless of status, newest first. */
export async function listOffersForAdmin(): Promise<OfferWithCounts[]> {
  await autoCloseExpired();
  const db = await getDb();
  const { results } = await db
    .prepare(`${SELECT_OFFER} ORDER BY o.featured DESC, o.created_at DESC`)
    .all<OfferRow>();
  return (results ?? []).map(toOfferWithCounts);
}

/**
 * Staff listing for the /admin dashboard: admins see everything, a partner
 * sees only offers they submitted (partner data isolation).
 */
export async function listOffersForStaff(viewer: {
  id: string;
  isAdmin: boolean;
}): Promise<OfferWithCounts[]> {
  if (viewer.isAdmin) return listOffersForAdmin();
  await autoCloseExpired();
  const db = await getDb();
  const { results } = await db
    .prepare(
      `${SELECT_OFFER} WHERE o.partner_id = ?
        ORDER BY o.featured DESC, o.created_at DESC`,
    )
    .bind(viewer.id)
    .all<OfferRow>();
  return (results ?? []).map(toOfferWithCounts);
}

/** Offers a partner still has awaiting an admin decision. */
export async function countPendingOffers(partnerId?: string): Promise<number> {
  const db = await getDb();
  const row = partnerId
    ? await db
        .prepare(
          `SELECT COUNT(*) AS count FROM offers
            WHERE approval_status = 'pending' AND partner_id = ?`,
        )
        .bind(partnerId)
        .first<{ count: number }>()
    : await db
        .prepare(
          "SELECT COUNT(*) AS count FROM offers WHERE approval_status = 'pending'",
        )
        .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Admin decides a partner submission; approval publishes it. */
export async function setApprovalStatus(
  id: string,
  status: ApprovalStatus,
): Promise<Offer | null> {
  const db = await getDb();
  await db
    .prepare("UPDATE offers SET approval_status = ?, updated_at = ? WHERE id = ?")
    .bind(status, new Date().toISOString(), id)
    .run();
  return getOffer(id).then((offer) => (offer ? offer : null));
}

const COLUMNS: Array<[keyof OfferInput, string]> = [
  ["title", "title"],
  ["company", "company"],
  ["description", "description"],
  ["roleType", "role_type"],
  ["commission", "commission"],
  ["payType", "pay_type"],
  ["requirements", "requirements"],
  ["status", "status"],
  ["expiresAt", "expires_at"],
  ["featured", "featured"],
  ["requiredRole", "required_role"],
  ["tier", "tier"],
  ["commissionAmount", "commission_amount"],
];

function toColumn(key: keyof OfferInput, value: unknown): unknown {
  if (key === "featured") return value ? 1 : 0;
  if (
    key === "expiresAt" ||
    key === "requiredRole" ||
    key === "commissionAmount"
  ) {
    return (value as string | null) ?? null;
  }
  return value;
}

export async function createOffer(
  createdBy: string,
  input: OfferInput,
  origin: { partnerId?: string | null; approvalStatus?: ApprovalStatus } = {},
): Promise<Offer> {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO offers (
         id, title, company, description, role_type, commission, pay_type,
         requirements, status, expires_at, featured, required_role, tier,
         commission_amount, partner_id, approval_status, created_by,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.title,
      input.company,
      input.description,
      input.roleType,
      input.commission,
      input.payType,
      input.requirements,
      input.status,
      input.expiresAt,
      toColumn("featured", input.featured),
      toColumn("requiredRole", input.requiredRole),
      input.tier,
      toColumn("commissionAmount", input.commissionAmount),
      origin.partnerId ?? null,
      origin.approvalStatus ?? "approved",
      createdBy,
      now,
      now,
    )
    .run();

  const row = await db
    .prepare(`${SELECT_OFFER} WHERE o.id = ?`)
    .bind(id)
    .first<OfferRow>();
  if (!row) throw new Error("createOffer: insert did not return a row");
  return toOffer(row);
}

export async function updateOffer(
  id: string,
  input: Partial<OfferInput>,
): Promise<Offer | null> {
  const db = await getDb();

  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of COLUMNS) {
    const value = input[key];
    // A missing key means "leave this column alone".
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(toColumn(key, value));
  }

  if (assignments.length === 0) {
    const current = await db
      .prepare(`${SELECT_OFFER} WHERE o.id = ?`)
      .bind(id)
      .first<OfferRow>();
    return current ? toOffer(current) : null;
  }

  assignments.push("updated_at = ?");
  values.push(new Date().toISOString(), id);

  await db
    .prepare(`UPDATE offers SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const row = await db
    .prepare(`${SELECT_OFFER} WHERE o.id = ?`)
    .bind(id)
    .first<OfferRow>();
  return row ? toOffer(row) : null;
}
