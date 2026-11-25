import "server-only";
import { getDb } from "./d1";
import { setGuildRole } from "./discord-bot";
import { env } from "./env";
import {
  awardsToRevoke,
  currentMonth,
  monthLabel,
  previousMonth,
  rankEntries,
  shouldAward,
  type Award,
  type LeaderboardEntry,
} from "./leaderboard";
import { createNotification } from "./notifications";

/**
 * Monthly leaderboard data + the lazy Top Closer job (PROGRESS #8: no cron in
 * this stack, so the award/revoke runs when the leaderboard is read).
 */

interface EntryRow {
  user_id: string;
  name: string;
  username: string | null;
  deals: number;
}

/** Deals logged for one `YYYY-MM`, summed across offers, ranked. */
export async function listMonthlyEntries(
  month: string,
): Promise<LeaderboardEntry[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT u.id AS user_id, u.name, u.username,
              SUM(d.deals_closed) AS deals
         FROM deals d
         JOIN users u ON u.id = d.user_id
        WHERE d.month = ?
        GROUP BY u.id
        ORDER BY deals DESC, u.name ASC`,
    )
    .bind(month)
    .all<EntryRow>();

  return rankEntries(
    (results ?? []).map((row) => ({
      userId: row.user_id,
      name: row.name,
      username: row.username ?? row.user_id,
      deals: row.deals ?? 0,
    })),
  );
}

interface AwardRow {
  id: string;
  month: string;
  user_id: string;
  rank: number;
  role_granted: number;
  revoked_at: string | null;
}

function toAward(row: AwardRow): Award {
  return {
    id: row.id,
    month: row.month,
    userId: row.user_id,
    rank: row.rank,
    roleGranted: row.role_granted === 1,
    revokedAt: row.revoked_at,
  };
}

export async function listAwards(month: string): Promise<Award[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      "SELECT * FROM leaderboard_awards WHERE month = ? ORDER BY rank ASC",
    )
    .bind(month)
    .all<AwardRow>();
  return (results ?? []).map(toAward);
}

interface DiscordRow {
  id: string;
  discord_id: string | null;
}

async function discordIds(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const db = await getDb();
  for (const userId of userIds) {
    const row = await db
      .prepare("SELECT id, discord_id FROM users WHERE id = ?")
      .bind(userId)
      .first<DiscordRow>();
    if (row?.discord_id) map.set(row.id, row.discord_id);
  }
  return map;
}

/**
 * Takes the role back from winners of earlier months, then awards the current
 * month's top three once. Every Discord call is best effort: without bot
 * credentials the role is skipped and the in-app notice still fires.
 */
export async function syncLeaderboardAwards(
  month = currentMonth(),
): Promise<void> {
  const db = await getDb();
  const roleId = env.topCloserRoleId;

  // 1. Month end: revoke every un-revoked award from a previous month.
  const { results: openRows } = await db
    .prepare(
      `SELECT * FROM leaderboard_awards
        WHERE revoked_at IS NULL AND month < ?`,
    )
    .bind(month)
    .all<AwardRow>();
  const open = (openRows ?? []).map(toAward);
  if (open.length > 0) {
    const ids = await discordIds(open.map((award) => award.userId));
    for (const award of awardsToRevoke(open, month)) {
      if (roleId) {
        await setGuildRole(ids.get(award.userId) ?? null, roleId, false);
      }
      await db
        .prepare("UPDATE leaderboard_awards SET revoked_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), award.id)
        .run();
    }
  }

  // 2. Award this month if it has not been awarded yet.
  const entries = await listMonthlyEntries(month);
  const thisMonth = await listAwards(month);
  if (shouldAward(thisMonth, entries)) {
    const winners = entries.slice(0, 3);

    for (const [index, winner] of winners.entries()) {
      const result = await db
        .prepare(
          `INSERT INTO leaderboard_awards
             (id, month, user_id, rank, role_granted, revoked_at, created_at)
           VALUES (?, ?, ?, ?, 0, NULL, ?)
           ON CONFLICT(month, user_id) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          month,
          winner.userId,
          index + 1,
          new Date().toISOString(),
        )
        .run();

      if ((result.meta?.changes ?? 0) > 0) {
        await createNotification({
          userId: winner.userId,
          kind: "leaderboard",
          title: `Top Closer — ${monthLabel(month)}`,
          body: `#${index + 1} on the monthly leaderboard with ${winner.deals} closed ${
            winner.deals === 1 ? "deal" : "deals"
          }.`,
        });
      }
    }
  }

  // 3. Retry the Discord grant for this month's winners when it did not take
  //    (for example the bot token was added after the award was recorded).
  if (!roleId) return;
  const missing = await listAwards(month);
  const pending = missing.filter((award) => !award.roleGranted);
  if (pending.length === 0) return;

  const pendingDiscord = await discordIds(pending.map((award) => award.userId));
  for (const award of pending) {
    const granted = await setGuildRole(
      pendingDiscord.get(award.userId) ?? null,
      roleId,
      true,
    );
    if (granted) {
      await db
        .prepare("UPDATE leaderboard_awards SET role_granted = 1 WHERE id = ?")
        .bind(award.id)
        .run();
    }
  }
}

/** Previous month's winners plus their final totals, for the page's recap. */
export async function previousMonthSummary(
  month = currentMonth(),
): Promise<{ month: string; entries: LeaderboardEntry[]; awards: Award[] }> {
  const last = previousMonth(month);
  const [entries, awards] = await Promise.all([
    listMonthlyEntries(last),
    listAwards(last),
  ]);
  return { month: last, entries, awards };
}
