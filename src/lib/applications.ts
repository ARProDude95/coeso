import "server-only";
import { getDb } from "./d1";
import type { Application, ApplicationWithOffer } from "./types";

export interface ApplicationRow {
  id: string;
  offer_id: string;
  user_id: string;
  message: string;
  experience_level: Application["experienceLevel"];
  availability_hours: number;
  past_results: string | null;
  status: Application["status"];
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The applicant's own view of an application. `admin_note` is deliberately
 * absent from this column list and is never selected here.
 */
const APPLICANT_COLUMNS =
  "id, offer_id, user_id, message, experience_level, availability_hours, " +
  "past_results, status, created_at, updated_at";

function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    offerId: row.offer_id,
    userId: row.user_id,
    message: row.message,
    experienceLevel: row.experience_level,
    availabilityHours: row.availability_hours,
    pastResults: row.past_results,
    status: row.status,
    adminNote: row.admin_note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getApplicationForOffer(
  offerId: string,
  userId: string,
): Promise<Application | null> {
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT ${APPLICANT_COLUMNS} FROM applications
        WHERE offer_id = ? AND user_id = ?`,
    )
    .bind(offerId, userId)
    .first<ApplicationRow>();
  return row ? toApplication(row) : null;
}

/**
 * Inserts an application. Returns `null` when the user already applied to this
 * offer — enforced by the (offer_id, user_id) unique index, so it cannot be
 * bypassed by a double submit or a race.
 */
export async function createApplication(
  offerId: string,
  userId: string,
  input: {
    message: string;
    experienceLevel: Application["experienceLevel"];
    availabilityHours: number;
    pastResults: string | null;
  },
): Promise<Application | null> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await db
      .prepare(
        `INSERT INTO applications (
           id, offer_id, user_id, message, experience_level,
           availability_hours, past_results, status, admin_note,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
      )
      .bind(
        id,
        offerId,
        userId,
        input.message,
        input.experienceLevel,
        input.availabilityHours,
        input.pastResults,
        now,
        now,
      )
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) return null;
    throw error;
  }

  return {
    id,
    offerId,
    userId,
    message: input.message,
    experienceLevel: input.experienceLevel,
    availabilityHours: input.availabilityHours,
    pastResults: input.pastResults,
    status: "pending",
    adminNote: null,
    createdAt: now,
    updatedAt: now,
  };
}

interface ApplicationWithOfferRow extends ApplicationRow {
  offer_title: string;
  offer_company: string;
  offer_status: ApplicationWithOffer["offer"]["status"];
  offer_role_type: ApplicationWithOffer["offer"]["roleType"];
  offer_expires_at: string | null;
}

export async function listApplicationsForUser(
  userId: string,
): Promise<ApplicationWithOffer[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT a.id, a.offer_id, a.user_id, a.message, a.experience_level,
              a.availability_hours, a.past_results, a.status,
              a.created_at, a.updated_at,
              o.title AS offer_title,
              o.company AS offer_company,
              o.status AS offer_status,
              o.role_type AS offer_role_type,
              o.expires_at AS offer_expires_at
         FROM applications a
         JOIN offers o ON o.id = a.offer_id
        WHERE a.user_id = ?
        ORDER BY a.created_at DESC`,
    )
    .bind(userId)
    .all<ApplicationWithOfferRow>();

  return (results ?? []).map((row) => ({
    ...toApplication(row),
    offer: {
      id: row.offer_id,
      title: row.offer_title,
      company: row.offer_company,
      status: row.offer_status,
      roleType: row.offer_role_type,
      expiresAt: row.offer_expires_at,
    },
  }));
}
