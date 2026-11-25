import "server-only";
import { getDb } from "./d1";

/**
 * In-app notifications — the delivery path that works whether or not a
 * Discord bot is configured (PROGRESS #7). Rows are per user; clients only
 * ever mark their own rows read.
 */

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  offerId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  offer_id: string | null;
  read_at: string | null;
  created_at: string;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    offerId: row.offer_id ?? null,
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  };
}

export async function createNotification(input: {
  userId: string;
  kind: string;
  title: string;
  body?: string;
  offerId?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO notifications (id, user_id, kind, title, body, offer_id, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.kind,
      input.title,
      input.body ?? "",
      input.offerId ?? null,
      new Date().toISOString(),
    )
    .run();
}

/** Newest first, capped so the page never renders an unbounded list. */
export async function listNotifications(
  userId: string,
  limit = 100,
): Promise<Notification[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT * FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(userId, limit)
    .all<NotificationRow>();
  return (results ?? []).map(toNotification);
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL",
    )
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const db = await getDb();
  const result = await db
    .prepare(
      "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
    )
    .bind(new Date().toISOString(), userId)
    .run();
  return result.meta?.changes ?? 0;
}

/** Scoped to the owner in the WHERE clause — a user can never mark another. */
export async function markNotificationRead(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .prepare(
      "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL",
    )
    .bind(new Date().toISOString(), id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
