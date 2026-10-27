// Request context + multi-tenancy, mirroring the Spring Boot model:
//   * auth: a Bearer JWT identifies the user (sub = userId).
//   * workspace: the X-Workspace header carries an id OR slug; the caller must
//     be a member, else 403 before any handler runs. Nothing trusts a workspace
//     id from a body/query param.
//   * role: owner > admin > manager > rep, resolved per request from membership.
import { verifyToken } from './jwt.js';
import { unauthorized, forbidden, ApiError } from './http.js';

const ROLE_RANK = { rep: 1, manager: 2, admin: 3, owner: 4 };

export async function requireUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  const userId = await verifyToken(token, env.JWT_SECRET);
  if (userId == null) throw unauthorized('Invalid or expired token');
  return userId;
}

/**
 * Resolve the active workspace from the X-Workspace header for this user.
 * Returns { workspaceId, role } and throws 403 for a non-member, 400 when the
 * header is missing, 404 when the workspace does not exist.
 */
export async function requireWorkspace(request, env, userId) {
  const raw = request.headers.get('X-Workspace');
  if (!raw) throw new ApiError(400, 'BAD_REQUEST', 'X-Workspace header is required');
  const isNumeric = /^\d+$/.test(raw);
  const row = await env.DB.prepare(
    `SELECT m.workspace_id AS workspaceId, m.role AS role
       FROM memberships m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ?1 AND w.status = 'active'
        AND ${isNumeric ? 'm.workspace_id = ?2' : 'w.slug = ?2'}`,
  )
    .bind(userId, isNumeric ? Number(raw) : raw)
    .first();
  if (!row) throw forbidden('Not a member of this workspace');
  return { workspaceId: row.workspaceId, role: row.role };
}

/** Guard: the resolved role must be at least `min`. */
export function requireRole(ctx, min) {
  if ((ROLE_RANK[ctx.role] || 0) < ROLE_RANK[min]) {
    throw forbidden(`Requires ${min} access`);
  }
}

export function isPrivileged(ctx) {
  return (ROLE_RANK[ctx.role] || 0) >= ROLE_RANK.admin;
}
