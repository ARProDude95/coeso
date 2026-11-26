import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SqlValue = string | number | null;

export interface QueryResult {
  rows: Record<string, unknown>[];
  changes: number;
}

export interface Db {
  query(sql: string, params?: SqlValue[]): Promise<QueryResult>;
}

const globalForDb = globalThis as unknown as { __coesoOffersDb?: Promise<Db> };

/**
 * One database handle per process. Local development and any Node host use a
 * SQLite file through Node's built-in driver; on Vercel (read-only filesystem)
 * set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN to talk to Turso over HTTP.
 */
export function getDb(): Promise<Db> {
  globalForDb.__coesoOffersDb ??= createDb().catch((error: unknown) => {
    globalForDb.__coesoOffersDb = undefined;
    throw error;
  });
  return globalForDb.__coesoOffersDb;
}

async function createDb(): Promise<Db> {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  if (url && token) return remote(url, token);
  return local();
}

function local(): Db {
  const file =
    process.env.LOCAL_DB_PATH?.trim() ||
    join(process.cwd(), ".data", "offers.db");
  mkdirSync(dirname(file), { recursive: true });

  const database = new DatabaseSync(file);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");

  return {
    async query(sql, params = []) {
      const statement = database.prepare(sql);
      if (/^\s*(select|with|pragma)\b/i.test(sql)) {
        // node:sqlite rows have a null prototype, which React refuses to pass
        // from a Server Component to a Client Component — copy them plain.
        const rows = statement
          .all(...params)
          .map((row) => ({ ...(row as Record<string, unknown>) }));
        return { rows, changes: 0 };
      }
      const info = statement.run(...params);
      return { rows: [], changes: Number(info.changes) };
    },
  };
}

async function remote(url: string, token: string): Promise<Db> {
  const { createClient } = await import("@libsql/client/web");
  const client = createClient({ url, authToken: token });

  return {
    async query(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      const rows = result.rows.map((row) => {
        const out: Record<string, unknown> = {};
        result.columns.forEach((column, index) => {
          out[column] = (row as unknown as unknown[])[index];
        });
        return out;
      });
      return { rows, changes: result.rowsAffected };
    },
  };
}
