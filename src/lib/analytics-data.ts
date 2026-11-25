import "server-only";
import {
  acceptanceRate,
  buildSeries,
  lastNDays,
  type DailyPoint,
} from "./analytics";
import { getDb } from "./d1";
import type { OfferStatus } from "./types";

/** Offer analytics (feature 6): view tracking plus per-offer reporting. */

export interface OfferAnalyticsSummary {
  offerId: string;
  title: string;
  company: string;
  status: OfferStatus;
  views: number;
  applications: number;
  accepted: number;
  acceptanceRate: number | null;
}

interface SummaryRow {
  id: string;
  title: string;
  company: string;
  status: OfferStatus;
  views: number;
  applications: number;
  accepted: number;
}

/**
 * One row per offer with its view/application counts. Callers pass a partner
 * id to scope the list; admins pass undefined and see everything.
 */
export async function listOfferAnalytics(
  partnerId?: string,
): Promise<OfferAnalyticsSummary[]> {
  const db = await getDb();
  const statement = db.prepare(
    `SELECT o.id, o.title, o.company, o.status,
            (SELECT COUNT(*) FROM offer_views v WHERE v.offer_id = o.id)
              AS views,
            (SELECT COUNT(*) FROM applications a WHERE a.offer_id = o.id)
              AS applications,
            (SELECT COUNT(*) FROM applications a WHERE a.offer_id = o.id
               AND a.status = 'accepted') AS accepted
       FROM offers o
       ${partnerId ? "WHERE o.partner_id = ?" : ""}
       ORDER BY o.created_at DESC`,
  );

  const { results } = partnerId
    ? await statement.bind(partnerId).all<SummaryRow>()
    : await statement.all<SummaryRow>();

  return (results ?? []).map((row) => ({
    offerId: row.id,
    title: row.title,
    company: row.company,
    status: row.status,
    views: row.views,
    applications: row.applications,
    accepted: row.accepted,
    acceptanceRate: acceptanceRate(row.accepted, row.applications),
  }));
}

export interface OfferAnalytics {
  views: number;
  applications: number;
  accepted: number;
  acceptanceRate: number | null;
  series: DailyPoint[];
}

interface CountRow {
  count: number;
}

/** Totals for one offer plus a zero-filled 30-day views/applications series. */
export async function getOfferAnalytics(
  offerId: string,
  days = 30,
): Promise<OfferAnalytics> {
  const db = await getDb();
  const dates = lastNDays(days);
  const since = dates[0];

  const [totals, accepted, viewRows, appRows] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM offer_views WHERE offer_id = ?) AS views,
           (SELECT COUNT(*) FROM applications WHERE offer_id = ?)
             AS applications`,
      )
      .bind(offerId, offerId)
      .first<{ views: number; applications: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM applications
          WHERE offer_id = ? AND status = 'accepted'`,
      )
      .bind(offerId)
      .first<CountRow>(),
    db
      .prepare(
        `SELECT viewed_on AS date, COUNT(*) AS count
           FROM offer_views
          WHERE offer_id = ? AND viewed_on >= ?
          GROUP BY viewed_on`,
      )
      .bind(offerId, since)
      .all<{ date: string; count: number }>(),
    db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS count
           FROM applications
          WHERE offer_id = ? AND created_at >= ?
          GROUP BY date`,
      )
      .bind(offerId, since)
      .all<{ date: string; count: number }>(),
  ]);

  return {
    views: totals?.views ?? 0,
    applications: totals?.applications ?? 0,
    accepted: accepted?.count ?? 0,
    acceptanceRate: acceptanceRate(accepted?.count ?? 0, totals?.applications ?? 0),
    series: buildSeries(dates, viewRows.results ?? [], appRows.results ?? []),
  };
}

/**
 * Counts a view once per member per offer per UTC day. `INSERT OR IGNORE`
 * against the unique index makes it safe to call on every page render.
 */
export async function recordOfferView(
  offerId: string,
  viewerId: string,
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO offer_views
         (id, offer_id, viewer_id, viewed_on, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), offerId, viewerId, now.slice(0, 10), now)
    .run();
}
