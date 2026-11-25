import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { ApiError } from "./api";
import { isPartnerRole, PARTNER_ROLE } from "./partners";
import { effectiveTier } from "./pricing";
import { getUserRoles } from "./roles";
import { getSubscription } from "./subscriptions";
import { readSession } from "./session";
import { getUserById, toUser } from "./users";
import type { User } from "./types";

export interface AuthContext {
  user: User;
}

/** A signed-in admin or `partner`-role member. */
export interface StaffContext extends AuthContext {
  isPartner: boolean;
}

/**
 * Reads the session cookie and loads the account behind it. The account row is
 * re-read on every request, so an admin promotion (or deletion) takes effect
 * immediately rather than waiting for the cookie to expire.
 *
 * The tier is taken from the Whop-backed `subscriptions` row whenever one
 * exists; `users.tier` is only the fallback for accounts that never
 * subscribed (for example a legacy admin assignment). A canceled subscription
 * therefore drops access on the next request, with no webhook trust in the
 * client.
 *
 * Wrapped in React's `cache` so the header and the page guard that both need
 * the account share one read per request (without it the user and
 * subscription rows were loaded twice on every signed-in page). Outside a
 * render — route handlers — the wrapper simply calls through.
 */
export const getAuthContext = cache(async function getAuthContext(): Promise<AuthContext | null> {
  const session = await readSession();
  if (!session) return null;

  // The subscription is keyed by the same id the session carries, so both
  // rows can be read in parallel instead of one after the other.
  const [row, subscription] = await Promise.all([
    getUserById(session.uid),
    getSubscription(session.uid),
  ]);
  if (!row) return null;

  const user = toUser(row);

  return {
    user: {
      ...user,
      tier: subscription ? effectiveTier(subscription) : user.tier,
    },
  };
});

/**
 * Loads the staff context: admins plus members holding the `partner` role.
 * Returns null when signed out *or* when the member is neither.
 */
async function loadStaffContext(): Promise<StaffContext | null> {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  if (ctx.user.isAdmin) return { user: ctx.user, isPartner: false };

  const roles = await getUserRoles(ctx.user.id);
  if (!isPartnerRole(roles)) return null;
  return { user: ctx.user, isPartner: true };
}

/* ------------------------------------------------------------------ *
 * Page guards — redirect instead of erroring.
 * ------------------------------------------------------------------ */

export async function requireMember(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireMember();
  if (!ctx.user.isAdmin) redirect("/offers");
  return ctx;
}

/**
 * Staff page guard for the /admin segment: admins and partners pass, other
 * members are bounced back to the board (the layout uses it so a partner
 * cannot be locked out by a page added later).
 */
export async function requireStaff(): Promise<StaffContext> {
  const base = await requireMember();
  const staff = await loadStaffContext();
  if (!staff) redirect("/offers");
  // Keep the freshly-read member (requireMember already loaded it).
  return { user: base.user, isPartner: staff.isPartner };
}

/** Admin-only page inside the staff area — partners go back to the board. */
export async function requireAdminInStaff(): Promise<AuthContext> {
  const ctx = await requireMember();
  if (!ctx.user.isAdmin) redirect("/admin");
  return ctx;
}

/* ------------------------------------------------------------------ *
 * API guards — throw 401/403 for `runApi` to render.
 * ------------------------------------------------------------------ */

export async function requireMemberApi(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    throw new ApiError(401, "Sign in to continue", "unauthorized");
  }
  return ctx;
}

export async function requireAdminApi(): Promise<AuthContext> {
  const ctx = await requireMemberApi();
  if (!ctx.user.isAdmin) {
    throw new ApiError(403, "Admin access required", "forbidden");
  }
  return ctx;
}

/** API guard for endpoints shared by admins and partners. */
export async function requireStaffApi(): Promise<StaffContext> {
  const ctx = await requireMemberApi();
  if (ctx.user.isAdmin) return { user: ctx.user, isPartner: false };

  const roles = await getUserRoles(ctx.user.id);
  if (!isPartnerRole(roles)) {
    throw new ApiError(403, "Partner or admin access required", "forbidden");
  }
  return { user: ctx.user, isPartner: true };
}

export { PARTNER_ROLE };
