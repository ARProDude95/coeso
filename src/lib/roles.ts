import "server-only";
import { cache } from "react";
import { getDb } from "./d1";
import { ROLE_PATTERN } from "./validation";
import type { User } from "./types";

/**
 * Access roles behind the paid plan.
 *
 * Roles are assigned by the admin today; the table (one row per user per
 * role) deliberately mirrors Discord's guild-role shape so the sync can be
 * wired to Discord's API later without touching this module's interface.
 */
export interface Viewer {
  id: string;
  isAdmin: boolean;
  roles: string[];
}

/** Thrown when a role slug doesn't match `ROLE_PATTERN`. */
export class InvalidRoleError extends Error {
  constructor(value: string) {
    super(`[roles] not a valid role slug: ${JSON.stringify(value)}`);
    this.name = "InvalidRoleError";
  }
}

function normalise(role: string): string {
  return role.trim().toLowerCase();
}

interface UserRolesRow {
  user_id: string;
  role: string;
}

/* Request-memoised: the header badge and the page's viewer both read the
 * same member's roles during one render, so a single query serves both. */
export const getUserRoles = cache(async function getUserRoles(
  userId: string,
): Promise<string[]> {
  const db = await getDb();
  const { results } = await db
    .prepare("SELECT role FROM user_roles WHERE user_id = ? ORDER BY role")
    .bind(userId)
    .all<{ role: string }>();
  return (results ?? []).map((row) => row.role);
});

/**
 * Roles for many users in as few reads as possible (the members page and any
 * future directory need one round trip, not one per row). D1 caps a statement
 * at 100 bound parameters, so the id list is chunked.
 */
export async function getRolesForUsers(
  userIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;

  const db = await getDb();
  const CHUNK = 90;

  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT user_id, role FROM user_roles
          WHERE user_id IN (${placeholders})
          ORDER BY role`,
      )
      .bind(...chunk)
      .all<UserRolesRow>();

    for (const row of results ?? []) {
      const roles = map.get(row.user_id) ?? [];
      roles.push(row.role);
      map.set(row.user_id, roles);
    }
  }

  return map;
}

/** Every distinct role currently in use — powers the datalists and UI hints. */
export async function listRolesInUse(): Promise<string[]> {
  const db = await getDb();
  const { results } = await db
    .prepare("SELECT DISTINCT role FROM user_roles ORDER BY role")
    .all<{ role: string }>();
  return (results ?? []).map((row) => row.role);
}

export async function assignRole(
  userId: string,
  role: string,
): Promise<string> {
  const slug = normalise(role);
  if (!ROLE_PATTERN.test(slug)) throw new InvalidRoleError(role);

  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO user_roles (user_id, role, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, role) DO NOTHING`,
    )
    .bind(userId, slug, new Date().toISOString())
    .run();

  return slug;
}

/** Returns false when that member never held the role. */
export async function removeRole(
  userId: string,
  role: string,
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .prepare("DELETE FROM user_roles WHERE user_id = ? AND role = ?")
    .bind(userId, normalise(role))
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Builds the viewer for a read. Admins bypass gating, so their role query is
 * skipped — one fewer read on every page they open.
 */
export async function loadViewer(
  user: Pick<User, "id" | "isAdmin">,
): Promise<Viewer> {
  if (user.isAdmin) return { id: user.id, isAdmin: true, roles: [] };
  return { id: user.id, isAdmin: false, roles: await getUserRoles(user.id) };
}

/**
 * The single source of truth for whether an offer is visible: ungated offers
 * are for everyone, gated ones only for admins or holders of the role.
 */
export function canViewOffer(
  offer: { requiredRole: string | null },
  viewer: Viewer,
): boolean {
  if (!offer.requiredRole) return true;
  if (viewer.isAdmin) return true;
  return viewer.roles.includes(offer.requiredRole);
}

/**
 * SQL condition for list queries, keeping gated offers the viewer can't see
 * out of the result set entirely (they are not merely hidden in the UI). The
 * fragment is a bare parenthesised condition — callers join it with `AND`.
 * Admins and the admin listing pass `null` and get no restriction.
 */
export function gatedOffersClause(viewer: Viewer | null): {
  sql: string;
  value: string;
} | null {
  if (!viewer || viewer.isAdmin) return null;
  return {
    sql: `(
            o.required_role IS NULL
            OR o.required_role = ''
            OR EXISTS (
              SELECT 1 FROM user_roles ur
               WHERE ur.user_id = ? AND ur.role = o.required_role
            )
          )`,
    value: viewer.id,
  };
}
