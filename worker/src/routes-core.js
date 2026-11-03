// Core API routes: reps, clients, offers, placements, pipeline, lookup writes,
// reports, audit, activity/performance, billing reads, workspace settings —
// plus the community modules' read models (pods, intros, engagement, office
// hours, digest, discord settings).
//
// Every handler mirrors a Spring Boot controller so frontend/src/api.ts keeps
// working unchanged against the Worker. routes.js owns auth, workspace reads,
// lookup reads, stats and branding reads, then delegates everything else here.
// Writes enforce the same role ladder (manager for most, admin for pipeline and
// workspace settings, owner for workspace deletion) through lib/tenancy.
import { ApiError, badRequest, conflict, json, notFound } from './lib/http.js';
import { requireRole, requireUser, requireWorkspace } from './lib/tenancy.js';

// ------------------------------------------------------------------ helpers

const stmt = (db, sql, binds = []) => (binds.length ? db.prepare(sql).bind(...binds) : db.prepare(sql));
const all = async (db, sql, binds = []) => (await stmt(db, sql, binds).all()).results || [];
const one = (db, sql, binds = []) => stmt(db, sql, binds).first();
const exec = (db, sql, binds = []) => stmt(db, sql, binds).run();
const noContent = () => new Response(null, { status: 204 });

/** A feature whose full service lives in the Spring backend, not yet here. */
const unavailable = (what) =>
  new ApiError(501, 'NOT_AVAILABLE', `${what} is not available in this deployment yet`);

/** DB timestamps are "YYYY-MM-DD HH:MM:SS"; the SPA expects ISO. */
function iso(value) {
  if (value == null) return null;
  const s = String(value);
  return s.includes('T') ? s : s.replace(' ', 'T');
}

function daysSince(value) {
  if (!value) return null;
  const t = new Date(`${String(value).slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function num(value, fallback = null) {
  // Number(null) === 0, which would silently turn a missing query param into a
  // real value (e.g. size=0 -> empty page), so treat null/undefined/'' as absent.
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trimmed(value) {
  const s = value == null ? '' : String(value).trim();
  return s === '' ? null : s;
}

function dateOrNull(value) {
  const s = trimmed(value);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest('Date must be YYYY-MM-DD');
  return s;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw badRequest('Malformed request body');
  }
}

/** Resolve the caller + workspace (member check happens inside). */
async function ctxOf(request, env) {
  const userId = await requireUser(request, env);
  const ctx = await requireWorkspace(request, env, userId);
  return { userId, ws: ctx.workspaceId, role: ctx.role, ctx };
}

async function audit(db, ws, userId, action, entityType, entityId, details = null) {
  await exec(
    db,
    `INSERT INTO audit_log (workspace_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ws, userId, action, entityType, entityId, details ? JSON.stringify(details) : null],
  );
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
const csvResponse = (text, filename) =>
  new Response(text, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });

// ---------------------------------------------------------------------- reps

const REP_SELECT = `
  SELECT r.id, r.name, r.email, r.discord_user_id, r.notes, r.joined_date,
         r.bio, r.timezone, r.hours_per_week, r.available_from, r.created_at,
         r.vertical_id, v.name AS vertical_name,
         r.status_id, s.name AS status_name, s.kind AS status_kind,
         r.experience_level_id, el.name AS experience_level_name,
         pl.id AS placement_id, pl.offer_id AS offer_id, o.title AS offer_title,
         c.name AS client_name
    FROM reps r
    LEFT JOIN verticals v ON v.workspace_id = r.workspace_id AND v.id = r.vertical_id
    LEFT JOIN rep_statuses s ON s.workspace_id = r.workspace_id AND s.id = r.status_id
    LEFT JOIN experience_levels el ON el.workspace_id = r.workspace_id AND el.id = r.experience_level_id
    LEFT JOIN placements pl ON pl.workspace_id = r.workspace_id AND pl.rep_id = r.id AND pl.status = 'active'
    LEFT JOIN offers o ON o.workspace_id = r.workspace_id AND o.id = pl.offer_id
    LEFT JOIN clients c ON c.workspace_id = r.workspace_id AND c.id = o.client_id`;

function repFilters(ws, p) {
  const where = ['r.workspace_id = ?', 'r.deleted_at IS NULL'];
  const binds = [ws];
  const add = (clause, value) => {
    binds.push(value);
    where.push(clause);
  };
  const q = trimmed(p.get('q'));
  if (q) add("(r.name LIKE ? OR IFNULL(r.email, '') LIKE ?)", `%${q}%`), binds.push(`%${q}%`);
  if (num(p.get('verticalId'))) add('r.vertical_id = ?', num(p.get('verticalId')));
  if (num(p.get('statusId'))) add('r.status_id = ?', num(p.get('statusId')));
  if (num(p.get('experienceId'))) add('r.experience_level_id = ?', num(p.get('experienceId')));
  const placedFilter = p.get('placed');
  if (placedFilter === 'true') {
    where.push("EXISTS (SELECT 1 FROM placements px WHERE px.workspace_id = r.workspace_id AND px.rep_id = r.id AND px.status = 'active')");
  } else if (placedFilter === 'false') {
    where.push("NOT EXISTS (SELECT 1 FROM placements px WHERE px.workspace_id = r.workspace_id AND px.rep_id = r.id AND px.status = 'active')");
  }
  if (num(p.get('skillId'))) {
    where.push('EXISTS (SELECT 1 FROM rep_skills rs WHERE rs.workspace_id = r.workspace_id AND rs.rep_id = r.id AND rs.tag_id = ?)');
    binds.push(num(p.get('skillId')));
  }
  const language = trimmed(p.get('language'));
  if (language) {
    where.push('EXISTS (SELECT 1 FROM rep_languages rl WHERE rl.workspace_id = r.workspace_id AND rl.rep_id = r.id AND lower(rl.language) = lower(?))');
    binds.push(language);
  }
  if (p.get('available') === 'true') {
    where.push("(r.available_from IS NULL OR r.available_from <= date('now'))");
  } else if (p.get('available') === 'false') {
    where.push("(r.available_from IS NOT NULL AND r.available_from > date('now'))");
  }
  return { where: where.join(' AND '), binds };
}

/** Enrich base rep rows with skills, languages, preferred verticals, photo
 *  flag and the bench clock (days since last ended placement / joined date). */
async function repPayload(db, ws, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  const base = [ws, ...ids];
  const [skills, langs, prefs, photos, ended] = await Promise.all([
    all(db, `SELECT rs.rep_id, t.name AS name FROM rep_skills rs
               JOIN skill_tags t ON t.workspace_id = rs.workspace_id AND t.id = rs.tag_id
              WHERE rs.workspace_id = ? AND rs.rep_id IN (${ph}) ORDER BY t.name`, base),
    all(db, `SELECT rep_id, language AS name FROM rep_languages
              WHERE workspace_id = ? AND rep_id IN (${ph}) ORDER BY language`, base),
    all(db, `SELECT rep_id, vertical_id FROM rep_preferred_verticals
              WHERE workspace_id = ? AND rep_id IN (${ph})`, base),
    all(db, `SELECT rep_id FROM rep_photos WHERE workspace_id = ? AND rep_id IN (${ph})`, base),
    all(db, `SELECT rep_id, MAX(ended_at) AS last FROM placements
              WHERE workspace_id = ? AND status = 'ended' AND rep_id IN (${ph})
              GROUP BY rep_id`, base),
  ]);
  const group = (list) => {
    const m = new Map();
    for (const row of list) {
      if (!m.has(row.rep_id)) m.set(row.rep_id, []);
      m.get(row.rep_id).push(row);
    }
    return m;
  };
  const skillMap = group(skills);
  const langMap = group(langs);
  const prefMap = group(prefs);
  const photoSet = new Set(photos.map((p) => p.rep_id));
  const endedMap = new Map(ended.map((e) => [e.rep_id, e.last]));

  return rows.map((r) => {
    const placed = r.offer_id != null;
    const benchSince = endedMap.get(r.id) || r.joined_date || r.created_at;
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      discordUserId: r.discord_user_id,
      verticalId: r.vertical_id,
      verticalName: r.vertical_name,
      statusId: r.status_id,
      statusName: r.status_name,
      statusKind: r.status_kind ? String(r.status_kind).toUpperCase() : null,
      experienceLevelId: r.experience_level_id,
      experienceLevelName: r.experience_level_name,
      notes: r.notes,
      joinedDate: r.joined_date,
      placed,
      offerId: placed ? r.offer_id : null,
      offerTitle: r.offer_title,
      clientName: r.client_name,
      benchDays: placed ? null : daysSince(benchSince),
      bio: r.bio,
      timezone: r.timezone,
      hoursPerWeek: r.hours_per_week,
      availableFrom: r.available_from,
      skills: (skillMap.get(r.id) || []).map((x) => x.name),
      languages: (langMap.get(r.id) || []).map((x) => x.name),
      preferredVerticalIds: (prefMap.get(r.id) || []).map((x) => x.vertical_id),
      hasPhoto: photoSet.has(r.id),
    };
  });
}

async function repById(db, ws, id) {
  const rows = await all(db, `${REP_SELECT} WHERE r.workspace_id = ? AND r.id = ? AND r.deleted_at IS NULL`, [ws, id]);
  if (!rows.length) throw notFound(`Rep ${id} not found`);
  return (await repPayload(db, ws, rows))[0];
}

async function listReps(request, env) {
  const { ws } = await ctxOf(request, env);
  const db = env.DB;
  const p = new URL(request.url).searchParams;
  const { where, binds } = repFilters(ws, p);
  const size = Math.min(200, num(p.get('size'), 25));
  const page = Math.max(0, num(p.get('page'), 0));
  const totalRow = await one(db, `SELECT COUNT(*) AS c FROM reps r WHERE ${where}`, binds);
  const rows = await all(
    db,
    `${REP_SELECT} WHERE ${where} ORDER BY r.name COLLATE NOCASE, r.id LIMIT ? OFFSET ?`,
    [...binds, size, page * size],
  );
  return json({ page, size, total: totalRow.c, items: await repPayload(db, ws, rows) });
}

async function exportReps(request, env) {
  const { ctx } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const p = new URL(request.url).searchParams;
  const { where, binds } = repFilters(ctx.workspaceId, p);
  const rows = await all(db, `${REP_SELECT} WHERE ${where} ORDER BY r.name COLLATE NOCASE, r.id`, binds);
  const body = [
    ['name', 'email', 'discord', 'vertical', 'status', 'experience', 'notes', 'joined'],
    ...rows.map((r) => [
      r.name, r.email, r.discord_user_id, r.vertical_name, r.status_name,
      r.experience_level_name, r.notes, r.joined_date,
    ]),
  ];
  return csvResponse(csv(body), 'roster.csv');
}

function assertLookup(db, ws, table, id, label) {
  if (id == null) return Promise.resolve(null);
  return one(db, `SELECT id FROM ${table} WHERE workspace_id = ? AND id = ?`, [ws, id]).then((row) => {
    if (!row) throw badRequest(`${label} ${id} does not exist in this workspace`);
    return row;
  });
}

/** Replace (or on create, insert) the rep's skill/language/preferred sets. */
async function applyRepCollections(db, ws, repId, body, isCreate) {
  const { skills, languages, preferredVerticalIds } = body;
  if (!isCreate) {
    if (Array.isArray(skills)) await exec(db, 'DELETE FROM rep_skills WHERE workspace_id = ? AND rep_id = ?', [ws, repId]);
    if (Array.isArray(languages)) await exec(db, 'DELETE FROM rep_languages WHERE workspace_id = ? AND rep_id = ?', [ws, repId]);
    if (Array.isArray(preferredVerticalIds)) {
      await exec(db, 'DELETE FROM rep_preferred_verticals WHERE workspace_id = ? AND rep_id = ?', [ws, repId]);
    }
  }
  if (Array.isArray(skills)) {
    for (const raw of skills) {
      const name = trimmed(raw);
      if (!name) continue;
      const existing = await one(db, 'SELECT id FROM skill_tags WHERE workspace_id = ? AND lower(name) = lower(?)', [ws, name]);
      let tagId = existing ? existing.id : null;
      if (!tagId) {
        const res = await exec(db, 'INSERT INTO skill_tags (workspace_id, name) VALUES (?, ?)', [ws, name]);
        tagId = res.meta.last_row_id;
      }
      await exec(db, 'INSERT OR IGNORE INTO rep_skills (workspace_id, rep_id, tag_id) VALUES (?, ?, ?)', [ws, repId, tagId]);
    }
  }
  if (Array.isArray(languages)) {
    for (const raw of languages) {
      const name = trimmed(raw);
      if (!name) continue;
      await exec(db, 'INSERT OR IGNORE INTO rep_languages (workspace_id, rep_id, language) VALUES (?, ?, ?)', [ws, repId, name]);
    }
  }
  if (Array.isArray(preferredVerticalIds)) {
    for (const verticalId of preferredVerticalIds) {
      if (!num(verticalId)) continue;
      await assertLookup(db, ws, 'verticals', num(verticalId), 'Vertical');
      await exec(db, 'INSERT OR IGNORE INTO rep_preferred_verticals (workspace_id, rep_id, vertical_id) VALUES (?, ?, ?)', [ws, repId, num(verticalId)]);
    }
  }
}

async function writeRep(request, env, id = null) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const body = await readJson(request);
  const name = trimmed(body.name);
  if (!name) throw badRequest('Name is required');

  await assertLookup(db, ws, 'verticals', num(body.verticalId), 'Vertical');
  await assertLookup(db, ws, 'rep_statuses', num(body.statusId), 'Status');
  await assertLookup(db, ws, 'experience_levels', num(body.experienceLevelId), 'Experience level');
  if (body.hoursPerWeek != null) {
    const hours = num(body.hoursPerWeek);
    if (hours == null || hours < 0 || hours > 168) throw badRequest('hoursPerWeek must be between 0 and 168');
  }
  const joinedDate = dateOrNull(body.joinedDate);
  const availableFrom = dateOrNull(body.availableFrom);

  if (id == null) {
    const res = await exec(
      db,
      `INSERT INTO reps (workspace_id, name, email, discord_user_id, vertical_id, status_id,
                         experience_level_id, notes, joined_date, bio, timezone, hours_per_week, available_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ws, name, trimmed(body.email), trimmed(body.discordUserId), num(body.verticalId),
        num(body.statusId), num(body.experienceLevelId), trimmed(body.notes),
        joinedDate || new Date().toISOString().slice(0, 10), trimmed(body.bio),
        trimmed(body.timezone), body.hoursPerWeek == null ? null : num(body.hoursPerWeek), availableFrom],
    );
    const newId = res.meta.last_row_id;
    await applyRepCollections(db, ws, newId, body, true);
    await audit(db, ws, userId, 'CREATE', 'rep', newId, { name });
    return json(await repById(db, ws, newId), 201);
  }

  const existing = await one(db, 'SELECT id FROM reps WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL', [ws, id]);
  if (!existing) throw notFound(`Rep ${id} not found`);
  await exec(
    db,
    `UPDATE reps SET name = ?, email = ?, discord_user_id = ?, vertical_id = ?, status_id = ?,
                     experience_level_id = ?, notes = ?, joined_date = ?, bio = ?, timezone = ?,
                     hours_per_week = ?, available_from = ?, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND id = ?`,
    [name, trimmed(body.email), trimmed(body.discordUserId), num(body.verticalId),
      num(body.statusId), num(body.experienceLevelId), trimmed(body.notes),
      joinedDate, trimmed(body.bio), trimmed(body.timezone),
      body.hoursPerWeek == null ? null : num(body.hoursPerWeek), availableFrom, ws, id],
  );
  await applyRepCollections(db, ws, id, body, false);
  await audit(db, ws, userId, 'UPDATE', 'rep', id, { name });
  return json(await repById(db, ws, id));
}

async function deleteRep(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const rep = await one(db, 'SELECT id FROM reps WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL', [ws, id]);
  if (!rep) throw notFound(`Rep ${id} not found`);
  const active = await one(
    db,
    "SELECT id FROM placements WHERE workspace_id = ? AND rep_id = ? AND status = 'active'",
    [ws, id],
  );
  // A live placement would outlive the soft-deleted rep and keep its seat
  // occupied by someone invisible — unplace first (same rule as Spring).
  if (active) throw conflict('End the active placement before deleting this rep');
  await exec(db, 'UPDATE reps SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?', [ws, id]);
  await audit(db, ws, userId, 'DELETE', 'rep', id, null);
  return noContent();
}

async function getRepPhoto(request, env, id) {
  const { ws } = await ctxOf(request, env);
  const row = await one(env.DB, 'SELECT content_type, data FROM rep_photos WHERE workspace_id = ? AND rep_id = ?', [ws, id]);
  if (!row) throw notFound('No photo for this rep');
  return new Response(row.data, {
    headers: {
      'content-type': row.content_type,
      'cache-control': 'private, max-age=300',
      'content-length': String(row.data.byteLength ?? row.data.length ?? 0),
    },
  });
}

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

async function uploadRepPhoto(request, env, id) {
  const { ctx, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const rep = await one(db, 'SELECT id FROM reps WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL', [ws, id]);
  if (!rep) throw notFound(`Rep ${id} not found`);

  let file;
  try {
    const form = await request.formData();
    file = form.get('file');
  } catch {
    throw badRequest('Expected a multipart form with a "file" part');
  }
  if (!file || typeof file.arrayBuffer !== 'function') throw badRequest('Photo file is missing');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) throw badRequest('Photo file is empty');
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw badRequest(`Photo must be 2 MB or smaller (got ${bytes.length} bytes)`);
  }
  const contentType = String(file.type || '').toLowerCase();
  if (!PHOTO_TYPES.includes(contentType)) throw badRequest('Photo must be PNG, JPEG, WebP or GIF');

  await exec(
    db,
    `INSERT INTO rep_photos (workspace_id, rep_id, content_type, size_bytes, data)
          VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, rep_id)
       DO UPDATE SET content_type = excluded.content_type, size_bytes = excluded.size_bytes,
                     data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
    [ws, id, contentType, bytes.length, bytes],
  );
  return json({ photoUrl: `/api/reps/${id}/photo`, contentType, sizeBytes: bytes.length }, 201);
}

// ------------------------------------------------------------------- clients

async function listClients(request, env) {
  const { ws } = await ctxOf(request, env);
  const rows = await all(
    env.DB,
    'SELECT id, name, contact_email, notes FROM clients WHERE workspace_id = ? ORDER BY name COLLATE NOCASE, id',
    [ws],
  );
  return json(rows.map((r) => ({ id: r.id, name: r.name, contactEmail: r.contact_email, notes: r.notes })));
}

async function writeClient(request, env, id = null) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const body = await readJson(request);
  const name = trimmed(body.name);
  if (!name) throw badRequest('Client name is required');
  const contactEmail = trimmed(body.contactEmail);
  const notes = trimmed(body.notes);

  if (id == null) {
    const res = await exec(
      env.DB,
      'INSERT INTO clients (workspace_id, name, contact_email, notes) VALUES (?, ?, ?, ?)',
      [ws, name, contactEmail, notes],
    );
    const newId = res.meta.last_row_id;
    await audit(env.DB, ws, userId, 'CREATE', 'client', newId, { name });
    return json({ id: newId, name, contactEmail, notes }, 201);
  }
  const existing = await one(env.DB, 'SELECT id FROM clients WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!existing) throw notFound(`Client ${id} not found`);
  await exec(
    env.DB,
    'UPDATE clients SET name = ?, contact_email = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?',
    [name, contactEmail, notes, ws, id],
  );
  await audit(env.DB, ws, userId, 'UPDATE', 'client', id, { name });
  return json({ id, name, contactEmail, notes });
}

async function deleteClient(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const existing = await one(env.DB, 'SELECT id FROM clients WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!existing) throw notFound(`Client ${id} not found`);
  const used = await one(env.DB, 'SELECT id FROM offers WHERE workspace_id = ? AND client_id = ?', [ws, id]);
  if (used) throw conflict('Client has offers; delete those first');
  await exec(env.DB, 'DELETE FROM clients WHERE workspace_id = ? AND id = ?', [ws, id]);
  await audit(env.DB, ws, userId, 'DELETE', 'client', id, null);
  return noContent();
}

// -------------------------------------------------------------------- offers

const OFFER_SELECT = `
  SELECT o.id, o.client_id, c.name AS client_name, o.vertical_id, v.name AS vertical_name,
         o.title, o.seats, o.notes, o.opens_at, o.closes_at, o.status,
         o.required_level_id, el.name AS required_level_name, o.required_language,
         o.tz_window_start, o.tz_window_end, o.start_date, o.stage_id, st.name AS stage_name,
         (SELECT COUNT(*) FROM placements pl
           WHERE pl.workspace_id = o.workspace_id AND pl.offer_id = o.id AND pl.status = 'active') AS filled
    FROM offers o
    LEFT JOIN clients c ON c.workspace_id = o.workspace_id AND c.id = o.client_id
    LEFT JOIN verticals v ON v.workspace_id = o.workspace_id AND v.id = o.vertical_id
    LEFT JOIN experience_levels el ON el.workspace_id = o.workspace_id AND el.id = o.required_level_id
    LEFT JOIN pipeline_stages st ON st.workspace_id = o.workspace_id AND st.id = o.stage_id`;

async function offerPayload(db, ws, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => '?').join(',');
  const [placed, requiredSkills] = await Promise.all([
    all(
      db,
      `SELECT pl.offer_id, pl.rep_id, r.name AS rep_name
         FROM placements pl
         JOIN reps r ON r.workspace_id = pl.workspace_id AND r.id = pl.rep_id
        WHERE pl.workspace_id = ? AND pl.status = 'active' AND pl.offer_id IN (${ph})
        ORDER BY r.name COLLATE NOCASE`,
      [ws, ...ids],
    ),
    all(
      db,
      `SELECT os.offer_id, t.name AS name
         FROM offer_required_skills os
         JOIN skill_tags t ON t.workspace_id = os.workspace_id AND t.id = os.tag_id
        WHERE os.workspace_id = ? AND os.offer_id IN (${ph})
        ORDER BY t.name`,
      [ws, ...ids],
    ),
  ]);
  const repsByOffer = new Map();
  for (const row of placed) {
    if (!repsByOffer.has(row.offer_id)) repsByOffer.set(row.offer_id, []);
    repsByOffer.get(row.offer_id).push({ repId: row.rep_id, repName: row.rep_name });
  }
  const skillsByOffer = new Map();
  for (const row of requiredSkills) {
    if (!skillsByOffer.has(row.offer_id)) skillsByOffer.set(row.offer_id, []);
    skillsByOffer.get(row.offer_id).push(row.name);
  }
  return rows.map((o) => {
    const closed = o.status === 'closed';
    return {
      id: o.id,
      clientId: o.client_id,
      clientName: o.client_name,
      verticalId: o.vertical_id,
      verticalName: o.vertical_name,
      title: o.title,
      seats: o.seats,
      filledSeats: o.filled,
      notes: o.notes,
      opensAt: iso(o.opens_at),
      closesAt: iso(o.closes_at),
      status: closed ? 'CLOSED' : 'OPEN',
      effectiveStatus: closed ? 'CLOSED' : o.filled >= o.seats ? 'FILLED' : 'OPEN',
      reps: repsByOffer.get(o.id) || [],
      requiredLevelId: o.required_level_id,
      requiredLevelName: o.required_level_name,
      requiredLanguage: o.required_language,
      tzWindowStart: o.tz_window_start,
      tzWindowEnd: o.tz_window_end,
      startDate: o.start_date,
      requiredSkills: skillsByOffer.get(o.id) || [],
      stageId: o.stage_id,
      stageName: o.stage_name,
    };
  });
}

async function offerById(db, ws, id) {
  const rows = await all(db, `${OFFER_SELECT} WHERE o.workspace_id = ? AND o.id = ?`, [ws, id]);
  if (!rows.length) throw notFound(`Offer ${id} not found`);
  return (await offerPayload(db, ws, rows))[0];
}

async function listOffers(request, env) {
  const { ws } = await ctxOf(request, env);
  const db = env.DB;
  const p = new URL(request.url).searchParams;
  const where = ['o.workspace_id = ?'];
  const binds = [ws];
  const q = trimmed(p.get('q'));
  if (q) {
    where.push("(o.title LIKE ? OR IFNULL(c.name, '') LIKE ?)");
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (num(p.get('verticalId'))) {
    where.push('o.vertical_id = ?');
    binds.push(num(p.get('verticalId')));
  }
  const rows = await all(db, `${OFFER_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.id DESC`, binds);
  const items = await offerPayload(db, ws, rows);
  const status = trimmed(p.get('effectiveStatus'));
  return json(status ? items.filter((o) => o.effectiveStatus === status) : items);
}

async function writeOffer(request, env, id = null) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const body = await readJson(request);
  const title = trimmed(body.title);
  const clientId = num(body.clientId);
  const seats = num(body.seats, 1);
  if (!title) throw badRequest('Title is required');
  if (!clientId) throw badRequest('clientId is required');
  if (seats == null || seats < 1) throw badRequest('seats must be at least 1');
  if ((body.tzWindowStart == null) !== (body.tzWindowEnd == null)) {
    throw badRequest('tzWindowStart and tzWindowEnd must be provided together');
  }
  for (const key of ['tzWindowStart', 'tzWindowEnd']) {
    if (body[key] != null) {
      const v = num(body[key]);
      if (v == null || v < 0 || v > 1439) throw badRequest(`${key} must be minutes from UTC, 0–1439`);
    }
  }
  const client = await one(db, 'SELECT id FROM clients WHERE workspace_id = ? AND id = ?', [ws, clientId]);
  if (!client) throw badRequest('Client does not exist in this workspace');
  await assertLookup(db, ws, 'verticals', num(body.verticalId), 'Vertical');
  await assertLookup(db, ws, 'experience_levels', num(body.requiredLevelId), 'Required level');

  const values = [
    clientId, num(body.verticalId), title, seats, trimmed(body.notes),
    dateOrNull(body.opensAt), dateOrNull(body.closesAt),
    num(body.requiredLevelId), trimmed(body.requiredLanguage),
    body.tzWindowStart == null ? null : num(body.tzWindowStart),
    body.tzWindowEnd == null ? null : num(body.tzWindowEnd),
    dateOrNull(body.startDate),
  ];

  if (id == null) {
    const res = await exec(
      db,
      `INSERT INTO offers (workspace_id, client_id, vertical_id, title, seats, notes, opens_at, closes_at,
                           required_level_id, required_language, tz_window_start, tz_window_end, start_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ws, ...values],
    );
    const newId = res.meta.last_row_id;
    await applyOfferSkills(db, ws, newId, body.requiredSkills);
    await audit(db, ws, userId, 'CREATE', 'offer', newId, { title });
    return json(await offerById(db, ws, newId), 201);
  }

  const existing = await one(db, 'SELECT id FROM offers WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!existing) throw notFound(`Offer ${id} not found`);
  await exec(
    db,
    `UPDATE offers SET client_id = ?, vertical_id = ?, title = ?, seats = ?, notes = ?, opens_at = ?,
                       closes_at = ?, required_level_id = ?, required_language = ?, tz_window_start = ?,
                       tz_window_end = ?, start_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND id = ?`,
    [...values, ws, id],
  );
  if (Array.isArray(body.requiredSkills)) await applyOfferSkills(db, ws, id, body.requiredSkills);
  await audit(db, ws, userId, 'UPDATE', 'offer', id, { title });
  return json(await offerById(db, ws, id));
}

async function applyOfferSkills(db, ws, offerId, skills) {
  if (!Array.isArray(skills)) return;
  await exec(db, 'DELETE FROM offer_required_skills WHERE workspace_id = ? AND offer_id = ?', [ws, offerId]);
  for (const raw of skills) {
    const name = trimmed(raw);
    if (!name) continue;
    const existing = await one(db, 'SELECT id FROM skill_tags WHERE workspace_id = ? AND lower(name) = lower(?)', [ws, name]);
    let tagId = existing ? existing.id : null;
    if (!tagId) {
      const res = await exec(db, 'INSERT INTO skill_tags (workspace_id, name) VALUES (?, ?)', [ws, name]);
      tagId = res.meta.last_row_id;
    }
    await exec(db, 'INSERT OR IGNORE INTO offer_required_skills (workspace_id, offer_id, tag_id) VALUES (?, ?, ?)', [ws, offerId, tagId]);
  }
}

async function closeOffer(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const existing = await one(env.DB, 'SELECT id, status FROM offers WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!existing) throw notFound(`Offer ${id} not found`);
  await exec(env.DB, "UPDATE offers SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?", [ws, id]);
  await audit(env.DB, ws, userId, 'UPDATE', 'offer', id, { status: 'closed' });
  return json(await offerById(env.DB, ws, id));
}

async function moveOfferToStage(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const body = await readJson(request);
  const stageId = num(body.stageId);
  if (!stageId) throw badRequest('stageId is required');
  const offer = await one(env.DB, 'SELECT id FROM offers WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!offer) throw notFound(`Offer ${id} not found`);
  const stage = await one(env.DB, 'SELECT id FROM pipeline_stages WHERE workspace_id = ? AND id = ?', [ws, stageId]);
  if (!stage) throw badRequest('Stage does not exist in this workspace');
  await exec(env.DB, 'UPDATE offers SET stage_id = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?', [stageId, ws, id]);
  await audit(env.DB, ws, userId, 'UPDATE', 'offer', id, { stageId });
  return json(await offerById(env.DB, ws, id));
}

/**
 * Match scoring for GET /offers/{id}/suggested: unplaced reps ranked by how
 * well they satisfy the offer's requirements. Each factor carries its weight
 * and a human "why" so the UI can render the breakdown; score is the points
 * earned out of the applicable weight, scaled to 100.
 */
async function suggestReps(request, env, offerId) {
  const { ws } = await ctxOf(request, env);
  const db = env.DB;
  const p = new URL(request.url).searchParams;
  const limit = Math.min(50, num(p.get('limit'), 10));
  const offers = await all(db, `${OFFER_SELECT} WHERE o.workspace_id = ? AND o.id = ?`, [ws, offerId]);
  if (!offers.length) throw notFound(`Offer ${offerId} not found`);
  const offer = offers[0];

  const requiredSkills = (await all(
    db,
    `SELECT t.name AS name FROM offer_required_skills os
       JOIN skill_tags t ON t.workspace_id = os.workspace_id AND t.id = os.tag_id
      WHERE os.workspace_id = ? AND os.offer_id = ?`,
    [ws, offerId],
  )).map((r) => r.name.toLowerCase());

  const candidates = await all(
    db,
    `${REP_SELECT}
      WHERE r.workspace_id = ? AND r.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM placements px
                         WHERE px.workspace_id = r.workspace_id AND px.rep_id = r.id AND px.status = 'active')
      ORDER BY r.name COLLATE NOCASE`,
    [ws],
  );
  const rows = await repPayload(db, ws, candidates);

  const results = rows.map((rep) => {
    const factors = [];

    // Vertical affinity (preferred verticals count as partial credit).
    const verticalWeight = offer.vertical_id ? 30 : 0;
    let verticalPoints = 0;
    let verticalDetail = 'No vertical requirement';
    if (offer.vertical_id) {
      const exact = rep.verticalId === offer.vertical_id;
      const preferred = (rep.preferredVerticalIds || []).includes(offer.vertical_id);
      verticalPoints = exact ? 30 : preferred ? 18 : 0;
      verticalDetail = exact
        ? `Works in ${offer.vertical_name}`
        : preferred
          ? `Listed ${offer.vertical_name} as preferred`
          : rep.verticalName
            ? `Main vertical is ${rep.verticalName}`
            : 'No vertical set';
    }
    factors.push({
      key: 'vertical', label: 'Vertical fit', weight: verticalWeight,
      points: verticalPoints, applicable: verticalWeight > 0, detail: verticalDetail,
    });

    // Experience level.
    const levelWeight = offer.required_level_id ? 25 : 0;
    let levelPoints = 0;
    let levelDetail = 'No level requirement';
    if (offer.required_level_id) {
      levelPoints = rep.experienceLevelId === offer.required_level_id ? 25 : 0;
      levelDetail = levelPoints
        ? `Matches ${offer.required_level_name}`
        : `Needs ${offer.required_level_name}, rep is ${rep.experienceLevelName || 'unset'}`;
    }
    factors.push({
      key: 'level', label: 'Experience level', weight: levelWeight,
      points: levelPoints, applicable: levelWeight > 0, detail: levelDetail,
    });

    // Skills: proportional coverage of the required skill set.
    const skillsWeight = requiredSkills.length ? 25 : 0;
    let skillsPoints = 0;
    let skillsDetail = 'No skills required';
    if (requiredSkills.length) {
      const have = new Set((rep.skills || []).map((s) => s.toLowerCase()));
      const hit = requiredSkills.filter((s) => have.has(s));
      skillsPoints = Math.round((hit.length / requiredSkills.length) * 25);
      skillsDetail = hit.length
        ? `${hit.length}/${requiredSkills.length} required skills`
        : `Has none of the ${requiredSkills.length} required skills`;
    }
    factors.push({
      key: 'skills', label: 'Skills', weight: skillsWeight,
      points: skillsPoints, applicable: skillsWeight > 0, detail: skillsDetail,
    });

    // Language.
    const languageWeight = offer.required_language ? 15 : 0;
    let languagePoints = 0;
    let languageDetail = 'No language requirement';
    if (offer.required_language) {
      const want = offer.required_language.toLowerCase();
      const speaks = (rep.languages || []).some((l) => String(l).toLowerCase() === want);
      languagePoints = speaks ? 15 : 0;
      languageDetail = speaks ? `Speaks ${offer.required_language}` : `Does not list ${offer.required_language}`;
    }
    factors.push({
      key: 'language', label: 'Language', weight: languageWeight,
      points: languagePoints, applicable: languageWeight > 0, detail: languageDetail,
    });

    // Availability window (start date + weekly hours).
    const startWeight = offer.start_date ? 10 : 0;
    let startPoints = 0;
    let startDetail = 'No start date set';
    if (offer.start_date) {
      const available = !rep.availableFrom || rep.availableFrom <= offer.start_date;
      startPoints = available ? 10 : 0;
      startDetail = available
        ? rep.availableFrom
          ? `Free from ${rep.availableFrom}`
          : 'Available now'
        : `Only available from ${rep.availableFrom}`;
    }
    factors.push({
      key: 'availability', label: 'Availability', weight: startWeight,
      points: startPoints, applicable: startWeight > 0, detail: startDetail,
    });

    const applicable = factors.filter((f) => f.applicable);
    const weight = applicable.reduce((s, f) => s + f.weight, 0);
    const points = applicable.reduce((s, f) => s + f.points, 0);
    const score = weight === 0 ? 50 : Math.round((points / weight) * 100);

    return {
      repId: rep.id,
      repName: rep.name,
      email: rep.email,
      verticalName: rep.verticalName,
      experienceLevelName: rep.experienceLevelName,
      statusName: rep.statusName,
      benchDays: rep.benchDays,
      hoursPerWeek: rep.hoursPerWeek,
      timezone: rep.timezone,
      score,
      factors,
    };
  });

  results.sort((a, b) => b.score - a.score || a.repName.localeCompare(b.repName));
  return json(results.slice(0, limit));
}

// ---------------------------------------------------------------- placements

const PLACEMENT_SELECT = `
  SELECT pl.id, pl.offer_id, o.title AS offer_title, pl.rep_id, r.name AS rep_name,
         pl.status, pl.placed_at, pl.ended_at, pl.end_reason
    FROM placements pl
    JOIN offers o ON o.workspace_id = pl.workspace_id AND o.id = pl.offer_id
    LEFT JOIN reps r ON r.workspace_id = pl.workspace_id AND r.id = pl.rep_id`;

const placementView = (row) => ({
  id: row.id,
  offerId: row.offer_id,
  offerTitle: row.offer_title,
  repId: row.rep_id,
  repName: row.rep_name,
  status: row.status === 'active' ? 'ACTIVE' : 'ENDED',
  placedAt: iso(row.placed_at),
  endedAt: iso(row.ended_at),
  endReason: row.end_reason,
});

async function listPlacements(request, env) {
  const { ws } = await ctxOf(request, env);
  const p = new URL(request.url).searchParams;
  const where = ['pl.workspace_id = ?'];
  const binds = [ws];
  if (num(p.get('offerId'))) {
    where.push('pl.offer_id = ?');
    binds.push(num(p.get('offerId')));
  }
  if (num(p.get('repId'))) {
    where.push('pl.rep_id = ?');
    binds.push(num(p.get('repId')));
  }
  const rows = await all(env.DB, `${PLACEMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY pl.placed_at DESC, pl.id DESC`, binds);
  return json(rows.map(placementView));
}

async function placeRep(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const body = await readJson(request);
  const offerId = num(body.offerId);
  const repId = num(body.repId);
  if (!offerId || !repId) throw badRequest('offerId and repId are required');

  const offer = await one(db, 'SELECT id, status, seats FROM offers WHERE workspace_id = ? AND id = ?', [ws, offerId]);
  if (!offer) throw notFound(`Offer ${offerId} not found`);
  if (offer.status !== 'open') throw conflict('Offer is closed');
  const filled = await one(db, "SELECT COUNT(*) AS c FROM placements WHERE workspace_id = ? AND offer_id = ? AND status = 'active'", [ws, offerId]);
  if (filled.c >= offer.seats) {
    throw conflict(`Offer is full (${filled.c}/${offer.seats} seats filled)`);
  }
  const rep = await one(db, 'SELECT id FROM reps WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL', [ws, repId]);
  if (!rep) throw notFound(`Rep ${repId} not found`);
  const already = await one(db, "SELECT id FROM placements WHERE workspace_id = ? AND rep_id = ? AND status = 'active'", [ws, repId]);
  if (already) throw conflict('Rep already has an active placement');

  const res = await exec(
    db,
    "INSERT INTO placements (workspace_id, offer_id, rep_id, status, placed_by) VALUES (?, ?, ?, 'active', ?)",
    [ws, offerId, repId, userId],
  );
  await audit(db, ws, userId, 'PLACE', 'placement', res.meta.last_row_id, { offerId, repId });
  const row = await one(db, `${PLACEMENT_SELECT} WHERE pl.workspace_id = ? AND pl.id = ?`, [ws, res.meta.last_row_id]);
  return json(placementView(row), 201);
}

async function endPlacement(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const body = await readJson(request).catch(() => ({}));
  const placement = await one(db, 'SELECT id, status FROM placements WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!placement) throw notFound(`Placement ${id} not found`);
  if (placement.status === 'ended') throw conflict('Placement already ended');
  const reason = trimmed(body.reason);
  await exec(
    db,
    "UPDATE placements SET status = 'ended', ended_at = CURRENT_TIMESTAMP, end_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?",
    [reason, ws, id],
  );
  await audit(db, ws, userId, 'UNPLACE', 'placement', id, reason ? { reason } : null);
  const row = await one(db, `${PLACEMENT_SELECT} WHERE pl.workspace_id = ? AND pl.id = ?`, [ws, id]);
  return json(placementView(row));
}

// ------------------------------------------------------------------ pipeline

async function listStages(request, env) {
  const { ws } = await ctxOf(request, env);
  return json(await all(env.DB, 'SELECT id, name, position FROM pipeline_stages WHERE workspace_id = ? ORDER BY position, id', [ws]));
}

async function board(request, env) {
  const { ws } = await ctxOf(request, env);
  const db = env.DB;
  const stages = await all(db, 'SELECT id, name, position FROM pipeline_stages WHERE workspace_id = ? ORDER BY position, id', [ws]);
  const offers = await offerPayload(db, ws, await all(db, `${OFFER_SELECT} WHERE o.workspace_id = ? ORDER BY o.id`, [ws]));
  const byStage = new Map();
  for (const o of offers) {
    const key = o.stageId ?? stages[0]?.id ?? -1;
    if (!byStage.has(key)) byStage.set(key, []);
    byStage.get(key).push(o);
  }
  return json(stages.map((s) => ({
    stage: { id: s.id, name: s.name, position: s.position },
    offers: byStage.get(s.id) || [],
  })));
}

async function createStage(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const body = await readJson(request);
  const name = trimmed(body.name);
  if (!name) throw badRequest('Name is required');
  if (name.length > 60) throw badRequest('Name must be 60 characters or fewer');
  const taken = await one(env.DB, 'SELECT id FROM pipeline_stages WHERE workspace_id = ? AND lower(name) = lower(?)', [ws, name]);
  if (taken) throw conflict('A stage with that name already exists');
  const max = await one(env.DB, 'SELECT IFNULL(MAX(position), 0) AS p FROM pipeline_stages WHERE workspace_id = ?', [ws]);
  const res = await exec(env.DB, 'INSERT INTO pipeline_stages (workspace_id, name, position) VALUES (?, ?, ?)', [ws, name, max.p + 1]);
  await audit(env.DB, ws, userId, 'CREATE', 'stage', res.meta.last_row_id, { name });
  return json({ id: res.meta.last_row_id, name, position: max.p + 1 }, 201);
}

async function renameStage(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const body = await readJson(request);
  const name = trimmed(body.name);
  if (!name) throw badRequest('Name is required');
  const existing = await one(env.DB, 'SELECT id, position FROM pipeline_stages WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!existing) throw notFound(`Stage ${id} not found`);
  await exec(env.DB, 'UPDATE pipeline_stages SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?', [name, ws, id]);
  await audit(env.DB, ws, userId, 'UPDATE', 'stage', id, { name });
  return json({ id, name, position: existing.position });
}

async function moveStage(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const body = await readJson(request);
  const direction = String(body.direction || '').toUpperCase();
  if (direction !== 'UP' && direction !== 'DOWN') throw badRequest('direction must be UP or DOWN');
  const db = env.DB;
  const stages = await all(db, 'SELECT id, name, position FROM pipeline_stages WHERE workspace_id = ? ORDER BY position, id', [ws]);
  const index = stages.findIndex((s) => s.id === id);
  if (index < 0) throw notFound(`Stage ${id} not found`);
  const other = direction === 'UP' ? index - 1 : index + 1;
  if (other >= 0 && other < stages.length) {
    const a = stages[index];
    const b = stages[other];
    await db.batch([
      db.prepare('UPDATE pipeline_stages SET position = ? WHERE workspace_id = ? AND id = ?').bind(b.position, ws, a.id),
      db.prepare('UPDATE pipeline_stages SET position = ? WHERE workspace_id = ? AND id = ?').bind(a.position, ws, b.id),
    ]);
    await audit(db, ws, userId, 'UPDATE', 'stage', id, { direction });
  }
  return json(await all(db, 'SELECT id, name, position FROM pipeline_stages WHERE workspace_id = ? ORDER BY position, id', [ws]));
}

async function deleteStage(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const db = env.DB;
  const existing = await one(db, 'SELECT id FROM pipeline_stages WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!existing) throw notFound(`Stage ${id} not found`);
  const used = await one(db, 'SELECT COUNT(*) AS c FROM offers WHERE workspace_id = ? AND stage_id = ?', [ws, id]);
  if (used.c > 0) throw conflict('Move its offers to another stage first');
  const count = await one(db, 'SELECT COUNT(*) AS c FROM pipeline_stages WHERE workspace_id = ?', [ws]);
  if (count.c <= 1) throw conflict('A workspace needs at least one stage');
  await exec(db, 'DELETE FROM pipeline_stages WHERE workspace_id = ? AND id = ?', [ws, id]);
  await audit(db, ws, userId, 'DELETE', 'stage', id, null);
  return noContent();
}

// ------------------------------------------------------------------ lookups

const LOOKUP_TABLES = {
  verticals: { name: 'verticals', label: 'Vertical', refs: ['reps.vertical_id', 'offers.vertical_id', 'rep_preferred_verticals.vertical_id'] },
  statuses: { name: 'rep_statuses', label: 'Status', refs: ['reps.status_id'] },
  'experience-levels': { name: 'experience_levels', label: 'Experience level', refs: ['reps.experience_level_id', 'offers.required_level_id'] },
};

function lookupView(table, row) {
  return table === 'rep_statuses'
    ? { id: row.id, name: row.name, kind: String(row.kind).toUpperCase() }
    : { id: row.id, name: row.name };
}

async function writeLookup(request, env, key, id = null) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const spec = LOOKUP_TABLES[key];
  const body = await readJson(request);
  const name = trimmed(body.name);
  if (!name) throw badRequest('Name is required');

  let kind = null;
  if (spec.name === 'rep_statuses') {
    kind = String(body.kind || '').toLowerCase();
    if (!['bench', 'training', 'inactive'].includes(kind)) {
      throw badRequest('kind must be BENCH, TRAINING or INACTIVE');
    }
  }

  if (id == null) {
    const taken = await one(db, `SELECT id FROM ${spec.name} WHERE workspace_id = ? AND lower(name) = lower(?)`, [ws, name]);
    if (taken) throw conflict(`${spec.label} "${name}" already exists`);
    const res = spec.name === 'rep_statuses'
      ? await exec(db, `INSERT INTO ${spec.name} (workspace_id, name, kind) VALUES (?, ?, ?)`, [ws, name, kind])
      : await exec(db, `INSERT INTO ${spec.name} (workspace_id, name) VALUES (?, ?)`, [ws, name]);
    await audit(db, ws, userId, 'CREATE', spec.name, res.meta.last_row_id, { name });
    const row = await one(db, `SELECT * FROM ${spec.name} WHERE workspace_id = ? AND id = ?`, [ws, res.meta.last_row_id]);
    return json(lookupView(spec.name, row), 201);
  }

  const existing = await one(db, `SELECT id FROM ${spec.name} WHERE workspace_id = ? AND id = ?`, [ws, id]);
  if (!existing) throw notFound(`${spec.label} ${id} not found`);
  if (spec.name === 'rep_statuses') {
    await exec(db, `UPDATE ${spec.name} SET name = ?, kind = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`, [name, kind, ws, id]);
  } else {
    await exec(db, `UPDATE ${spec.name} SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`, [name, ws, id]);
  }
  await audit(db, ws, userId, 'UPDATE', spec.name, id, { name });
  const row = await one(db, `SELECT * FROM ${spec.name} WHERE workspace_id = ? AND id = ?`, [ws, id]);
  return json(lookupView(spec.name, row));
}

async function deleteLookup(request, env, key, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const spec = LOOKUP_TABLES[key];
  const existing = await one(db, `SELECT id FROM ${spec.name} WHERE workspace_id = ? AND id = ?`, [ws, id]);
  if (!existing) throw notFound(`${spec.label} ${id} not found`);

  // Foreign keys are not enforced at runtime in D1, so refuse in-use values
  // explicitly rather than orphaning rows.
  for (const ref of spec.refs) {
    const [table, column] = ref.split('.');
    const used = await one(db, `SELECT COUNT(*) AS c FROM ${table} WHERE workspace_id = ? AND ${column} = ?`, [ws, id]);
    if (used.c > 0) throw conflict(`${spec.label} is in use by ${used.c} record(s); reassign them first`);
  }
  await exec(db, `DELETE FROM ${spec.name} WHERE workspace_id = ? AND id = ?`, [ws, id]);
  await audit(db, ws, userId, 'DELETE', spec.name, id, null);
  return noContent();
}

async function listSkills(request, env) {
  const { ws } = await ctxOf(request, env);
  const rows = await all(env.DB, 'SELECT id, name FROM skill_tags WHERE workspace_id = ? ORDER BY name COLLATE NOCASE', [ws]);
  return json(rows);
}

async function listLanguages(request, env) {
  const { ws } = await ctxOf(request, env);
  const rows = await all(env.DB, 'SELECT DISTINCT language FROM rep_languages WHERE workspace_id = ? ORDER BY language', [ws]);
  return json(rows.map((r) => r.language));
}

// ------------------------------------------------------------------ reports

async function reports(request, env) {
  const { ctx, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;

  const totalReps = (await one(db, 'SELECT COUNT(*) AS c FROM reps WHERE workspace_id = ? AND deleted_at IS NULL', [ws])).c;
  const placedReps = (await one(
    db,
    "SELECT COUNT(DISTINCT rep_id) AS c FROM placements WHERE workspace_id = ? AND status = 'active'",
    [ws],
  )).c;

  // Bench samples: unplaced reps, days since last ended placement (else joined
  // date) — computed the same way the roster's benchDays column is.
  const benchRows = await all(
    db,
    `SELECT r.id, r.joined_date, r.created_at,
            (SELECT MAX(pl.ended_at) FROM placements pl
              WHERE pl.workspace_id = r.workspace_id AND pl.rep_id = r.id AND pl.status = 'ended') AS last_ended
       FROM reps r
      WHERE r.workspace_id = ? AND r.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM placements px
                         WHERE px.workspace_id = r.workspace_id AND px.rep_id = r.id AND px.status = 'active')`,
    [ws],
  );
  const benchValues = benchRows
    .map((r) => daysSince(r.last_ended || r.joined_date || r.created_at))
    .filter((v) => v != null);
  const averageBenchDays = benchValues.length
    ? Math.round((benchValues.reduce((a, b) => a + b, 0) / benchValues.length) * 10) / 10
    : null;

  const placementRows = await all(
    db,
    `SELECT o.id, o.title, c.name AS client_name,
            (SELECT COUNT(*) FROM placements p WHERE p.workspace_id = o.workspace_id AND p.offer_id = o.id) AS total_placements,
            (SELECT COUNT(*) FROM placements p WHERE p.workspace_id = o.workspace_id AND p.offer_id = o.id AND p.status = 'active') AS active_placements
       FROM offers o
       LEFT JOIN clients c ON c.workspace_id = o.workspace_id AND c.id = o.client_id
      WHERE o.workspace_id = ?
      ORDER BY o.id`,
    [ws],
  );

  const verticalRows = await all(
    db,
    `SELECT v.id, v.name,
            COUNT(r.id) AS reps,
            (SELECT COUNT(*) FROM reps r2
              WHERE r2.workspace_id = v.workspace_id AND r2.vertical_id = v.id AND r2.deleted_at IS NULL
                AND EXISTS (SELECT 1 FROM placements px
                             WHERE px.workspace_id = r2.workspace_id AND px.rep_id = r2.id AND px.status = 'active')) AS placed_reps
       FROM verticals v
       LEFT JOIN reps r ON r.workspace_id = v.workspace_id AND r.vertical_id = v.id AND r.deleted_at IS NULL
      WHERE v.workspace_id = ?
      GROUP BY v.id
      ORDER BY v.name COLLATE NOCASE`,
    [ws],
  );
  const unassigned = (await one(
    db,
    `SELECT COUNT(*) AS c FROM reps r
      WHERE r.workspace_id = ? AND r.deleted_at IS NULL AND r.vertical_id IS NULL
        AND EXISTS (SELECT 1 FROM placements px
                     WHERE px.workspace_id = r.workspace_id AND px.rep_id = r.id AND px.status = 'active')`,
    [ws],
  )).c;
  const unassignedTotal = (await one(
    db,
    'SELECT COUNT(*) AS c FROM reps WHERE workspace_id = ? AND deleted_at IS NULL AND vertical_id IS NULL',
    [ws],
  )).c;

  const verticals = verticalRows.map((v) => ({
    verticalId: v.id,
    name: v.name,
    reps: v.reps,
    placedReps: v.placed_reps,
  }));
  if (unassignedTotal > 0) {
    verticals.push({ verticalId: null, name: 'Unassigned', reps: unassignedTotal, placedReps: unassigned });
  }

  return json({
    placementRate: {
      placedReps,
      totalReps,
      rate: totalReps ? Math.round((placedReps / totalReps) * 1000) / 10 : 0,
    },
    averageBenchDays,
    benchSamples: benchValues.length,
    placementsPerOffer: placementRows.map((o) => ({
      offerId: o.id,
      title: o.title,
      clientName: o.client_name,
      totalPlacements: o.total_placements,
      activePlacements: o.active_placements,
    })),
    verticals,
  });
}

// -------------------------------------------------------------------- audit

async function auditFeed(request, env) {
  const { ws } = await ctxOf(request, env);
  const p = new URL(request.url).searchParams;
  const size = Math.min(100, num(p.get('size'), 25));
  const page = Math.max(0, num(p.get('page'), 0));
  const total = (await one(env.DB, 'SELECT COUNT(*) AS c FROM audit_log WHERE workspace_id = ?', [ws])).c;
  const rows = await all(
    env.DB,
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.actor_user_id, a.details, a.created_at,
            u.display_name AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.workspace_id = ?
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?`,
    [ws, size, page * size],
  );
  return json({
    page,
    size,
    total,
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      actorUserId: r.actor_user_id,
      actorName: r.actor_name,
      details: r.details,
      createdAt: iso(r.created_at),
    })),
  });
}

// ------------------------------------------------- performance (activity, …)

async function listMetricTypes(request, env) {
  const { ws } = await ctxOf(request, env);
  return json(await all(env.DB, 'SELECT id, name, unit FROM metric_types WHERE workspace_id = ? ORDER BY id', [ws]));
}

async function writeMetricType(request, env, id = null) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const body = await readJson(request);
  const name = trimmed(body.name);
  const unit = String(body.unit || '').toLowerCase();
  if (!name) throw badRequest('Name is required');
  if (!['count', 'currency'].includes(unit)) throw badRequest('unit must be count or currency');

  if (id == null) {
    const taken = await one(db, 'SELECT id FROM metric_types WHERE workspace_id = ? AND lower(name) = lower(?)', [ws, name]);
    if (taken) throw conflict('A metric with that name already exists');
    const res = await exec(db, 'INSERT INTO metric_types (workspace_id, name, unit) VALUES (?, ?, ?)', [ws, name, unit]);
    await audit(db, ws, userId, 'CREATE', 'metric_type', res.meta.last_row_id, { name });
    return json({ id: res.meta.last_row_id, name, unit }, 201);
  }
  const existing = await one(db, 'SELECT id FROM metric_types WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!existing) throw notFound(`Metric type ${id} not found`);
  await exec(db, 'UPDATE metric_types SET name = ?, unit = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?', [name, unit, ws, id]);
  await audit(db, ws, userId, 'UPDATE', 'metric_type', id, { name });
  return json({ id, name, unit });
}

async function deleteMetricType(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const existing = await one(db, 'SELECT id FROM metric_types WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!existing) throw notFound(`Metric type ${id} not found`);
  const used = await one(db, 'SELECT COUNT(*) AS c FROM activity_entries WHERE workspace_id = ? AND metric_type_id = ?', [ws, id]);
  if (used.c > 0) throw conflict('Metric has logged activity; delete that first');
  await exec(db, 'DELETE FROM metric_types WHERE workspace_id = ? AND id = ?', [ws, id]);
  await audit(db, ws, userId, 'DELETE', 'metric_type', id, null);
  return noContent();
}

const ACTIVITY_SELECT = `
  SELECT a.id, a.placement_id, a.rep_id, r.name AS rep_name, o.id AS offer_id, o.title AS offer_title,
         a.metric_type_id, m.name AS metric_name, m.unit AS metric_unit,
         a.occurred_on, a.value_minor, a.notes, a.logged_by, a.created_at, a.updated_at
    FROM activity_entries a
    JOIN placements pl ON pl.workspace_id = a.workspace_id AND pl.id = a.placement_id
    JOIN offers o ON o.workspace_id = a.workspace_id AND o.id = pl.offer_id
    LEFT JOIN reps r ON r.workspace_id = a.workspace_id AND r.id = a.rep_id
    LEFT JOIN metric_types m ON m.workspace_id = a.workspace_id AND m.id = a.metric_type_id`;

const activityView = (row, privileged, userId) => ({
  id: row.id,
  placementId: row.placement_id,
  repId: row.rep_id,
  repName: row.rep_name,
  offerId: row.offer_id,
  offerTitle: row.offer_title,
  metricTypeId: row.metric_type_id,
  metricName: row.metric_name,
  metricUnit: row.metric_unit,
  occurredOn: row.occurred_on,
  valueMinor: row.value_minor,
  notes: row.notes,
  loggedBy: row.logged_by,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
  canEdit: privileged || (row.logged_by != null && row.logged_by === userId),
});

async function activityMeta(request, env) {
  const { ws } = await ctxOf(request, env);
  const rows = await all(
    env.DB,
    `SELECT pl.id AS placement_id, o.id AS offer_id, o.title AS offer_title, pl.rep_id, r.name AS rep_name
       FROM placements pl
       JOIN offers o ON o.workspace_id = pl.workspace_id AND o.id = pl.offer_id
       LEFT JOIN reps r ON r.workspace_id = pl.workspace_id AND r.id = pl.rep_id
      WHERE pl.workspace_id = ? AND pl.status = 'active'
      ORDER BY r.name COLLATE NOCASE`,
    [ws],
  );
  return json(rows.map((r) => ({
    placementId: r.placement_id,
    offerId: r.offer_id,
    offerTitle: r.offer_title,
    repId: r.rep_id,
    repName: r.rep_name,
  })));
}

async function listActivity(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  const privileged = ctx.role === 'admin' || ctx.role === 'owner';
  const p = new URL(request.url).searchParams;
  const where = ['a.workspace_id = ?'];
  const binds = [ws];
  if (num(p.get('placementId'))) {
    where.push('a.placement_id = ?');
    binds.push(num(p.get('placementId')));
  }
  if (num(p.get('repId'))) {
    where.push('a.rep_id = ?');
    binds.push(num(p.get('repId')));
  }
  if (num(p.get('metricTypeId'))) {
    where.push('a.metric_type_id = ?');
    binds.push(num(p.get('metricTypeId')));
  }
  if (p.get('from')) {
    where.push('a.occurred_on >= ?');
    binds.push(p.get('from'));
  }
  if (p.get('to')) {
    where.push('a.occurred_on <= ?');
    binds.push(p.get('to'));
  }
  const size = Math.min(200, num(p.get('size'), 25));
  const page = Math.max(0, num(p.get('page'), 0));
  const total = (await one(env.DB, `SELECT COUNT(*) AS c FROM activity_entries a WHERE ${where.join(' AND ')}`, binds)).c;
  const rows = await all(
    env.DB,
    `${ACTIVITY_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.occurred_on DESC, a.id DESC LIMIT ? OFFSET ?`,
    [...binds, size, page * size],
  );
  return json({ page, size, total, items: rows.map((r) => activityView(r, privileged, userId)) });
}

async function activityById(db, ws, id) {
  const rows = await all(db, `${ACTIVITY_SELECT} WHERE a.workspace_id = ? AND a.id = ?`, [ws, id]);
  if (!rows.length) throw notFound(`Activity ${id} not found`);
  return rows[0];
}

async function createActivity(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const body = await readJson(request);
  const placementId = num(body.placementId);
  const metricTypeId = num(body.metricTypeId);
  const valueMinor = num(body.valueMinor);
  const occurredOn = dateOrNull(body.occurredOn);
  if (!placementId) throw badRequest('placementId is required');
  if (!metricTypeId) throw badRequest('metricTypeId is required');
  if (valueMinor == null || valueMinor < 0) throw badRequest('valueMinor must be zero or more');
  if (!occurredOn) throw badRequest('occurredOn is required');

  const placement = await one(db, "SELECT id, rep_id FROM placements WHERE workspace_id = ? AND id = ? AND status = 'active'", [ws, placementId]);
  if (!placement) throw badRequest('Placement does not exist or is not active');
  const metric = await one(db, 'SELECT id FROM metric_types WHERE workspace_id = ? AND id = ?', [ws, metricTypeId]);
  if (!metric) throw badRequest('Metric type does not exist in this workspace');

  const res = await exec(
    db,
    `INSERT INTO activity_entries (workspace_id, placement_id, rep_id, metric_type_id, occurred_on, value_minor, notes, logged_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [ws, placementId, placement.rep_id, metricTypeId, occurredOn, valueMinor, trimmed(body.notes), userId],
  );
  await audit(db, ws, userId, 'CREATE', 'activity', res.meta.last_row_id, { metricTypeId, valueMinor });
  const row = await activityById(db, ws, res.meta.last_row_id);
  return json(activityView(row, ctx.role === 'admin' || ctx.role === 'owner', userId), 201);
}

async function updateActivity(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const row = await activityById(db, ws, id);
  const privileged = ctx.role === 'admin' || ctx.role === 'owner';
  // Editing someone else's entry is a manager decision; the logger may edit
  // their own.
  if (!privileged && row.logged_by !== userId) throw forbiddenEdit();
  const body = await readJson(request);
  const occurredOn = body.occurredOn != null ? dateOrNull(body.occurredOn) : row.occurred_on;
  const valueMinor = body.valueMinor != null ? num(body.valueMinor) : row.value_minor;
  const notes = body.notes !== undefined ? trimmed(body.notes) : row.notes;
  const metricTypeId = body.metricTypeId != null ? num(body.metricTypeId) : row.metric_type_id;
  if (valueMinor == null || valueMinor < 0) throw badRequest('valueMinor must be zero or more');
  if (metricTypeId !== row.metric_type_id) {
    const metric = await one(db, 'SELECT id FROM metric_types WHERE workspace_id = ? AND id = ?', [ws, metricTypeId]);
    if (!metric) throw badRequest('Metric type does not exist in this workspace');
  }
  await exec(
    db,
    `UPDATE activity_entries SET occurred_on = ?, value_minor = ?, notes = ?, metric_type_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND id = ?`,
    [occurredOn, valueMinor, notes, metricTypeId, ws, id],
  );
  await audit(db, ws, userId, 'UPDATE', 'activity', id, null);
  const updated = await activityById(db, ws, id);
  return json(activityView(updated, privileged, userId));
}

const forbiddenEdit = () => new ApiError(403, 'FORBIDDEN', 'You can only edit entries you logged');

async function deleteActivity(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const row = await activityById(db, ws, id);
  const privileged = ctx.role === 'admin' || ctx.role === 'owner';
  if (!privileged && row.logged_by !== userId) throw forbiddenEdit();
  const ledger = await one(db, 'SELECT id FROM ledger_entries WHERE workspace_id = ? AND activity_entry_id = ?', [ws, id]);
  if (ledger) throw conflict('This activity has ledger entries; remove those first');
  await exec(db, 'DELETE FROM activity_entries WHERE workspace_id = ? AND id = ?', [ws, id]);
  await audit(db, ws, userId, 'DELETE', 'activity', id, null);
  return noContent();
}

// ------------------------------------------------------- commission rules

const COMMISSION_SELECT = `
  SELECT c.id, c.offer_id, o.title AS offer_title, c.rep_id, r.name AS rep_name,
         c.kind, c.rate_bp, c.flat_minor, c.currency, c.tiers
    FROM commission_rules c
    LEFT JOIN offers o ON o.workspace_id = c.workspace_id AND o.id = c.offer_id
    LEFT JOIN reps r ON r.workspace_id = c.workspace_id AND r.id = c.rep_id`;

const commissionView = (row) => ({
  id: row.id,
  offerId: row.offer_id,
  offerTitle: row.offer_title,
  repId: row.rep_id,
  repName: row.rep_name,
  kind: row.kind,
  rateBp: row.rate_bp,
  flatMinor: row.flat_minor,
  currency: row.currency,
  tiers: parseJson(row.tiers, []),
});

async function listCommissionRules(request, env) {
  const { ws } = await ctxOf(request, env);
  const rows = await all(env.DB, `${COMMISSION_SELECT} WHERE c.workspace_id = ? ORDER BY c.id`, [ws]);
  return json(rows.map(commissionView));
}

async function saveCommissionRule(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const body = await readJson(request);
  const kind = String(body.kind || '').toLowerCase();
  if (!['percent', 'flat', 'tiered'].includes(kind)) throw badRequest('kind must be percent, flat or tiered');
  const offerId = num(body.offerId);
  const repId = num(body.repId);
  if (offerId) await one(db, 'SELECT id FROM offers WHERE workspace_id = ? AND id = ?', [ws, offerId]) || badRequestThrow('Offer does not exist');
  if (repId) await one(db, 'SELECT id FROM reps WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL', [ws, repId]) || badRequestThrow('Rep does not exist');

  let rateBp = null;
  let flatMinor = null;
  let tiers = null;
  if (kind === 'percent') {
    rateBp = num(body.rateBp);
    if (rateBp == null || rateBp < 0 || rateBp > 10000) throw badRequest('rateBp must be between 0 and 10000');
  } else if (kind === 'flat') {
    flatMinor = num(body.flatMinor);
    if (flatMinor == null || flatMinor < 0) throw badRequest('flatMinor must be zero or more');
  } else {
    tiers = Array.isArray(body.tiers) ? body.tiers.map((t) => ({
      upToMinor: t && t.upToMinor != null ? num(t.upToMinor) : null,
      rateBp: num(t && t.rateBp, 0),
    })) : [];
    if (!tiers.length) throw badRequest('tiered rules need at least one tier');
  }

  const res = await exec(
    db,
    `INSERT INTO commission_rules (workspace_id, offer_id, rep_id, kind, rate_bp, flat_minor, currency, tiers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [ws, offerId || null, repId || null, kind, rateBp, flatMinor,
      trimmed(body.currency), tiers ? JSON.stringify(tiers) : null],
  );
  await audit(db, ws, userId, 'CREATE', 'commission_rule', res.meta.last_row_id, { kind });
  const row = await one(db, `${COMMISSION_SELECT} WHERE c.workspace_id = ? AND c.id = ?`, [ws, res.meta.last_row_id]);
  return json(commissionView(row), 201);
}

const badRequestThrow = (m) => {
  throw badRequest(m);
};

async function deleteCommissionRule(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const existing = await one(db, 'SELECT id FROM commission_rules WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!existing) throw notFound(`Commission rule ${id} not found`);
  await exec(db, 'DELETE FROM commission_rules WHERE workspace_id = ? AND id = ?', [ws, id]);
  await audit(db, ws, userId, 'DELETE', 'commission_rule', id, null);
  return noContent();
}

// ----------------------------------------------------- earnings and payouts

const EARNINGS_SELECT = `
  SELECT le.id, le.rep_id, r.name AS rep_name, le.placement_id,
         (SELECT p.offer_id FROM placements p WHERE p.workspace_id = le.workspace_id AND p.id = le.placement_id) AS offer_id,
         (SELECT o.title FROM placements p JOIN offers o ON o.workspace_id = p.workspace_id AND o.id = p.offer_id
           WHERE p.workspace_id = le.workspace_id AND p.id = le.placement_id) AS offer_title,
         le.activity_entry_id, le.commission_rule_id, le.payout_id, le.reverses_entry_id,
         le.status, le.amount_minor, le.currency, le.entered_on, le.created_at
    FROM ledger_entries le
    LEFT JOIN reps r ON r.workspace_id = le.workspace_id AND r.id = le.rep_id`;

const earningsView = (row) => ({
  id: row.id,
  repId: row.rep_id,
  repName: row.rep_name,
  placementId: row.placement_id,
  offerId: row.offer_id,
  offerTitle: row.offer_title,
  activityEntryId: row.activity_entry_id,
  commissionRuleId: row.commission_rule_id,
  payoutId: row.payout_id,
  reversesEntryId: row.reverses_entry_id,
  status: row.status,
  amountMinor: row.amount_minor,
  currency: row.currency,
  enteredOn: row.entered_on,
  createdAt: iso(row.created_at),
  reversal: row.amount_minor < 0,
});

async function listEarnings(request, env) {
  const { ws } = await ctxOf(request, env);
  const p = new URL(request.url).searchParams;
  const where = ['le.workspace_id = ?'];
  const binds = [ws];
  if (num(p.get('repId'))) {
    where.push('le.rep_id = ?');
    binds.push(num(p.get('repId')));
  }
  if (trimmed(p.get('status'))) {
    where.push('le.status = ?');
    binds.push(trimmed(p.get('status')));
  }
  if (p.get('from')) {
    where.push('le.entered_on >= ?');
    binds.push(p.get('from'));
  }
  if (p.get('to')) {
    where.push('le.entered_on <= ?');
    binds.push(p.get('to'));
  }
  const rows = await all(env.DB, `${EARNINGS_SELECT} WHERE ${where.join(' AND ')} ORDER BY le.entered_on DESC, le.id DESC LIMIT 500`, binds);
  const items = rows.map(earningsView);
  const currencies = items.filter((i) => !i.reversal).map((i) => i.currency);
  return json({
    total: items.length,
    netMinor: items.reduce((sum, i) => sum + i.amountMinor, 0),
    currency: currencies[0] || items[0]?.currency || null,
    items,
  });
}

async function approveEarning(request, env, id) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const row = await one(db, 'SELECT id, status FROM ledger_entries WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!row) throw notFound(`Earning ${id} not found`);
  if (row.status === 'paid') throw conflict('A paid entry cannot be re-approved');
  await exec(db, "UPDATE ledger_entries SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?", [ws, id]);
  await audit(db, ws, userId, 'UPDATE', 'ledger_entry', id, { status: 'approved' });
  const updated = await one(db, `${EARNINGS_SELECT} WHERE le.workspace_id = ? AND le.id = ?`, [ws, id]);
  return json(earningsView(updated));
}

async function listPayouts(request, env) {
  const { ws } = await ctxOf(request, env);
  const rows = await all(
    env.DB,
    `SELECT p.id, p.rep_id, r.name AS rep_name, p.amount_minor, p.currency, p.entry_count,
            p.paid_on, p.reference_note, p.created_by, p.created_at
       FROM payouts p
       LEFT JOIN reps r ON r.workspace_id = p.workspace_id AND r.id = p.rep_id
      WHERE p.workspace_id = ?
      ORDER BY p.paid_on DESC, p.id DESC`,
    [ws],
  );
  return json(rows.map((r) => ({
    id: r.id,
    repId: r.rep_id,
    repName: r.rep_name,
    amountMinor: r.amount_minor,
    currency: r.currency,
    entryCount: r.entry_count,
    paidOn: r.paid_on,
    referenceNote: r.reference_note,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
  })));
}

async function exportPayouts(request, env) {
  const { ctx } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const rows = await all(
    env.DB,
    `SELECT p.id, IFNULL(r.name, '') AS rep_name, p.amount_minor, p.currency, p.entry_count, p.paid_on, IFNULL(p.reference_note, '')
       FROM payouts p
       LEFT JOIN reps r ON r.workspace_id = p.workspace_id AND r.id = p.rep_id
      WHERE p.workspace_id = ?
      ORDER BY p.paid_on DESC, p.id DESC`,
    [ctx.workspaceId],
  );
  return csvResponse(
    csv([
      ['id', 'rep', 'amount_minor', 'currency', 'entries', 'paid_on', 'note'],
      ...rows.map((r) => [r.id, r.rep_name, r.amount_minor, r.currency, r.entry_count, r.paid_on, r.reference_note]),
    ]),
    'payouts.csv',
  );
}

async function createPayout(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const body = await readJson(request);
  const entryIds = Array.isArray(body.entryIds) ? body.entryIds.map((v) => num(v)).filter(Boolean) : [];
  const paidOn = dateOrNull(body.paidOn);
  if (!entryIds.length) throw badRequest('entryIds must list at least one entry');
  if (!paidOn) throw badRequest('paidOn is required');

  const ph = entryIds.map(() => '?').join(',');
  const entries = await all(db, `SELECT * FROM ledger_entries WHERE workspace_id = ? AND id IN (${ph})`, [ws, ...entryIds]);
  if (entries.length !== entryIds.length) throw badRequest('One or more entries do not exist in this workspace');
  const unpaid = entries.filter((e) => e.status !== 'approved');
  if (unpaid.length) throw conflict(`${unpaid.length} entr${unpaid.length === 1 ? 'y is' : 'ies are'} not approved yet`);
  const currencies = new Set(entries.map((e) => e.currency));
  if (currencies.size !== 1) throw conflict('All entries in a payout must share one currency');
  const repIds = new Set(entries.map((e) => e.rep_id));
  if (repIds.size !== 1) throw conflict('All entries in a payout must belong to the same rep');

  const amount = entries.reduce((sum, e) => sum + e.amount_minor, 0);
  const currency = entries[0].currency;
  const res = await exec(
    db,
    `INSERT INTO payouts (workspace_id, rep_id, amount_minor, currency, entry_count, paid_on, reference_note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [ws, entries[0].rep_id, amount, currency, entries.length, paidOn, trimmed(body.referenceNote), userId],
  );
  const payoutId = res.meta.last_row_id;
  await exec(
    db,
    `UPDATE ledger_entries SET status = 'paid', payout_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND id IN (${ph})`,
    [payoutId, ws, ...entryIds],
  );
  await audit(db, ws, userId, 'CREATE', 'payout', payoutId, { amountMinor: amount, entries: entries.length });
  const row = await one(
    db,
    `SELECT p.id, p.rep_id, r.name AS rep_name, p.amount_minor, p.currency, p.entry_count,
            p.paid_on, p.reference_note, p.created_by, p.created_at
       FROM payouts p
       LEFT JOIN reps r ON r.workspace_id = p.workspace_id AND r.id = p.rep_id
      WHERE p.workspace_id = ? AND p.id = ?`,
    [ws, payoutId],
  );
  return json({
    id: row.id,
    repId: row.rep_id,
    repName: row.rep_name,
    amountMinor: row.amount_minor,
    currency: row.currency,
    entryCount: row.entry_count,
    paidOn: row.paid_on,
    referenceNote: row.reference_note,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
  }, 201);
}

// --------------------------------------------------------------- leaderboard

async function leaderboard(request, env) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const p = new URL(request.url).searchParams;
  const metricTypeId = num(p.get('metricTypeId'));
  if (!metricTypeId) throw badRequest('metricTypeId is required');
  const metric = await one(db, 'SELECT id, name, unit FROM metric_types WHERE workspace_id = ? AND id = ?', [ws, metricTypeId]);
  if (!metric) throw notFound('Metric type not found');

  const today = new Date();
  const period = trimmed(p.get('period')) || 'month';
  const startOfWeek = (() => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const day = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  })();
  const defaults = {
    week: [startOfWeek, today.toISOString().slice(0, 10)],
    month: [`${today.toISOString().slice(0, 7)}-01`, today.toISOString().slice(0, 10)],
    all: ['1970-01-01', today.toISOString().slice(0, 10)],
  };
  const [from, to] = p.get('from') && p.get('to')
    ? [p.get('from'), p.get('to')]
    : defaults[period] || defaults.month;

  const rows = await all(
    db,
    `SELECT a.rep_id, r.name AS rep_name, SUM(a.value_minor) AS value
       FROM activity_entries a
       JOIN reps r ON r.workspace_id = a.workspace_id AND r.id = a.rep_id
      WHERE a.workspace_id = ? AND a.metric_type_id = ? AND a.occurred_on BETWEEN ? AND ?
      GROUP BY a.rep_id
      ORDER BY value DESC, r.name COLLATE NOCASE
      LIMIT 25`,
    [ws, metricTypeId, from, to],
  );
  const membership = await one(db, 'SELECT rep_id FROM memberships WHERE workspace_id = ? AND user_id = ?', [ws, userId]);
  const selfRepId = membership ? membership.rep_id : null;
  const showNames = (await one(db, 'SELECT leaderboard_show_names AS show FROM workspaces WHERE id = ?', [ws])).show === 1;

  const items = rows.map((r, i) => ({
    rank: i + 1,
    repId: r.rep_id,
    repName: showNames || r.rep_id === selfRepId ? r.rep_name : null,
    value: r.value,
    self: r.rep_id === selfRepId && selfRepId != null,
  }));
  const self = items.find((i) => i.self);
  return json({
    period,
    metricTypeId: metric.id,
    metricName: metric.name,
    metricUnit: metric.unit,
    from,
    to,
    showNames,
    selfRank: self ? self.rank : null,
    items,
  });
}

// -------------------------------------------------- workspace settings/brand

async function workspaceSettings(request, env) {
  const { ws } = await ctxOf(request, env);
  const row = await one(env.DB, 'SELECT leaderboard_show_names AS show FROM workspaces WHERE id = ?', [ws]);
  if (!row) throw notFound('Workspace not found');
  return json({ leaderboardShowNames: row.show === 1 });
}

async function saveWorkspaceSettings(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const body = await readJson(request);
  if (typeof body.leaderboardShowNames !== 'boolean') {
    throw badRequest('leaderboardShowNames must be a boolean');
  }
  await exec(
    env.DB,
    'UPDATE workspaces SET leaderboard_show_names = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [body.leaderboardShowNames ? 1 : 0, ws],
  );
  await audit(env.DB, ws, userId, 'UPDATE', 'workspace', ws, { leaderboardShowNames: body.leaderboardShowNames });
  return json({ leaderboardShowNames: body.leaderboardShowNames });
}

async function saveBranding(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const body = await readJson(request);
  const logoUrl = trimmed(body.logoUrl);
  const accentColor = trimmed(body.accentColor);
  const customDomain = trimmed(body.customDomain);
  if (accentColor && !/^#[0-9a-fA-F]{3,8}$/.test(accentColor)) {
    throw badRequest('accentColor must be a hex colour like #4f46e5');
  }
  if (customDomain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(customDomain)) {
    throw badRequest('customDomain must be a hostname like app.example.com');
  }
  await exec(
    env.DB,
    `UPDATE workspaces SET logo_url = ?, accent_color = ?, custom_domain = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [logoUrl, accentColor, customDomain, ws],
  );
  await audit(env.DB, ws, userId, 'UPDATE', 'workspace', ws, { branding: true });
  return json({ logoUrl, accentColor, customDomain });
}

async function deleteWorkspace(request, env, id) {
  const userId = await requireUser(request, env);
  const db = env.DB;
  const membership = await one(db, 'SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?', [id, userId]);
  if (!membership) throw new ApiError(403, 'FORBIDDEN', 'Not a member of this workspace');
  if (membership.role !== 'owner') throw new ApiError(403, 'FORBIDDEN', 'Requires owner access');
  const workspace = await one(db, 'SELECT id, status FROM workspaces WHERE id = ?', [id]);
  if (!workspace || workspace.status === 'deleted') throw notFound(`Workspace ${id} not found`);
  // Soft-delete: the row (and its data) stays for audit/recovery, but the
  // workspace disappears from every list immediately.
  await exec(db, "UPDATE workspaces SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
  await audit(db, id, userId, 'DELETE', 'workspace', id, null);
  return noContent();
}

// ------------------------------------------------------------------ billing

async function listPlans(request, env) {
  const { ws } = await ctxOf(request, env);
  const db = env.DB;
  const current = await one(
    db,
    'SELECT p.code FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.workspace_id = ? ORDER BY s.id DESC LIMIT 1',
    [ws],
  );
  const currentCode = current ? current.code : 'free';
  const rows = await all(db, 'SELECT code, name, max_reps, max_members FROM plans ORDER BY id', []);
  return json(rows.map((r) => ({
    code: r.code,
    name: r.name,
    maxReps: r.max_reps,
    maxMembers: r.max_members,
    current: r.code === currentCode,
  })));
}

async function subscription(request, env) {
  const { ws } = await ctxOf(request, env);
  const row = await one(
    env.DB,
    `SELECT s.status, s.trial_ends_at, s.current_period_end, s.provider, p.code, p.name
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.workspace_id = ?
      ORDER BY s.id DESC LIMIT 1`,
    [ws],
  );
  if (!row) {
    const plan = await one(env.DB, 'SELECT code, name FROM plans ORDER BY id LIMIT 1', []);
    return json({
      planCode: plan?.code || 'free',
      planName: plan?.name || 'Free',
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: null,
      provider: null,
    });
  }
  return json({
    planCode: row.code,
    planName: row.name,
    status: String(row.status).toUpperCase(),
    trialEndsAt: row.trial_ends_at ? new Date(Number(row.trial_ends_at) * 1000).toISOString() : null,
    currentPeriodEnd: iso(row.current_period_end),
    provider: row.provider,
  });
}

// ------------------------------------------------------------------ digest

async function digest(request, env) {
  const { ws } = await ctxOf(request, env);
  const row = await one(
    env.DB,
    'SELECT id, week_start, body, created_at FROM digest_logs WHERE workspace_id = ? ORDER BY id DESC LIMIT 1',
    [ws],
  );
  if (!row) throw notFound('No digest has been built yet');
  return json({ id: row.id, weekStart: row.week_start, body: row.body, generatedAt: iso(row.created_at) });
}

// --------------------------------------------------------------- engagement

/** Recompute today's engagement snapshot for every member (from activity
 *  actually recorded in this workspace) and return the dashboard. */
async function refreshEngagement(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;

  const members = await all(
    db,
    `SELECT m.user_id, u.display_name FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ?`,
    [ws],
  );
  if (!members.length) return json([]);

  const since = "datetime('now', '-7 days')";
  const [audits, checkins, messages, intros, bookings, lastAudit, lastCheckin, lastMessage, lastIntro, lastBooking] =
    await Promise.all([
      all(db, `SELECT actor_user_id AS uid, COUNT(*) AS c FROM audit_log WHERE workspace_id = ? AND created_at >= ${since} GROUP BY actor_user_id`, [ws]),
      all(db, `SELECT user_id AS uid, COUNT(*) AS c FROM pod_checkins WHERE workspace_id = ? AND created_at >= ${since} GROUP BY user_id`, [ws]),
      all(db, `SELECT user_id AS uid, COUNT(*) AS c FROM pod_messages WHERE workspace_id = ? AND created_at >= ${since} GROUP BY user_id`, [ws]),
      all(db, `SELECT from_user_id AS uid, COUNT(*) AS c FROM intro_requests WHERE workspace_id = ? AND created_at >= ${since} GROUP BY from_user_id`, [ws]),
      all(db, `SELECT member_user_id AS uid, COUNT(*) AS c FROM office_hour_bookings WHERE workspace_id = ? AND created_at >= ${since} GROUP BY member_user_id`, [ws]),
      all(db, 'SELECT actor_user_id AS uid, MAX(created_at) AS at FROM audit_log WHERE workspace_id = ? GROUP BY actor_user_id', [ws]),
      all(db, 'SELECT user_id AS uid, MAX(created_at) AS at FROM pod_checkins WHERE workspace_id = ? GROUP BY user_id', [ws]),
      all(db, 'SELECT user_id AS uid, MAX(created_at) AS at FROM pod_messages WHERE workspace_id = ? GROUP BY user_id', [ws]),
      all(db, 'SELECT from_user_id AS uid, MAX(created_at) AS at FROM intro_requests WHERE workspace_id = ? GROUP BY from_user_id', [ws]),
      all(db, 'SELECT member_user_id AS uid, MAX(created_at) AS at FROM office_hour_bookings WHERE workspace_id = ? GROUP BY member_user_id', [ws]),
    ]);

  const counts = new Map();
  const bump = (list, weight, key = keyFor(weight)) => {
    for (const row of list) {
      const uid = row.uid;
      if (uid == null) continue;
      const entry = counts.get(uid) || { score: 0, last: null, parts: { audits: 0, checkins: 0, messages: 0, intros: 0, bookings: 0 } };
      entry.score = Math.min(100, entry.score + row.c * weight);
      entry.parts[key] += row.c;
      counts.set(uid, entry);
    }
  };
  const keyFor = (weight) => ({ 10: 'audits', 20: 'checkins', 5: 'messages', 15: 'intros' }[weight]) || 'bookings';
  bump(audits, 10);
  bump(checkins, 20);
  bump(messages, 5);
  bump(intros, 15);
  bump(bookings, 15, 'bookings');

  for (const list of [lastAudit, lastCheckin, lastMessage, lastIntro, lastBooking]) {
    for (const row of list) {
      if (row.uid == null) continue;
      const entry = counts.get(row.uid) || { score: 0, last: null, parts: { audits: 0, checkins: 0, messages: 0, intros: 0, bookings: 0 } };
      if (!entry.last || String(row.at) > String(entry.last)) entry.last = row.at;
      counts.set(row.uid, entry);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const snapshots = members.map((m) => {
    const stats = counts.get(m.user_id) || { score: 0, last: null, parts: { audits: 0, checkins: 0, messages: 0, intros: 0, bookings: 0 } };
    const created = String(stats.last || today);
    const daysInactive = stats.last ? daysSince(stats.last) : daysSince(today);
    return {
      userId: m.user_id,
      displayName: m.display_name,
      snapshotDate: today,
      score: stats.score,
      auditActions: stats.parts.audits,
      podCheckins: stats.parts.checkins,
      podMessages: stats.parts.messages,
      introActivity: stats.parts.intros,
      bookings: stats.parts.bookings,
      daysInactive,
      lastActivity: stats.last,
      created,
    };
  });

  await db.batch([
    db.prepare('DELETE FROM engagement_snapshots WHERE workspace_id = ? AND snapshot_date = ?').bind(ws, today),
    ...snapshots.map((s) => db.prepare(
      `INSERT INTO engagement_snapshots (workspace_id, user_id, snapshot_date, score, audit_actions, pod_checkins,
                                         pod_messages, intro_activity, bookings, days_inactive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(ws, s.userId, s.snapshotDate, s.score, s.auditActions, s.podCheckins, s.podMessages, s.introActivity, s.bookings, s.daysInactive)),
  ]);
  await audit(db, ws, userId, 'UPDATE', 'engagement', ws, { snapshotDate: today });

  return json(snapshots.map((s) => ({
    userId: s.userId,
    displayName: s.displayName,
    snapshotDate: s.snapshotDate,
    score: s.score,
    auditActions: s.auditActions,
    podCheckins: s.podCheckins,
    podMessages: s.podMessages,
    introActivity: s.introActivity,
    bookings: s.bookings,
    daysInactive: s.daysInactive,
  })));
}

async function engagementDashboard(request, env) {
  const { ws } = await ctxOf(request, env);
  const db = env.DB;
  const latest = await one(db, 'SELECT MAX(snapshot_date) AS d FROM engagement_snapshots WHERE workspace_id = ?', [ws]);
  if (!latest || !latest.d) return json({ snapshotDate: null, membersConsidered: 0, atRisk: [] });

  const rows = await all(
    db,
    `SELECT e.user_id, u.display_name, e.score, e.days_inactive, e.snapshot_date
       FROM engagement_snapshots e
       JOIN users u ON u.id = e.user_id
      WHERE e.workspace_id = ? AND e.snapshot_date = ?
      ORDER BY e.score ASC`,
    [ws, latest.d],
  );
  const previousDate = await one(
    db,
    'SELECT MAX(snapshot_date) AS d FROM engagement_snapshots WHERE workspace_id = ? AND snapshot_date < ?',
    [ws, latest.d],
  );
  const previous = new Map();
  if (previousDate && previousDate.d) {
    const prevRows = await all(
      db,
      'SELECT user_id, score FROM engagement_snapshots WHERE workspace_id = ? AND snapshot_date = ?',
      [ws, previousDate.d],
    );
    for (const r of prevRows) previous.set(r.user_id, r.score);
  }

  const atRisk = rows
    .filter((r) => r.score < 40 || r.days_inactive >= 7)
    .map((r) => {
      const reasons = [];
      if (r.days_inactive >= 7) reasons.push(`${r.days_inactive} days without activity`);
      if (r.score < 40) reasons.push('Engagement score below 40');
      return {
        userId: r.user_id,
        displayName: r.display_name,
        score: r.score,
        previousScore: previous.has(r.user_id) ? previous.get(r.user_id) : null,
        daysInactive: r.days_inactive,
        reasons,
      };
    });

  return json({ snapshotDate: latest.d, membersConsidered: rows.length, atRisk });
}

async function nudgeMember(request, env, userId) {
  const { ctx, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const member = await one(db, 'SELECT user_id, display_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.user_id = ?', [ws, userId]);
  if (!member) throw notFound('Member not found in this workspace');
  const snapshot = await one(
    db,
    `SELECT score, days_inactive FROM engagement_snapshots
      WHERE workspace_id = ? AND user_id = ?
      ORDER BY snapshot_date DESC, id DESC LIMIT 1`,
    [ws, userId],
  );
  const reasons = snapshot && snapshot.days_inactive >= 7
    ? `${snapshot.days_inactive} days without activity`
    : snapshot && snapshot.score < 40
      ? 'Engagement score below 40'
      : 'No recent activity recorded';
  return json({ userId, displayName: member.display_name, reason: reasons });
}

// --------------------------------------------------------------------- pods

async function podStreak(db, ws, userId) {
  const rows = await all(db, 'SELECT week_start FROM pod_checkins WHERE workspace_id = ? AND user_id = ? ORDER BY week_start DESC', [ws, userId]);
  if (!rows.length) return null;
  let streak = 0;
  let expected = new Date(`${String(rows[0].week_start).slice(0, 10)}T00:00:00Z`);
  for (const row of rows) {
    const week = new Date(`${String(row.week_start).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(week.getTime())) break;
    if (streak === 0) {
      // The newest checkin starts the streak (it may be last week or earlier).
      streak = 1;
      expected = new Date(week.getTime() - 7 * 86400000);
      continue;
    }
    if (week.getTime() !== expected.getTime()) break;
    streak += 1;
    expected = new Date(expected.getTime() - 7 * 86400000);
  }
  return streak;
}

async function podView(db, ws, pod, userId) {
  const memberRows = await all(
    db,
    `SELECT pm.user_id, u.display_name, mp.revenue_stage
       FROM pod_members pm
       JOIN users u ON u.id = pm.user_id
       LEFT JOIN member_profiles mp ON mp.workspace_id = pm.workspace_id AND mp.user_id = pm.user_id
      WHERE pm.workspace_id = ? AND pm.pod_id = ?
      ORDER BY u.display_name COLLATE NOCASE`,
    [ws, pod.id],
  );
  const members = [];
  for (const m of memberRows) {
    members.push({
      userId: m.user_id,
      displayName: m.display_name,
      streak: await podStreak(db, ws, m.user_id),
      revenueStage: m.revenue_stage,
    });
  }
  return { id: pod.id, name: pod.name, industry: pod.industry, members };
}

async function listMyPods(request, env) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const pods = await all(
    db,
    `SELECT p.id, p.name, p.industry FROM pods p
       JOIN pod_members pm ON pm.workspace_id = p.workspace_id AND pm.pod_id = p.id
      WHERE p.workspace_id = ? AND pm.user_id = ?
      ORDER BY p.name COLLATE NOCASE`,
    [ws, userId],
  );
  const views = [];
  for (const pod of pods) views.push(await podView(db, ws, pod, userId));
  return json(views);
}

async function fetchPod(request, env, id) {
  const { ws, userId, ctx } = await ctxOf(request, env);
  const db = env.DB;
  const pod = await one(db, 'SELECT id, name, industry FROM pods WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!pod) throw notFound(`Pod ${id} not found`);
  const privileged = ctx.role === 'admin' || ctx.role === 'owner';
  const member = await one(db, 'SELECT id FROM pod_members WHERE workspace_id = ? AND pod_id = ? AND user_id = ?', [ws, id, userId]);
  if (!member && !privileged) throw new ApiError(403, 'FORBIDDEN', 'You are not a member of this pod');
  return json(await podView(db, ws, pod, userId));
}

async function podCheckinView(db, ws, rows) {
  const out = [];
  for (const r of rows) {
    const user = await one(db, 'SELECT display_name FROM users WHERE id = ?', [r.user_id]);
    out.push({
      id: r.id,
      podId: r.pod_id,
      userId: r.user_id,
      displayName: user ? user.display_name : null,
      weekStart: r.week_start,
      wins: r.wins,
      blockers: r.blockers,
      ask: r.ask,
    });
  }
  return out;
}

async function listPodCheckins(request, env, id) {
  const { ws, userId, ctx } = await ctxOf(request, env);
  const db = env.DB;
  const pod = await one(db, 'SELECT id FROM pods WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!pod) throw notFound(`Pod ${id} not found`);
  const privileged = ctx.role === 'admin' || ctx.role === 'owner';
  const member = await one(db, 'SELECT id FROM pod_members WHERE workspace_id = ? AND pod_id = ? AND user_id = ?', [ws, id, userId]);
  if (!member && !privileged) throw new ApiError(403, 'FORBIDDEN', 'You are not a member of this pod');
  const rows = await all(db, 'SELECT * FROM pod_checkins WHERE workspace_id = ? AND pod_id = ? ORDER BY week_start DESC, id DESC', [ws, id]);
  return json(await podCheckinView(db, ws, rows));
}

async function submitPodCheckin(request, env, id) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const pod = await one(db, 'SELECT id FROM pods WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!pod) throw notFound(`Pod ${id} not found`);
  const member = await one(db, 'SELECT id FROM pod_members WHERE workspace_id = ? AND pod_id = ? AND user_id = ?', [ws, id, userId]);
  if (!member) throw new ApiError(403, 'FORBIDDEN', 'You are not a member of this pod');
  const body = await readJson(request);
  const wins = trimmed(body.wins);
  const blockers = trimmed(body.blockers);
  if (!wins) throw badRequest('wins is required');
  if (!blockers) throw badRequest('blockers is required');
  const weekStart = dateOrNull(body.weekStart) || defaultWeekStart();

  const existing = await one(db, 'SELECT id FROM pod_checkins WHERE workspace_id = ? AND pod_id = ? AND user_id = ? AND week_start = ?', [ws, id, userId, weekStart]);
  if (existing) {
    await exec(db, 'UPDATE pod_checkins SET wins = ?, blockers = ?, ask = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [wins, blockers, trimmed(body.ask), existing.id]);
    const row = await one(db, 'SELECT * FROM pod_checkins WHERE id = ?', [existing.id]);
    return json((await podCheckinView(db, ws, [row]))[0]);
  }
  const res = await exec(db, 'INSERT INTO pod_checkins (workspace_id, pod_id, user_id, week_start, wins, blockers, ask) VALUES (?, ?, ?, ?, ?, ?, ?)', [ws, id, userId, weekStart, wins, blockers, trimmed(body.ask)]);
  const row = await one(db, 'SELECT * FROM pod_checkins WHERE id = ?', [res.meta.last_row_id]);
  return json((await podCheckinView(db, ws, [row]))[0], 201);
}

function defaultWeekStart() {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

async function listPodMessages(request, env, id) {
  const { ws, userId, ctx } = await ctxOf(request, env);
  const db = env.DB;
  const pod = await one(db, 'SELECT id FROM pods WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!pod) throw notFound(`Pod ${id} not found`);
  const privileged = ctx.role === 'admin' || ctx.role === 'owner';
  const member = await one(db, 'SELECT id FROM pod_members WHERE workspace_id = ? AND pod_id = ? AND user_id = ?', [ws, id, userId]);
  if (!member && !privileged) throw new ApiError(403, 'FORBIDDEN', 'You are not a member of this pod');
  const rows = await all(
    db,
    `SELECT pm.id, pm.pod_id, pm.user_id, u.display_name, pm.body, pm.created_at
       FROM pod_messages pm JOIN users u ON u.id = pm.user_id
      WHERE pm.workspace_id = ? AND pm.pod_id = ?
      ORDER BY pm.id`,
    [ws, id],
  );
  return json(rows.map((r) => ({
    id: r.id, podId: r.pod_id, userId: r.user_id, displayName: r.display_name,
    body: r.body, createdAt: iso(r.created_at),
  })));
}

async function postPodMessage(request, env, id) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const pod = await one(db, 'SELECT id FROM pods WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!pod) throw notFound(`Pod ${id} not found`);
  const member = await one(db, 'SELECT id FROM pod_members WHERE workspace_id = ? AND pod_id = ? AND user_id = ?', [ws, id, userId]);
  if (!member) throw new ApiError(403, 'FORBIDDEN', 'You are not a member of this pod');
  const body = await readJson(request);
  const text = trimmed(body.body);
  if (!text) throw badRequest('body is required');
  const res = await exec(db, 'INSERT INTO pod_messages (workspace_id, pod_id, user_id, body) VALUES (?, ?, ?, ?)', [ws, id, userId, text]);
  const row = await one(db, `SELECT pm.id, pm.pod_id, pm.user_id, u.display_name, pm.body, pm.created_at
                               FROM pod_messages pm JOIN users u ON u.id = pm.user_id
                              WHERE pm.workspace_id = ? AND pm.id = ?`, [ws, res.meta.last_row_id]);
  return json({
    id: row.id, podId: row.pod_id, userId: row.user_id, displayName: row.display_name,
    body: row.body, createdAt: iso(row.created_at),
  }, 201);
}

/** Group members into pods of five by revenue stage/industry (pod preview). */
async function generatePods(request, env) {
  const { ctx, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  const inPods = new Set(
    (await all(
      db,
      `SELECT DISTINCT pm.user_id FROM pod_members pm
         JOIN pods p ON p.workspace_id = pm.workspace_id AND p.id = pm.pod_id
        WHERE pm.workspace_id = ? AND p.status = 'active'`,
      [ws],
    )).map((r) => r.user_id),
  );
  const members = await all(
    db,
    `SELECT m.user_id, u.display_name, mp.industry, mp.revenue_stage
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN member_profiles mp ON mp.workspace_id = m.workspace_id AND mp.user_id = m.user_id
      WHERE m.workspace_id = ?
      ORDER BY u.display_name COLLATE NOCASE`,
    [ws],
  );
  const eligible = members.filter((m) => !inPods.has(m.user_id));
  const buckets = new Map();
  for (const m of eligible) {
    const key = m.revenue_stage || m.industry || 'General';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }

  const drafts = [];
  for (const [, group] of buckets) {
    for (let i = 0; i < group.length; i += 5) {
      const slice = group.slice(i, i + 5);
      if (slice.length < 2) continue; // a pod needs at least two people
      drafts.push({
        industry: slice[0].industry,
        userIds: slice.map((m) => m.user_id),
        names: slice.map((m) => m.display_name),
        revenueStages: slice.map((m) => m.revenue_stage),
      });
    }
  }
  return json(drafts);
}

async function publishPods(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const db = env.DB;
  // Clone before the body is read so the draft generator can still parse it.
  const draftRequest = request.clone();
  const body = await readJson(request);
  const prefix = trimmed(body.namePrefix) || 'Pod';

  let drafts = Array.isArray(body.drafts) ? body.drafts : null;
  if (!drafts || !drafts.length) {
    const preview = await generatePods(draftRequest, env);
    drafts = await preview.json();
  }
  if (!drafts.length) throw conflict('No eligible members to group into pods yet');

  const created = [];
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const userIds = (draft.userIds || []).map((v) => num(v)).filter(Boolean);
    if (userIds.length < 2) continue;
    const name = `${prefix} ${i + 1}`;
    const res = await exec(db, 'INSERT INTO pods (workspace_id, name, industry) VALUES (?, ?, ?)', [ws, name, trimmed(draft.industry)]);
    const podId = res.meta.last_row_id;
    for (const uid of userIds) {
      const member = await one(db, 'SELECT id FROM memberships WHERE workspace_id = ? AND user_id = ?', [ws, uid]);
      if (!member) continue;
      await exec(db, 'INSERT OR IGNORE INTO pod_members (workspace_id, pod_id, user_id) VALUES (?, ?, ?)', [ws, podId, uid]);
    }
    created.push({ id: podId, name, industry: trimmed(draft.industry) });
  }
  if (!created.length) throw conflict('No valid drafts to publish');
  await audit(db, ws, userId, 'CREATE', 'pod', created[0].id, { count: created.length });

  const views = [];
  for (const pod of created) views.push(await podView(db, ws, pod, userId));
  return json(views, 201);
}

// ------------------------------------------------------------------- intros

async function introProfile(request, env) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const user = await one(db, 'SELECT display_name FROM users WHERE id = ?', [userId]);
  const row = await one(db, 'SELECT offering_tags, looking_for_tags, industry, revenue_stage FROM member_profiles WHERE workspace_id = ? AND user_id = ?', [ws, userId]);
  return json({
    userId,
    displayName: user ? user.display_name : null,
    offeringTags: parseJson(row?.offering_tags, []),
    lookingForTags: parseJson(row?.looking_for_tags, []),
    industry: row ? row.industry : null,
    revenueStage: row ? row.revenue_stage : null,
  });
}

async function saveIntroProfile(request, env) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const body = await readJson(request);
  const offering = Array.isArray(body.offeringTags) ? body.offeringTags.map((t) => trimmed(t)).filter(Boolean) : [];
  const looking = Array.isArray(body.lookingForTags) ? body.lookingForTags.map((t) => trimmed(t)).filter(Boolean) : [];
  const industry = trimmed(body.industry);
  const revenueStage = trimmed(body.revenueStage);
  const existing = await one(db, 'SELECT id FROM member_profiles WHERE workspace_id = ? AND user_id = ?', [ws, userId]);
  if (existing) {
    await exec(
      db,
      'UPDATE member_profiles SET offering_tags = ?, looking_for_tags = ?, industry = ?, revenue_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND user_id = ?',
      [JSON.stringify(offering), JSON.stringify(looking), industry, revenueStage, ws, userId],
    );
  } else {
    await exec(
      db,
      'INSERT INTO member_profiles (workspace_id, user_id, offering_tags, looking_for_tags, industry, revenue_stage) VALUES (?, ?, ?, ?, ?, ?)',
      [ws, userId, JSON.stringify(offering), JSON.stringify(looking), industry, revenueStage],
    );
  }
  return introProfile(request, env);
}

async function introSuggestions(request, env) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const mine = await one(db, 'SELECT offering_tags, looking_for_tags FROM member_profiles WHERE workspace_id = ? AND user_id = ?', [ws, userId]);
  const myOffer = new Set(mine ? parseJson(mine.offering_tags, []).map((t) => String(t).toLowerCase()) : []);
  const myWant = new Set(mine ? parseJson(mine.looking_for_tags, []).map((t) => String(t).toLowerCase()) : []);
  if (!myWant.size && !myOffer.size) return json([]);

  const others = await all(
    db,
    `SELECT m.user_id, u.display_name, mp.offering_tags, mp.revenue_stage
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       JOIN member_profiles mp ON mp.workspace_id = m.workspace_id AND mp.user_id = m.user_id
      WHERE m.workspace_id = ? AND m.user_id != ?`,
    [ws, userId],
  );
  const pending = new Set(
    (await all(
      db,
      "SELECT from_user_id FROM intro_requests WHERE workspace_id = ? AND to_user_id = ? AND status = 'pending'",
      [ws, userId],
    )).map((r) => r.from_user_id),
  );

  const out = [];
  for (const other of others) {
    const theyOffer = parseJson(other.offering_tags, []).map((t) => String(t).toLowerCase());
    const overlap = theyOffer.filter((t) => myWant.has(t));
    const reciprocal = theyOffer.filter((t) => myOffer.has(t));
    const matched = [...new Set([...overlap, ...reciprocal])];
    if (!matched.length) continue;
    const union = new Set([...myWant, ...myOffer, ...theyOffer]);
    const percent = Math.min(100, Math.round((matched.length / Math.max(1, union.size)) * 100 * 2));
    out.push({
      userId: other.user_id,
      displayName: other.display_name,
      reason: `Shared tags: ${matched.slice(0, 3).join(', ')}`,
      percent,
      pendingWithYou: pending.has(other.user_id),
    });
  }
  out.sort((a, b) => b.percent - a.percent);
  return json(out.slice(0, 10));
}

async function introRequestView(db, ws, row) {
  const from = await one(db, 'SELECT display_name, email FROM users WHERE id = ?', [row.from_user_id]);
  const to = await one(db, 'SELECT display_name, email FROM users WHERE id = ?', [row.to_user_id]);
  const accepted = row.status === 'accepted';
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    fromName: from ? from.display_name : null,
    toUserId: row.to_user_id,
    toName: to ? to.display_name : null,
    status: String(row.status).toUpperCase(),
    reason: row.reason,
    // Contact details are only revealed once both sides accept.
    contactEmail: accepted ? (to ? to.email : null) : null,
    createdAt: iso(row.created_at),
  };
}

async function createIntroRequest(request, env) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const body = await readJson(request);
  const target = num(body.targetUserId);
  if (!target) throw badRequest('targetUserId is required');
  if (target === userId) throw badRequest('You cannot request an intro to yourself');
  const member = await one(db, 'SELECT user_id FROM memberships WHERE workspace_id = ? AND user_id = ?', [ws, target]);
  if (!member) throw notFound('That user is not a member of this workspace');
  const dup = await one(db, "SELECT id FROM intro_requests WHERE workspace_id = ? AND from_user_id = ? AND to_user_id = ? AND status = 'pending'", [ws, userId, target]);
  if (dup) throw conflict('An intro request is already pending');
  const res = await exec(db, 'INSERT INTO intro_requests (workspace_id, from_user_id, to_user_id, reason) VALUES (?, ?, ?, ?)', [ws, userId, target, trimmed(body.reason)]);
  const row = await one(db, 'SELECT * FROM intro_requests WHERE workspace_id = ? AND id = ?', [ws, res.meta.last_row_id]);
  return json(await introRequestView(db, ws, row), 201);
}

async function listIntroRequests(request, env, direction) {
  const { ws, userId } = await ctxOf(request, env);
  const rows = await all(
    env.DB,
    direction === 'incoming'
      ? 'SELECT * FROM intro_requests WHERE workspace_id = ? AND to_user_id = ? ORDER BY id DESC'
      : 'SELECT * FROM intro_requests WHERE workspace_id = ? AND from_user_id = ? ORDER BY id DESC',
    [ws, userId],
  );
  const out = [];
  for (const row of rows) out.push(await introRequestView(env.DB, ws, row));
  return json(out);
}

async function respondToIntro(request, env, id, accept) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const row = await one(db, 'SELECT * FROM intro_requests WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!row) throw notFound(`Intro request ${id} not found`);
  if (row.to_user_id !== userId) throw new ApiError(403, 'FORBIDDEN', 'Only the recipient can respond');
  if (row.status !== 'pending') throw conflict('This request has already been answered');
  await exec(
    db,
    accept
      ? "UPDATE intro_requests SET status = 'accepted', contacted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?"
      : "UPDATE intro_requests SET status = 'declined', updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?",
    [ws, id],
  );
  const updated = await one(db, 'SELECT * FROM intro_requests WHERE workspace_id = ? AND id = ?', [ws, id]);
  return json(await introRequestView(db, ws, updated));
}

// ------------------------------------------------------------ office hours

const SLOT_SELECT = `
  SELECT s.id, s.expert_user_id, u.display_name AS expert_name, s.starts_at, s.duration_minutes,
         s.price_minor, s.currency, s.status
    FROM office_hour_slots s
    LEFT JOIN users u ON u.id = s.expert_user_id`;

const slotView = (row) => ({
  id: row.id,
  expertUserId: row.expert_user_id,
  expertName: row.expert_name,
  startsAt: iso(row.starts_at),
  durationMinutes: row.duration_minutes,
  priceMinor: row.price_minor,
  currency: row.currency,
  status: String(row.status).toUpperCase(),
});

async function listOpenSlots(request, env) {
  const { ws } = await ctxOf(request, env);
  const rows = await all(
    env.DB,
    `${SLOT_SELECT} WHERE s.workspace_id = ? AND s.status = 'open' AND s.starts_at > datetime('now')
      ORDER BY s.starts_at`,
    [ws],
  );
  return json(rows.map(slotView));
}

async function listMySlots(request, env) {
  const { ws, userId } = await ctxOf(request, env);
  const rows = await all(env.DB, `${SLOT_SELECT} WHERE s.workspace_id = ? AND s.expert_user_id = ? ORDER BY s.starts_at`, [ws, userId]);
  return json(rows.map(slotView));
}

async function createSlot(request, env) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const body = await readJson(request);
  const startsAt = trimmed(body.startsAt);
  const duration = num(body.durationMinutes);
  const price = num(body.priceMinor);
  const currency = (trimmed(body.currency) || 'USD').toUpperCase();
  if (!startsAt) throw badRequest('startsAt is required');
  if (duration == null || duration < 15 || duration > 240) throw badRequest('durationMinutes must be between 15 and 240');
  if (price == null || price < 0) throw badRequest('priceMinor must be zero or more');
  if (Number.isNaN(Date.parse(startsAt))) throw badRequest('startsAt must be an ISO timestamp');
  if (new Date(startsAt).getTime() < Date.now() - 60000) throw badRequest('startsAt must be in the future');

  const res = await exec(
    db,
    'INSERT INTO office_hour_slots (workspace_id, expert_user_id, starts_at, duration_minutes, price_minor, currency) VALUES (?, ?, ?, ?, ?, ?)',
    [ws, userId, startsAt, duration, price, currency],
  );
  const row = await one(db, `${SLOT_SELECT} WHERE s.workspace_id = ? AND s.id = ?`, [ws, res.meta.last_row_id]);
  return json(slotView(row), 201);
}

async function cancelSlot(request, env, id) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const slot = await one(db, 'SELECT id, expert_user_id, status FROM office_hour_slots WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!slot) throw notFound(`Slot ${id} not found`);
  if (slot.expert_user_id !== userId) throw new ApiError(403, 'FORBIDDEN', 'Only the expert can cancel this slot');
  if (slot.status !== 'open') throw conflict('Only open slots can be cancelled');
  await exec(db, "UPDATE office_hour_slots SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?", [ws, id]);
  const row = await one(db, `${SLOT_SELECT} WHERE s.workspace_id = ? AND s.id = ?`, [ws, id]);
  return json(slotView(row));
}

const BOOKING_SELECT = `
  SELECT b.id, b.slot_id, b.expert_user_id, b.member_user_id, b.status, b.price_minor,
         b.expert_amount_minor, b.platform_amount_minor, b.currency, b.meeting_link,
         b.provider_order_id, b.confirmed_at, b.cancelled_at, b.created_at,
         s.starts_at, s.duration_minutes, u.display_name AS expert_name
    FROM office_hour_bookings b
    LEFT JOIN office_hour_slots s ON s.workspace_id = b.workspace_id AND s.id = b.slot_id
    LEFT JOIN users u ON u.id = b.expert_user_id`;

const bookingView = (row) => ({
  id: row.id,
  slotId: row.slot_id,
  expertUserId: row.expert_user_id,
  memberUserId: row.member_user_id,
  status: String(row.status).toUpperCase(),
  priceMinor: row.price_minor,
  expertAmountMinor: row.expert_amount_minor,
  platformAmountMinor: row.platform_amount_minor,
  currency: row.currency,
  meetingLink: row.meeting_link,
  providerOrderId: row.provider_order_id,
  confirmedAt: iso(row.confirmed_at),
  cancelledAt: iso(row.cancelled_at),
  startsAt: iso(row.starts_at),
  durationMinutes: row.duration_minutes,
  expertName: row.expert_name,
  createdAt: iso(row.created_at),
});

async function listMyBookings(request, env) {
  const { ws, userId } = await ctxOf(request, env);
  const [asMember, asExpert] = await Promise.all([
    all(env.DB, `${BOOKING_SELECT} WHERE b.workspace_id = ? AND b.member_user_id = ? ORDER BY b.id DESC`, [ws, userId]),
    all(env.DB, `${BOOKING_SELECT} WHERE b.workspace_id = ? AND b.expert_user_id = ? ORDER BY b.id DESC`, [ws, userId]),
  ]);
  return json({ asMember: asMember.map(bookingView), asExpert: asExpert.map(bookingView) });
}

async function cancelBooking(request, env, id) {
  const { ctx, ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const row = await one(db, 'SELECT * FROM office_hour_bookings WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!row) throw notFound(`Booking ${id} not found`);
  const privileged = ctx.role === 'admin' || ctx.role === 'owner';
  if (!privileged && row.member_user_id !== userId && row.expert_user_id !== userId) {
    throw new ApiError(403, 'FORBIDDEN', 'You are not part of this booking');
  }
  if (['cancelled', 'refunded'].includes(row.status)) throw conflict('Booking is already cancelled');
  await db.batch([
    db.prepare("UPDATE office_hour_bookings SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?").bind(ws, id),
    db.prepare("UPDATE office_hour_slots SET status = 'open', updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ? AND status = 'booked'").bind(ws, row.slot_id),
  ]);
  const updated = await one(db, `${BOOKING_SELECT} WHERE b.workspace_id = ? AND b.id = ?`, [ws, id]);
  return json(bookingView(updated));
}

async function setMeetingLink(request, env, id) {
  const { ws, userId } = await ctxOf(request, env);
  const db = env.DB;
  const row = await one(db, 'SELECT * FROM office_hour_bookings WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!row) throw notFound(`Booking ${id} not found`);
  if (row.expert_user_id !== userId) throw new ApiError(403, 'FORBIDDEN', 'Only the expert can set the meeting link');
  const body = await readJson(request);
  const link = trimmed(body.meetingLink);
  if (!link) throw badRequest('meetingLink is required');
  await exec(db, 'UPDATE office_hour_bookings SET meeting_link = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?', [link, ws, id]);
  const updated = await one(db, `${BOOKING_SELECT} WHERE b.workspace_id = ? AND b.id = ?`, [ws, id]);
  return json(bookingView(updated));
}

async function listOfficeHourPayouts(request, env) {
  const { ws } = await ctxOf(request, env);
  const rows = await all(
    env.DB,
    'SELECT id, booking_id, expert_user_id, status, amount_minor, platform_amount_minor, currency, reverses_entry_id, created_at FROM payout_ledger_entries WHERE workspace_id = ? ORDER BY id DESC',
    [ws],
  );
  return json(rows.map((r) => ({
    id: r.id,
    bookingId: r.booking_id,
    expertUserId: r.expert_user_id,
    status: String(r.status).toUpperCase(),
    amountMinor: r.amount_minor,
    platformAmountMinor: r.platform_amount_minor,
    currency: r.currency,
    reversal: r.reverses_entry_id != null,
    createdAt: iso(r.created_at),
  })));
}

async function markPayoutPaid(request, env, id) {
  const { ctx, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const db = env.DB;
  const row = await one(db, 'SELECT id, status FROM payout_ledger_entries WHERE workspace_id = ? AND id = ?', [ws, id]);
  if (!row) throw notFound(`Payout ${id} not found`);
  if (row.status !== 'pending') throw conflict('Only pending payouts can be marked paid');
  await exec(db, "UPDATE payout_ledger_entries SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?", [ws, id]);
  const updated = await one(db, 'SELECT id, booking_id, expert_user_id, status, amount_minor, platform_amount_minor, currency, reverses_entry_id, created_at FROM payout_ledger_entries WHERE workspace_id = ? AND id = ?', [ws, id]);
  return json({
    id: updated.id,
    bookingId: updated.booking_id,
    expertUserId: updated.expert_user_id,
    status: String(updated.status).toUpperCase(),
    amountMinor: updated.amount_minor,
    platformAmountMinor: updated.platform_amount_minor,
    currency: updated.currency,
    reversal: updated.reverses_entry_id != null,
    createdAt: iso(updated.created_at),
  });
}

async function getCommissionBp(request, env) {
  const { ws } = await ctxOf(request, env);
  const row = await one(env.DB, 'SELECT office_hours_commission_bp AS bp FROM workspaces WHERE id = ?', [ws]);
  return json({ commissionBp: row ? row.bp : 1000 });
}

async function saveCommissionBp(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const body = await readJson(request);
  const bp = num(body.commissionBp);
  if (bp == null || bp < 0 || bp > 10000) throw badRequest('commissionBp must be between 0 and 10000');
  await exec(env.DB, 'UPDATE workspaces SET office_hours_commission_bp = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [bp, ws]);
  await audit(env.DB, ws, userId, 'UPDATE', 'workspace', ws, { commissionBp: bp });
  return json({ commissionBp: bp });
}

async function listExperts(request, env) {
  const { ctx, ws } = await ctxOf(request, env);
  requireRole(ctx, 'manager');
  const rows = await all(
    env.DB,
    `SELECT m.user_id, m.expert, u.display_name
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ?
      ORDER BY u.display_name COLLATE NOCASE`,
    [ws],
  );
  return json(rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    expert: r.expert === 1,
  })));
}

async function setExpert(request, env, userId) {
  const { ctx, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const body = await readJson(request);
  if (typeof body.expert !== 'boolean') throw badRequest('expert must be a boolean');
  const member = await one(env.DB, 'SELECT user_id FROM memberships WHERE workspace_id = ? AND user_id = ?', [ws, userId]);
  if (!member) throw notFound('Member not found in this workspace');
  await exec(env.DB, 'UPDATE memberships SET expert = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND user_id = ?', [body.expert ? 1 : 0, ws, userId]);
  return json({ userId, expert: body.expert });
}

// ------------------------------------------------------------------ discord

async function discordSettings(request, env) {
  const { ws } = await ctxOf(request, env);
  const row = await one(env.DB, 'SELECT guild_id, notification_channel_id, role_map FROM workspace_discord WHERE workspace_id = ?', [ws]);
  return json({
    connected: Boolean(row),
    guildId: row ? row.guild_id : null,
    notificationChannelId: row ? row.notification_channel_id : null,
    roleMap: parseJson(row ? row.role_map : null, {}),
  });
}

async function saveDiscordSettings(request, env) {
  const { ctx, userId, ws } = await ctxOf(request, env);
  requireRole(ctx, 'admin');
  const db = env.DB;
  const body = await readJson(request);
  const guildId = trimmed(body.guildId);
  if (!guildId) throw badRequest('guildId is required');
  const channelId = trimmed(body.notificationChannelId);
  const roleMap = body.roleMap && typeof body.roleMap === 'object' ? body.roleMap : {};
  const existing = await one(db, 'SELECT id FROM workspace_discord WHERE workspace_id = ?', [ws]);
  if (existing) {
    await exec(db, 'UPDATE workspace_discord SET guild_id = ?, notification_channel_id = ?, role_map = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?', [guildId, channelId, JSON.stringify(roleMap), ws]);
  } else {
    await exec(db, 'INSERT INTO workspace_discord (workspace_id, guild_id, notification_channel_id, role_map) VALUES (?, ?, ?, ?)', [ws, guildId, channelId, JSON.stringify(roleMap)]);
  }
  await audit(db, ws, userId, 'UPDATE', 'workspace', ws, { discord: true });
  return json({ connected: true, guildId, notificationChannelId: channelId, roleMap });
}

// ------------------------------------------------------------------- router

const has = (segments, ...pattern) =>
  segments.length === pattern.length && pattern.every((part, i) => (part === '*' ? true : segments[i] === part));

const idAt = (segments, index, count) => {
  if (segments.length !== count) return null;
  const value = num(segments[index]);
  return value && value > 0 ? value : null;
};

/**
 * Dispatch anything routes.js does not own. Returns a Response, or null so the
 * entrypoint can answer 404 in the shared envelope.
 */
export async function handleCore(request, env) {
  const url = new URL(request.url);
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = request.method;
  const [a, b, c, d] = segments;
  const len = segments.length;

  // ---------------------------------------------------------------- reps
  if (a === 'reps') {
    if (len === 1 && method === 'GET') return listReps(request, env);
    if (len === 1 && method === 'POST') return writeRep(request, env, null);
    if (len === 2 && b === 'export' && method === 'GET') return exportReps(request, env);
    const id = idAt(segments, 1, 2);
    if (id) {
      if (method === 'PUT') return writeRep(request, env, id);
      if (method === 'DELETE') return deleteRep(request, env, id);
    }
    const photoId = idAt(segments, 1, 3);
    if (photoId && c === 'photo') {
      if (method === 'GET') return getRepPhoto(request, env, photoId);
      if (method === 'POST') return uploadRepPhoto(request, env, photoId);
    }
    return null;
  }

  // -------------------------------------------------------------- clients
  if (a === 'clients') {
    if (len === 1 && method === 'GET') return listClients(request, env);
    if (len === 1 && method === 'POST') return writeClient(request, env, null);
    const id = idAt(segments, 1, 2);
    if (id) {
      if (method === 'PUT') return writeClient(request, env, id);
      if (method === 'DELETE') return deleteClient(request, env, id);
    }
    return null;
  }

  // -------------------------------------------------------------- offers
  if (a === 'offers') {
    if (len === 1 && method === 'GET') return listOffers(request, env);
    if (len === 1 && method === 'POST') return writeOffer(request, env, null);
    const id = idAt(segments, 1, 2);
    if (id && method === 'PUT') return writeOffer(request, env, id);
    const actionId = idAt(segments, 1, 3);
    if (actionId) {
      if (c === 'close' && method === 'POST') return closeOffer(request, env, actionId);
      if (c === 'stage' && method === 'POST') return moveOfferToStage(request, env, actionId);
      if (c === 'suggested' && method === 'GET') return suggestReps(request, env, actionId);
    }
    return null;
  }

  // ----------------------------------------------------------- placements
  if (a === 'placements') {
    if (len === 1 && method === 'GET') return listPlacements(request, env);
    if (len === 1 && method === 'POST') return placeRep(request, env);
    const id = idAt(segments, 1, 3);
    if (id && c === 'end' && method === 'POST') return endPlacement(request, env, id);
    return null;
  }

  // ------------------------------------------------------------- pipeline
  if (a === 'pipeline') {
    if (has(segments, 'pipeline', 'stages') && method === 'GET') return listStages(request, env);
    if (has(segments, 'pipeline', 'stages') && method === 'POST') return createStage(request, env);
    if (has(segments, 'pipeline', 'board') && method === 'GET') return board(request, env);
    const id = idAt(segments, 2, 3);
    if (id && b === 'stages') {
      if (method === 'PUT') return renameStage(request, env, id);
      if (method === 'DELETE') return deleteStage(request, env, id);
    }
    const moveId = idAt(segments, 2, 4);
    if (moveId && b === 'stages' && d === 'move' && method === 'POST') return moveStage(request, env, moveId);
    return null;
  }

  // -------------------------------------------------------------- lookups
  if (LOOKUP_TABLES[a]) {
    if (len === 1 && method === 'POST') return writeLookup(request, env, a, null);
    const id = idAt(segments, 1, 2);
    if (id) {
      if (method === 'PUT') return writeLookup(request, env, a, id);
      if (method === 'DELETE') return deleteLookup(request, env, a, id);
    }
    return null;
  }
  if (a === 'skills' && len === 1 && method === 'GET') return listSkills(request, env);
  if (a === 'languages' && len === 1 && method === 'GET') return listLanguages(request, env);

  // ------------------------------------------------------ reports & audit
  if (a === 'reports' && len === 1 && method === 'GET') return reports(request, env);
  if (a === 'audit' && len === 1 && method === 'GET') return auditFeed(request, env);

  // ------------------------------------------------ performance (Phase 7)
  if (a === 'metric-types') {
    if (len === 1 && method === 'GET') return listMetricTypes(request, env);
    if (len === 1 && method === 'POST') return writeMetricType(request, env, null);
    const id = idAt(segments, 1, 2);
    if (id) {
      if (method === 'PUT') return writeMetricType(request, env, id);
      if (method === 'DELETE') return deleteMetricType(request, env, id);
    }
    return null;
  }
  if (a === 'activity') {
    if (len === 1 && method === 'GET') return listActivity(request, env);
    if (len === 1 && method === 'POST') return createActivity(request, env);
    if (has(segments, 'activity', 'meta') && method === 'GET') return activityMeta(request, env);
    const id = idAt(segments, 1, 2);
    if (id && method === 'PUT') return updateActivity(request, env, id);
    if (id && method === 'DELETE') return deleteActivity(request, env, id);
    return null;
  }
  if (a === 'commission-rules') {
    if (len === 1 && method === 'GET') return listCommissionRules(request, env);
    if (len === 1 && method === 'POST') return saveCommissionRule(request, env);
    const id = idAt(segments, 1, 2);
    if (id && method === 'DELETE') return deleteCommissionRule(request, env, id);
    return null;
  }
  if (a === 'earnings') {
    if (len === 1 && method === 'GET') return listEarnings(request, env);
    const id = idAt(segments, 1, 3);
    if (id && c === 'approve' && method === 'POST') return approveEarning(request, env, id);
    return null;
  }
  if (a === 'payouts') {
    if (len === 1 && method === 'GET') return listPayouts(request, env);
    if (len === 1 && method === 'POST') return createPayout(request, env);
    if (has(segments, 'payouts', 'export') && method === 'GET') return exportPayouts(request, env);
    return null;
  }
  if (a === 'leaderboard' && len === 1 && method === 'GET') return leaderboard(request, env);

  // ------------------------------------------------- workspace settings/….
  if (has(segments, 'workspaces', 'settings')) {
    if (method === 'GET') return workspaceSettings(request, env);
    if (method === 'PUT') return saveWorkspaceSettings(request, env);
  }
  if (has(segments, 'workspaces', 'branding') && method === 'PUT') return saveBranding(request, env);
  if (a === 'workspaces' && len === 2) {
    const id = num(b);
    if (id && method === 'DELETE') return deleteWorkspace(request, env, id);
  }

  // -------------------------------------------------------------- billing
  if (has(segments, 'billing', 'plans') && method === 'GET') return listPlans(request, env);
  if (has(segments, 'billing', 'subscription') && method === 'GET') return subscription(request, env);
  if (has(segments, 'billing', 'checkout') && method === 'POST') {
    throw unavailable('Payment checkout (no billing provider is configured)');
  }
  if (has(segments, 'billing', 'plan') && method === 'POST') {
    throw unavailable('Plan changes (no billing provider is configured)');
  }

  // ------------------------------------------------------------- digest
  if (a === 'digest' && len === 1 && method === 'GET') return digest(request, env);

  // ---------------------------------------------------------- engagement
  if (has(segments, 'engagement', 'dashboard') && method === 'GET') return engagementDashboard(request, env);
  if (has(segments, 'engagement', 'refresh') && method === 'POST') return refreshEngagement(request, env);
  if (len === 4 && a === 'engagement' && b === 'members' && d === 'nudge' && method === 'POST') {
    const target = num(c);
    if (target) return nudgeMember(request, env, target);
  }

  // ----------------------------------------------------------------- pods
  if (a === 'pods') {
    if (len === 1 && method === 'GET') return listMyPods(request, env);
    if (has(segments, 'pods', 'generate') && method === 'POST') return generatePods(request, env);
    if (has(segments, 'pods', 'publish') && method === 'POST') return publishPods(request, env);
    const podId = idAt(segments, 1, 2);
    if (podId && method === 'GET') return fetchPod(request, env, podId);
    const actionId = idAt(segments, 1, 3);
    if (actionId) {
      if (c === 'messages' && method === 'GET') return listPodMessages(request, env, actionId);
      if (c === 'messages' && method === 'POST') return postPodMessage(request, env, actionId);
      if (c === 'checkins' && method === 'GET') return listPodCheckins(request, env, actionId);
      if (c === 'checkins' && method === 'POST') return submitPodCheckin(request, env, actionId);
    }
    return null;
  }

  // --------------------------------------------------------------- intros
  if (a === 'intros') {
    if (has(segments, 'intros', 'profile') && method === 'GET') return introProfile(request, env);
    if (has(segments, 'intros', 'profile') && method === 'PUT') return saveIntroProfile(request, env);
    if (has(segments, 'intros', 'suggestions') && method === 'GET') return introSuggestions(request, env);
    if (has(segments, 'intros', 'requests') && method === 'POST') return createIntroRequest(request, env);
    if (has(segments, 'intros', 'requests', 'incoming') && method === 'GET') return listIntroRequests(request, env, 'incoming');
    if (has(segments, 'intros', 'requests', 'outgoing') && method === 'GET') return listIntroRequests(request, env, 'outgoing');
    const requestId = idAt(segments, 2, 4);
    if (requestId && b === 'requests') {
      if (d === 'accept' && method === 'POST') return respondToIntro(request, env, requestId, true);
      if (d === 'decline' && method === 'POST') return respondToIntro(request, env, requestId, false);
    }
    return null;
  }

  // --------------------------------------------------------- office hours
  if (a === 'office-hours') {
    if (has(segments, 'office-hours', 'slots') && method === 'GET') return listOpenSlots(request, env);
    if (has(segments, 'office-hours', 'slots') && method === 'POST') return createSlot(request, env);
    if (has(segments, 'office-hours', 'slots', 'mine') && method === 'GET') return listMySlots(request, env);
    if (has(segments, 'office-hours', 'bookings') && method === 'GET') return listMyBookings(request, env);
    if (has(segments, 'office-hours', 'payouts') && method === 'GET') return listOfficeHourPayouts(request, env);
    if (has(segments, 'office-hours', 'commission') && method === 'GET') return getCommissionBp(request, env);
    if (has(segments, 'office-hours', 'commission') && method === 'PUT') return saveCommissionBp(request, env);
    if (has(segments, 'office-hours', 'experts') && method === 'GET') return listExperts(request, env);

    const slotId = idAt(segments, 2, 4);
    if (slotId && b === 'slots') {
      if (d === 'cancel' && method === 'POST') return cancelSlot(request, env, slotId);
      if (d === 'book' && method === 'POST') {
        throw unavailable('Slot booking (no payment provider is configured)');
      }
    }
    const bookingId = idAt(segments, 2, 4);
    if (bookingId && b === 'bookings') {
      if (d === 'cancel' && method === 'POST') return cancelBooking(request, env, bookingId);
      if (d === 'meeting-link' && method === 'PUT') return setMeetingLink(request, env, bookingId);
    }
    const payoutId = idAt(segments, 2, 4);
    if (payoutId && b === 'payouts' && d === 'paid' && method === 'POST') return markPayoutPaid(request, env, payoutId);
    const memberId = idAt(segments, 2, 4);
    if (memberId && b === 'members' && d === 'expert' && method === 'PUT') return setExpert(request, env, memberId);
    return null;
  }

  // -------------------------------------------------------------- discord
  if (has(segments, 'discord', 'settings')) {
    if (method === 'GET') return discordSettings(request, env);
    if (method === 'PUT') return saveDiscordSettings(request, env);
  }
  if (has(segments, 'auth', 'discord', 'url') && method === 'GET') {
    throw unavailable('Discord sign-in (no Discord application is configured)');
  }
  if (has(segments, 'auth', 'discord') && method === 'POST') {
    throw unavailable('Discord sign-in (no Discord application is configured)');
  }

  return null;
}
