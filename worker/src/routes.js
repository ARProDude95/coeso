// API routes for the first slice: auth, workspaces (+ default seed), lookups,
// stats and branding. Handlers are async and throw ApiError; the entrypoint
// catches and maps them to the shared error envelope.
import {
  ApiError,
  badRequest,
  conflict,
  json,
  notFound,
  unauthorized,
} from './lib/http.js';
import { hashPassword, verifyPassword } from './lib/password.js';
import { signToken } from './lib/jwt.js';
import { requireUser, requireWorkspace } from './lib/tenancy.js';
import { handleCore } from './routes-core.js';

// ------------------------------------------------------------------ helpers

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'workspace'
  );
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw badRequest('Malformed request body');
  }
}

/** Public user shape (never leaks password_hash). */
function userRow(row) {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

// -------------------------------------------------------------------- auth

async function register(request, env) {
  const body = await readJson(request);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const displayName = String(body.displayName ?? '').trim();
  if (!email || !email.includes('@')) throw badRequest('A valid email is required');
  if (password.length < 8) throw badRequest('Password must be at least 8 characters');
  if (!displayName) throw badRequest('Name is required');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (existing) throw conflict('An account with that email already exists');

  const passwordHash = await hashPassword(password);
  const res = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?1, ?2, ?3)',
  )
    .bind(email, passwordHash, displayName)
    .run();
  const id = res.meta.last_row_id;
  const token = await signToken(id, env.JWT_SECRET);
  return json({ token, user: { id, email, displayName } }, 201);
}

async function login(request, env) {
  const body = await readJson(request);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?1').bind(email).first();
  // Verify against a dummy hash when the user is missing so timing doesn't
  // reveal whether the email exists.
  const ok = row
    ? await verifyPassword(password, row.password_hash)
    : await verifyPassword(password, 'pbkdf2$100000$' + '00'.repeat(32) + '$' + '00'.repeat(32));
  if (!row || !ok) throw unauthorized('Invalid email or password');
  const token = await signToken(row.id, env.JWT_SECRET);
  return json({ token, user: userRow(row) });
}

async function me(request, env) {
  const userId = await requireUser(request, env);
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(userId).first();
  if (!row) throw unauthorized();
  return json(userRow(row));
}

// --------------------------------------------------------------- workspaces

async function listWorkspaces(request, env) {
  const userId = await requireUser(request, env);
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.name, w.slug, m.role
       FROM memberships m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ?1 AND w.status = 'active'
      ORDER BY w.id`,
  )
    .bind(userId)
    .all();
  return json(results.map((r) => ({ id: r.id, name: r.name, slug: r.slug, role: r.role.toUpperCase() })));
}

/** Seed a brand-new workspace with the same defaults DefaultSeedService writes. */
async function seedWorkspace(db, workspaceId, freePlanId) {
  const now = Date.now() / 1000;
  const stmts = [
    db.prepare('INSERT INTO verticals (workspace_id, name) VALUES (?1, ?2)').bind(workspaceId, 'Sales'),
    db.prepare('INSERT INTO verticals (workspace_id, name) VALUES (?1, ?2)').bind(workspaceId, 'Advertising'),
    db.prepare('INSERT INTO verticals (workspace_id, name) VALUES (?1, ?2)').bind(workspaceId, 'Partnerships'),
    db.prepare('INSERT INTO rep_statuses (workspace_id, name, kind) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Bench', 'bench'),
    db.prepare('INSERT INTO rep_statuses (workspace_id, name, kind) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Training', 'training'),
    db.prepare('INSERT INTO rep_statuses (workspace_id, name, kind) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Inactive', 'inactive'),
    db.prepare('INSERT INTO experience_levels (workspace_id, name) VALUES (?1, ?2)').bind(workspaceId, 'Junior'),
    db.prepare('INSERT INTO experience_levels (workspace_id, name) VALUES (?1, ?2)').bind(workspaceId, 'Mid'),
    db.prepare('INSERT INTO experience_levels (workspace_id, name) VALUES (?1, ?2)').bind(workspaceId, 'Senior'),
    db.prepare('INSERT INTO pipeline_stages (workspace_id, name, position) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Sourcing', 1),
    db.prepare('INSERT INTO pipeline_stages (workspace_id, name, position) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Interviewing', 2),
    db.prepare('INSERT INTO pipeline_stages (workspace_id, name, position) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Onboarding', 3),
    db.prepare('INSERT INTO pipeline_stages (workspace_id, name, position) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Live', 4),
    db.prepare('INSERT INTO metric_types (workspace_id, name, unit) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Calls', 'count'),
    db.prepare('INSERT INTO metric_types (workspace_id, name, unit) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Meetings', 'count'),
    db.prepare('INSERT INTO metric_types (workspace_id, name, unit) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Deals closed', 'count'),
    db.prepare('INSERT INTO metric_types (workspace_id, name, unit) VALUES (?1, ?2, ?3)').bind(workspaceId, 'Revenue generated', 'currency'),
    db.prepare('INSERT INTO subscriptions (workspace_id, plan_id, status, trial_ends_at) VALUES (?1, ?2, ?3, ?4)').bind(workspaceId, freePlanId, 'trialing', now + 14 * 86400),
  ];
  await db.batch(stmts);
}

async function createWorkspace(request, env) {
  const userId = await requireUser(request, env);
  const body = await readJson(request);
  const name = String(body.name ?? '').trim();
  if (!name) throw badRequest('Workspace name is required');
  let slug = String(body.slug ?? '').trim() || slugify(name);
  if (!/^[a-z0-9-]+$/.test(slug)) throw badRequest('Slug must be lowercase letters, numbers and dashes');

  // Ensure slug uniqueness (append a counter when taken).
  let candidate = slug;
  for (let i = 2; ; i++) {
    const taken = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?1').bind(candidate).first();
    if (!taken) break;
    candidate = `${slug}-${i}`;
    if (i > 50) throw conflict('Could not allocate a unique slug');
  }
  slug = candidate;

  const freePlan = await env.DB.prepare("SELECT id FROM plans WHERE code = 'free'").bind().first();
  if (!freePlan) throw new ApiError(500, 'INTERNAL', 'Plans not seeded');

  const res = await env.DB.prepare(
    'INSERT INTO workspaces (name, slug, plan_id, status) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(name, slug, freePlan.id, 'active')
    .run();
  const workspaceId = res.meta.last_row_id;

  await env.DB.batch([
    env.DB.prepare('INSERT INTO memberships (workspace_id, user_id, role) VALUES (?1, ?2, ?3)').bind(workspaceId, userId, 'owner'),
  ]);
  await seedWorkspace(env.DB, workspaceId, freePlan.id);

  return json({ id: workspaceId, name, slug, role: 'OWNER' }, 201);
}

// ----------------------------------------------------------------- lookups

async function listLookup(table, request, env) {
  const userId = await requireUser(request, env);
  const ctx = await requireWorkspace(request, env, userId);
  const cols = table === 'rep_statuses' ? 'id, name, kind' : 'id, name';
  const { results } = await env.DB.prepare(
    `SELECT ${cols} FROM ${table} WHERE workspace_id = ?1 ORDER BY id`,
  )
    .bind(ctx.workspaceId)
    .all();
  return json(results);
}

async function listVerticals(request, env) {
  return listLookup('verticals', request, env);
}
async function listStatuses(request, env) {
  return listLookup('rep_statuses', request, env);
}
async function listLevels(request, env) {
  return listLookup('experience_levels', request, env);
}

// -------------------------------------------------------------- stats/brand

async function stats(request, env) {
  const userId = await requireUser(request, env);
  const ctx = await requireWorkspace(request, env, userId);
  const ws = ctx.workspaceId;
  const [totalReps, placed, bench, openOffers] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS c FROM reps WHERE workspace_id = ?1 AND deleted_at IS NULL').bind(ws).first(),
    env.DB.prepare("SELECT COUNT(DISTINCT rep_id) AS c FROM placements WHERE workspace_id = ?1 AND status = 'active'").bind(ws).first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM reps WHERE workspace_id = ?1 AND deleted_at IS NULL AND status_id IN (SELECT id FROM rep_statuses WHERE workspace_id = ?1 AND kind = 'bench')").bind(ws).first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM offers WHERE workspace_id = ?1 AND status = 'open'").bind(ws).first(),
  ]);
  return json({
    totalReps: totalReps.c,
    placedCount: placed.c,
    benchCount: bench.c,
    openOffers: openOffers.c,
  });
}

async function branding(request, env) {
  const userId = await requireUser(request, env);
  const ctx = await requireWorkspace(request, env, userId);
  const row = await env.DB.prepare(
    'SELECT logo_url, accent_color, custom_domain FROM workspaces WHERE id = ?1',
  )
    .bind(ctx.workspaceId)
    .first();
  if (!row) throw notFound('Workspace not found');
  return json({ logoUrl: row.logo_url, accentColor: row.accent_color, customDomain: row.custom_domain });
}

// ------------------------------------------------------------------ router

/** Dispatch an /api request. Returns a Response or null when unrouted. */
export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'POST' && path === '/api/auth/register') return register(request, env);
  if (method === 'POST' && path === '/api/auth/login') return login(request, env);
  if (method === 'GET' && path === '/api/auth/me') return me(request, env);

  if (method === 'GET' && path === '/api/workspaces') return listWorkspaces(request, env);
  if (method === 'POST' && path === '/api/workspaces') return createWorkspace(request, env);

  if (method === 'GET' && path === '/api/verticals') return listVerticals(request, env);
  if (method === 'GET' && path === '/api/statuses') return listStatuses(request, env);
  if (method === 'GET' && path === '/api/experience-levels') return listLevels(request, env);

  if (method === 'GET' && path === '/api/stats') return stats(request, env);
  if (method === 'GET' && path === '/api/workspaces/branding') return branding(request, env);



  // Everything else lives in routes-core: reps, clients, offers, placements,
  // pipeline, reports, audit, activity/performance, billing, community.
  return handleCore(request, env);
}
