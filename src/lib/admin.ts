import "server-only";
import { getDb } from "./d1";
import { autoCloseExpired } from "./offers";
import type {
  ApplicationStatus,
  ApplicationWithApplicant,
} from "./types";

export interface AdminStats {
  openOffers: number;
  pausedOffers: number;
  closedOffers: number;
  totalOffers: number;
  pendingApplicants: number;
  totalApplicants: number;
  acceptedApplicants: number;
}

interface StatsRow {
  open_offers: number;
  paused_offers: number;
  closed_offers: number;
  pending_applicants: number;
  total_applicants: number;
  accepted_applicants: number;
}

export async function getAdminStats(
  partnerId?: string,
): Promise<AdminStats> {
  await autoCloseExpired();
  const db = await getDb();

  // Partners get their own slice of every number, never board-wide totals.
  const scoped = partnerId !== undefined;
  const offerWhere = scoped ? "WHERE partner_id = ?" : "WHERE 1 = 1";
  const appWhere = scoped
    ? "WHERE offer_id IN (SELECT id FROM offers WHERE partner_id = ?)"
    : "WHERE 1 = 1";
  const bind = scoped ? [partnerId] : [];

  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM offers ${offerWhere} AND status = 'open')
           AS open_offers,
         (SELECT COUNT(*) FROM offers ${offerWhere} AND status = 'paused')
           AS paused_offers,
         (SELECT COUNT(*) FROM offers ${offerWhere} AND status = 'closed')
           AS closed_offers,
         (SELECT COUNT(*) FROM applications ${appWhere} AND status = 'pending')
           AS pending_applicants,
         (SELECT COUNT(*) FROM applications ${appWhere}) AS total_applicants,
         (SELECT COUNT(*) FROM applications ${appWhere} AND status = 'accepted')
           AS accepted_applicants`,
    )
    .bind(...bind, ...bind, ...bind, ...bind, ...bind, ...bind)
    .first<StatsRow>();

  const openOffers = row?.open_offers ?? 0;
  const pausedOffers = row?.paused_offers ?? 0;
  const closedOffers = row?.closed_offers ?? 0;

  return {
    openOffers,
    pausedOffers,
    closedOffers,
    totalOffers: openOffers + pausedOffers + closedOffers,
    pendingApplicants: row?.pending_applicants ?? 0,
    totalApplicants: row?.total_applicants ?? 0,
    acceptedApplicants: row?.accepted_applicants ?? 0,
  };
}

interface ApplicantRow {
  id: string;
  offer_id: string;
  user_id: string;
  message: string;
  experience_level: ApplicationWithApplicant["experienceLevel"];
  availability_hours: number;
  past_results: string | null;
  status: ApplicationStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  applicant_id: string | null;
  applicant_email: string | null;
  applicant_name: string | null;
}

/**
 * Applicants for one offer (or for every offer), newest first. This is the
 * admin view, so it deliberately includes `admin_note`.
 */
export async function listApplicants(
  offerId?: string,
  partnerId?: string,
): Promise<ApplicationWithApplicant[]> {
  const db = await getDb();
  const where: string[] = [];
  const values: unknown[] = [];

  if (offerId) {
    where.push("a.offer_id = ?");
    values.push(offerId);
  }
  // Partner isolation: a partner's query is always narrowed to their offers.
  if (partnerId !== undefined) {
    where.push(
      "a.offer_id IN (SELECT id FROM offers WHERE partner_id = ?)",
    );
    values.push(partnerId);
  }

  const sql = `
    SELECT a.*,
           u.id    AS applicant_id,
           u.email AS applicant_email,
           u.name  AS applicant_name
      FROM applications a
      LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.created_at DESC`;

  const statement = values.length
    ? db.prepare(sql).bind(...values)
    : db.prepare(sql);

  const { results } = await statement.all<ApplicantRow>();

  return (results ?? []).map((row) => ({
    id: row.id,
    offerId: row.offer_id,
    userId: row.user_id,
    message: row.message,
    experienceLevel: row.experience_level,
    availabilityHours: row.availability_hours,
    pastResults: row.past_results,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    applicant: {
      id: row.applicant_id ?? row.user_id,
      email: row.applicant_email ?? "",
      name: row.applicant_name ?? "Deleted account",
    },
  }));
}

/** The offer an application belongs to — used for partner ownership checks. */
export async function getApplicationOfferId(
  id: string,
): Promise<string | null> {
  const db = await getDb();
  const row = await db
    .prepare("SELECT offer_id FROM applications WHERE id = ?")
    .bind(id)
    .first<{ offer_id: string }>();
  return row?.offer_id ?? null;
}

/** Accept/reject and/or write the private note. Returns false if not found. */
export async function reviewApplication(
  id: string,
  patch: { status?: ApplicationStatus; adminNote?: string | null },
): Promise<boolean> {
  const db = await getDb();

  const assignments: string[] = ["updated_at = ?"];
  const values: unknown[] = [new Date().toISOString()];

  if (patch.status !== undefined) {
    assignments.push("status = ?");
    values.push(patch.status);
  }
  if (patch.adminNote !== undefined) {
    assignments.push("admin_note = ?");
    values.push(patch.adminNote);
  }

  const result = await db
    .prepare(
      `UPDATE applications SET ${assignments.join(", ")} WHERE id = ?`,
    )
    .bind(...values, id)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}
