import "server-only";
import { ApiError } from "./api";
import { env } from "./env";
import { sendBotDm } from "./discord-bot";
import { getDb } from "./d1";
import {
  matchesOffer,
  offerFacts,
  type OfferFacts,
} from "./matching";
import { createNotification } from "./notifications";
import { PRO_REQUIRED, savedSearchLimit, viewerCanUse } from "./tiers";
import type { Offer, RoleType, TierFilter, User } from "./types";
import type { SavedSearchCreateInput, SavedSearchPatchInput } from "./validation";

/**
 * Saved searches (Pro/Elite): a member's subscribed filter set. Tier limits
 * (0/5/15) are enforced here, server-side, on create only — editing an
 * existing search can never grow the list.
 */

export interface SavedSearch {
  id: string;
  name: string;
  roleType: RoleType | "all";
  tier: TierFilter;
  keywords: string;
  minCommission: number | null;
  createdAt: string;
}

interface SavedSearchRow {
  id: string;
  user_id: string;
  name: string;
  role_type: string;
  tier: string;
  keywords: string;
  min_commission: number | null;
  created_at: string;
}

function toSavedSearch(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    name: row.name,
    roleType: (row.role_type as RoleType | "all") ?? "all",
    tier: (row.tier as TierFilter) ?? "all",
    keywords: row.keywords ?? "",
    minCommission: row.min_commission ?? null,
    createdAt: row.created_at,
  };
}

/** Admins are treated as Elite for limits; everyone else follows their tier. */
function limitFor(user: Pick<User, "tier" | "isAdmin">): number {
  return savedSearchLimit(user.isAdmin ? "elite" : user.tier);
}

export async function listSavedSearches(userId: string): Promise<SavedSearch[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      "SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at ASC",
    )
    .bind(userId)
    .all<SavedSearchRow>();
  return (results ?? []).map(toSavedSearch);
}

async function countSavedSearches(userId: string): Promise<number> {
  const db = await getDb();
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM saved_searches WHERE user_id = ?")
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

function requireSearchTier(user: User): number {
  if (!viewerCanUse(user, "pro")) {
    throw new ApiError(403, PRO_REQUIRED, "tier_required");
  }
  return limitFor(user);
}

export async function createSavedSearch(
  user: User,
  input: SavedSearchCreateInput,
): Promise<SavedSearch> {
  const limit = requireSearchTier(user);

  const existing = await countSavedSearches(user.id);
  if (existing >= limit) {
    throw new ApiError(
      403,
      `You can save up to ${limit} search${limit === 1 ? "" : "es"}`,
      "limit_reached",
    );
  }

  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO saved_searches
         (id, user_id, name, role_type, tier, keywords, min_commission, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      user.id,
      input.name,
      input.roleType,
      input.tier,
      input.keywords,
      input.minCommission,
      now,
    )
    .run();

  return {
    id,
    name: input.name,
    roleType: input.roleType,
    tier: input.tier,
    keywords: input.keywords,
    minCommission: input.minCommission,
    createdAt: now,
  };
}

/** Owner-scoped: a patch or delete that matches no row is simply false. */
export async function updateSavedSearch(
  userId: string,
  id: string,
  patch: SavedSearchPatchInput,
): Promise<SavedSearch | null> {
  const db = await getDb();

  const assignments: string[] = [];
  const values: unknown[] = [];
  const columns: Record<string, string> = {
    name: "name",
    roleType: "role_type",
    tier: "tier",
    keywords: "keywords",
    minCommission: "min_commission",
  };

  for (const [key, column] of Object.entries(columns)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(value);
  }

  if (assignments.length === 0) return null;

  const result = await db
    .prepare(
      `UPDATE saved_searches SET ${assignments.join(", ")} WHERE id = ? AND user_id = ?`,
    )
    .bind(...values, id, userId)
    .run();
  if ((result.meta?.changes ?? 0) === 0) return null;

  const row = await db
    .prepare("SELECT * FROM saved_searches WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<SavedSearchRow>();
  return row ? toSavedSearch(row) : null;
}

export async function deleteSavedSearch(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .prepare("DELETE FROM saved_searches WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Matches a freshly published offer against every saved search and alerts the
 * owners: one in-app notification per user no matter how many of their
 * searches matched, plus a best-effort Discord DM (skipped without a bot and
 * an account-linked Discord id — PROGRESS #2). Never throws.
 */
export async function alertSavedSearches(offer: Offer): Promise<number> {
  try {
    if (offer.status !== "open") return 0;

    const db = await getDb();
    const { results } = await db
      .prepare(
        `SELECT s.*, u.discord_id
           FROM saved_searches s
           JOIN users u ON u.id = s.user_id`,
      )
      .all<SavedSearchRow & { discord_id: string | null }>();

    const facts: OfferFacts = offerFacts(offer);
    const matchedByUser = new Map<
      string,
      { discordId: string | null; name: string }
    >();

    for (const row of results ?? []) {
      if (row.user_id === offer.createdBy) continue;
      if (matchedByUser.has(row.user_id)) continue;

      const search = toSavedSearch(row);
      if (
        matchesOffer(
          {
            roleType: search.roleType,
            tier: search.tier,
            keywords: search.keywords,
            minCommission: search.minCommission,
          },
          facts,
        )
      ) {
        matchedByUser.set(row.user_id, {
          discordId: row.discord_id,
          name: row.name,
        });
      }
    }

    const appUrl = `${env.appUrl}/offers/${offer.id}`;

    for (const [userId, match] of matchedByUser) {
      await createNotification({
        userId,
        kind: "saved_search",
        title: `New match: ${offer.title}`,
        body: `${offer.company} · ${offer.commission}`,
        offerId: offer.id,
      });

      await sendBotDm(
        match.discordId,
        `📌 Saved-search match: **${offer.title}** at ${offer.company}\n${appUrl}`,
      );
    }

    return matchedByUser.size;
  } catch (error) {
    console.error("[saved-searches] alert sweep failed:", error);
    return 0;
  }
}
