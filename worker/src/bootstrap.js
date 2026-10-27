// One-time, idempotent bootstrap for the hosted D1 (there is no manual SQL
// tool for the remote binding). On the first /api request, if `plans` is
// missing, apply the schema then the demo seed.
//
// D1's DB.exec() rejects a leading comment block and only accepts a single
// statement, so we normalize the SQL down to executable statements:
//   1. strip /* ... */ block comments,
//   2. drop `--` comments (full-line and trailing) while respecting quoted
//      string literals so content like 'a--b' survives,
//   3. split on ';' and drop PRAGMA / empty fragments,
// then exec each statement individually. The SQL uses
// CREATE ... IF NOT EXISTS / INSERT OR IGNORE, so a race is harmless.
import { SCHEMA_SQL, SEED_SQL } from './bootstrap-data.js';

// Remove `--` comments. Walking char-by-char, we track whether we're inside a
// single-quoted SQL string (handling the '' escape); a `--` outside a string
// starts a comment that runs to end of line.
function stripLineComments(sql) {
  let out = '';
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (next === "'") { out += next; i++; } else { inString = false; }
      }
      continue;
    }
    if (ch === "'") { inString = true; out += ch; continue; }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++; // skip to end of line
      out += '\n';                                    // keep the newline
      continue;
    }
    out += ch;
  }
  return out;
}

function stripBlockComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '');
}

export function toStatements(sql) {
  const cleaned = stripLineComments(stripBlockComments(sql));
  return cleaned
    .split(';')
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0 && !/^PRAGMA\b/i.test(stmt));
}

export async function ensureReady(env) {
  const db = env.DB;
  let ready = false;
  try {
    const row = await db.prepare('SELECT COUNT(*) AS n FROM plans').first();
    ready = !!row && Number(row.n) > 0;
  } catch {
    // `plans` not created yet -> empty database, fall through to bootstrap.
    ready = false;
  }
  if (ready) return { bootstrapped: false };

  for (const stmt of toStatements(SCHEMA_SQL)) {
    await db.prepare(stmt).run();
  }
  for (const stmt of toStatements(SEED_SQL)) {
    await db.prepare(stmt).run();
  }
  return { bootstrapped: true };
}
