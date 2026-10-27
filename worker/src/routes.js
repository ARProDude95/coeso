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
import { requireRole, requireUser, requireWorkspace } from './lib/tenancy.js';

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

// ------------------------------------------------------------ reps/offers

async function listReps(request, env) {
  const userId = await requireUser(request, env);
  const ctx = await requireWorkspace(request, env, userId);
  const p = new URL(request.url).searchParams;
  const where = ['r.workspace_id = ?1', 'r.deleted_at IS NULL'];
  const binds = [ctx.workspaceId];
  const add = (clause, value) => {
    binds.push(value);
    where.push(clause.replace('?', `?${binds.length}`));
  };
  if (p.get('q')) add('(r.name LIKE ? OR r.email LIKE ?)', `%${p.get('q')}%`);
  if (p.get('verticalId')) add('r.vertical_id = ?', Number(p.get('verticalId')));
  if (p.get('statusId')) add('r.status_id = ?', Number(p.get('statusId')));
  if (p.get('experienceId')) add('r.experience_level_id = ?', Number(p.get('experienceId')));
  if (p.get('placed') === 'true') where.push("pl.id IS NOT NULL");
  if (p.get('placed') === 'false') where.push("pl.id IS NULL");
  const whereSql = where.join(' AND ');
  const size = Math.min(200, Number(p.get('size') || 25));
  const page = Math.max(0, Number(p.get('page') || 0));

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM reps r
       LEFT JOIN placements pl ON pl.workspace_id = r.workspace_id AND pl.rep_id = r.id AND pl.status = 'active'
      WHERE ${whereSql}`,
  )
    .bind(...binds)
    .first();

  const { results } = await env.DB.prepare(
    `SELECT r.id, r.name, r.email, r.notes, r.joined_date, r.bio, r.timezone, r.hours_per_week, r.available_from,
            r.vertical_id, v.name AS vertical_name,
            r.status_id, s.name AS status_name, s.kind AS status_kind,
            r.experience_level_id, el.name AS experience_level_name,
            o.title AS offer_title, c.name AS client_name
       FROM reps r
       LEFT JOIN verticals v ON v.workspace_id = r.workspace_id AND v.id = r.vertical_id
       LEFT JOIN rep_statuses s ON s.workspace_id = r.workspace_id AND s.id = r.status_id
       LEFT JOIN experience_levels el ON el.workspace_id = r.workspace_id AND el.id = r.experience_level_id
       LEFT JOIN placements pl ON pl.workspace_id = r.workspace_id AND pl.rep_id = r.id AND pl.status = 'active'
       LEFT JOIN offers o ON o.workspace_id = r.workspace_id AND o.id = pl.offer_id
       LEFT JOIN clients c ON c.workspace_id = r.workspace_id AND c.id = o.client_id
      WHERE ${whereSql}
      ORDER BY r.id LIMIT ?${binds.length + 1} OFFSET ?${binds.length + 2}`,
  )
    .bind(...binds, size, page * size)
    .all();

  const items = results.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    verticalId: r.vertical_id,
    verticalName: r.vertical_name,
    statusId: r.status_id,
    statusName: r.status_name,
    statusKind: r.status_kind ? r.status_kind.toUpperCase() : null,
    experienceLevelId: r.experience_level_id,
    experienceLevelName: r.experience_level_name,
    notes: r.notes,
    joinedDate: r.joined_date,
    placed: r.offer_title != null,
    offerId: null,
    offerTitle: r.offer_title,
    clientName: r.client_name,
    benchDays: null,
    bio: r.bio,
    timezone: r.timezone,
    hoursPerWeek: r.hours_per_week,
    availableFrom: r.available_from,
  }));
  return json({ page, size, total: totalRow.c, items });
}

async function offerRows(env, ws) {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.client_id, c.name AS client_name, o.vertical_id, v.name AS vertical_name,
            o.title, o.seats, o.notes, o.status, o.stage_id, st.name AS stage_name,
            (SELECT COUNT(*) FROM placements pl WHERE pl.workspace_id = o.workspace_id AND pl.offer_id = o.id AND pl.status = 'active') AS filled
       FROM offers o
       LEFT JOIN clients c ON c.workspace_id = o.workspace_id AND c.id = o.client_id
       LEFT JOIN verticals v ON v.workspace_id = o.workspace_id AND v.id = o.vertical_id
       LEFT JOIN pipeline_stages st ON st.workspace_id = o.workspace_id AND st.id = o.stage_id
      WHERE o.workspace_id = ?1
      ORDER BY o.id`,
  )
    .bind(ws)
    .all();
  const repsByOffer = new Map();
  const pr = await env.DB.prepare(
    `SELECT pl.offer_id, pl.rep_id, r.name AS rep_name
       FROM placements pl JOIN reps r ON r.workspace_id = pl.workspace_id AND r.id = pl.rep_id
      WHERE pl.workspace_id = ?1 AND pl.status = 'active'`,
  )
    .bind(ws)
    .all();
  for (const row of pr.results) {
    if (!repsByOffer.has(row.offer_id)) repsByOffer.set(row.offer_id, []);
    repsByOffer.get(row.offer_id).push({ repId: row.rep_id, repName: row.rep_name });
  }
  return results.map((o) => ({
    id: o.id,
    clientId: o.client_id,
    clientName: o.client_name,
    verticalId: o.vertical_id,
    verticalName: o.vertical_name,
    title: o.title,
    seats: o.seats,
    filledSeats: o.filled,
    notes: o.notes,
    status: o.status === 'closed' ? 'CLOSED' : 'OPEN',
    effectiveStatus: o.status === 'closed' ? 'CLOSED' : o.filled >= o.seats ? 'FILLED' : 'OPEN',
    reps: repsByOffer.get(o.id) || [],
    stageId: o.stage_id,
    stageName: o.stage_name,
  }));
}

async function listOffers(request, env) {
  const userId = await requireUser(request, env);
  const ctx = await requireWorkspace(request, env, userId);
  return json(await offerRows(env, ctx.workspaceId));
}

async function listStages(request, env) {
  const userId = await requireUser(request, env);
  const ctx = await requireWorkspace(request, env, userId);
  const { results } = await env.DB.prepare(
    'SELECT id, name, position FROM pipeline_stages WHERE workspace_id = ?1 ORDER BY position',
  )
    .bind(ctx.workspaceId)
    .all();
  return json(results);
}

async function board(request, env) {
  const userId = await requireUser(request, env);
  const ctx = await requireWorkspace(request, env, userId);
  requireRole(ctx, 'manager');
  const stages = await (async () => {
    const { results } = await env.DB.prepare(
      'SELECT id, name, position FROM pipeline_stages WHERE workspace_id = ?1 ORDER BY position',
    )
      .bind(ctx.workspaceId)
      .all();
    return results;
  })();
  const offers = await offerRows(env, ctx.workspaceId);
  const byStage = new Map();
  for (const o of offers) {
    const key = o.stageId ?? stages[0]?.id ?? -1;
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key).push(o);
  }
  return json(
    stages.map((s) => ({
      stage: { id: s.id, name: s.name, position: s.position },
      offers: byStage.get(s.id) || [],
    })),
  );
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

  if (method === 'GET' && path === '/api/reps') return listReps(request, env);
  if (method === 'GET' && path === '/api/offers') return listOffers(request, env);
  if (method === 'GET' && path === '/api/pipeline/stages') return listStages(request, env);
  if (method === 'GET' && path === '/api/pipeline/board') return board(request, env);

  return null; // unrouted
}
