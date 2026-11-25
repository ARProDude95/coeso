import "server-only";
import { ApiError } from "./api";
import { getDb } from "./d1";
import { announceReport } from "./webhook";
import type { Offer, OfferStatus } from "./types";

/**
 * Offer reporting with auto-pause (feature 3).
 *
 * "3 unique reports" means three *distinct reporters* (the unique index
 * guarantees it) whose reports are still open — dismissing a report lowers
 * the count again. The pure decision function is unit-tested; the pause
 * transition notifies admins in-app and, when a webhook is configured, in the
 * Discord channel.
 */

export const REPORT_THRESHOLD = 3;

export interface Report {
  id: string;
  offerId: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  status: "open" | "dismissed";
  createdAt: string;
}

interface ReportRow {
  id: string;
  offer_id: string;
  reporter_id: string;
  name: string | null;
  reason: string;
  status: string;
  created_at: string;
}

interface AdminReportRow extends ReportRow {
  offer_title: string;
  offer_status: string;
}

function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    offerId: row.offer_id,
    reporterId: row.reporter_id,
    reporterName: row.name ?? "Member",
    reason: row.reason,
    status: row.status === "dismissed" ? "dismissed" : "open",
    createdAt: row.created_at,
  };
}

/**
 * Pure auto-pause rule: only an offer that is currently open pauses, and only
 * once the threshold of open reports is reached.
 */
export function shouldAutoPause(
  currentStatus: OfferStatus,
  openReports: number,
): boolean {
  return currentStatus === "open" && openReports >= REPORT_THRESHOLD;
}

/** How many reports are currently counted against an offer. */
export async function countOpenReports(offerId: string): Promise<number> {
  const db = await getDb();
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM offer_reports WHERE offer_id = ? AND status = 'open'",
    )
    .bind(offerId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Files a report. A duplicate reporter hits the unique index and comes back
 * as 409. Returns the new open count and whether this report triggered the
 * auto-pause (so the caller can announce it exactly once).
 */
export async function createReport(
  offer: Offer,
  reporterId: string,
  reason: string,
): Promise<{ openCount: number; paused: boolean }> {
  const db = await getDb();

  try {
    await db
      .prepare(
        `INSERT INTO offer_reports (id, offer_id, reporter_id, reason, status, created_at)
         VALUES (?, ?, ?, ?, 'open', ?)`,
      )
      .bind(crypto.randomUUID(), offer.id, reporterId, reason, new Date().toISOString())
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) {
      throw new ApiError(
        409,
        "You have already reported this offer",
        "already_reported",
      );
    }
    throw error;
  }

  const openCount = await countOpenReports(offer.id);
  const paused = shouldAutoPause(offer.status, openCount);

  if (paused) {
    const now = new Date().toISOString();
    await db
      .prepare("UPDATE offers SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'open'")
      .bind(now, offer.id)
      .run();

    await notifyAdmins({
      kind: "offer_auto_paused",
      title: `Auto-paused: ${offer.title}`,
      body: `${openCount} reports — review them on the reports page.`,
      offerId: offer.id,
    });

    // Never blocks the report itself (same contract as announceOffer).
    await announceReport({ ...offer, status: "paused" }, openCount);
  }

  return { openCount, paused };
}

/** In-app alert for every admin account. */
async function notifyAdmins(notification: {
  kind: string;
  title: string;
  body: string;
  offerId: string;
}): Promise<void> {
  const db = await getDb();
  const { results } = await db
    .prepare("SELECT id FROM users WHERE is_admin = 1")
    .all<{ id: string }>();

  const now = new Date().toISOString();
  await db.batch(
    (results ?? []).map((admin) =>
      db
        .prepare(
          `INSERT INTO notifications (id, user_id, kind, title, body, offer_id, read_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          admin.id,
          notification.kind,
          notification.title,
          notification.body,
          notification.offerId,
          now,
        ),
    ),
  );
}

/** Every report row (open and dismissed), newest first — admin page. */
export async function listReports(): Promise<
  Array<Report & { offerTitle: string; offerStatus: OfferStatus }>
> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT r.*, u.name, o.title AS offer_title, o.status AS offer_status
         FROM offer_reports r
         JOIN users u ON u.id = r.reporter_id
         JOIN offers o ON o.id = r.offer_id
        ORDER BY r.created_at DESC
        LIMIT 200`,
    )
    .all<AdminReportRow>();

  return (results ?? []).map((row) => ({
    ...toReport(row),
    offerTitle: row.offer_title,
    offerStatus:
      row.offer_status === "paused" || row.offer_status === "closed"
        ? row.offer_status
        : "open",
  }));
}

/** Admin dismiss: owner of the action is the admin session, not the row. */
export async function dismissReport(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .prepare(
      "UPDATE offer_reports SET status = 'dismissed' WHERE id = ? AND status = 'open'",
    )
    .bind(id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
