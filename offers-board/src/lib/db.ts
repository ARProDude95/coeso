import { getCloudflareContext } from "@opennextjs/cloudflare";

export type SqlValue = string | number | null;

export interface QueryResult {
  rows: Record<string, unknown>[];
  changes: number;
}

export interface Db {
  query(sql: string, params?: SqlValue[]): Promise<QueryResult>;
}

/** The subset of the D1 API this app uses. */
interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{
    results?: T[];
    meta?: { changes?: number };
  }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

interface D1DatabaseBinding {
  prepare(sql: string): D1PreparedStatement;
}

const globalForDb = globalThis as unknown as { __coesoOffersDb?: Promise<Db> };

/**
 * One database handle per isolate. The board runs on Freebuff Sites, so the
 * database is the bound D1 database (`DB`) for both the deployed worker and
 * `next dev` through initOpenNextCloudflareForDev in next.config.ts.
 */
export function getDb(): Promise<Db> {
  globalForDb.__coesoOffersDb ??= createDb().catch((error: unknown) => {
    globalForDb.__coesoOffersDb = undefined;
    throw error;
  });
  return globalForDb.__coesoOffersDb;
}

async function createDb(): Promise<Db> {
  const context = await getCloudflareContext({ async: true });
  const binding = (context.env as { DB?: D1DatabaseBinding }).DB;
  if (!binding) {
    throw new Error(
      "[db] The DB D1 binding is missing. Provision it for this site environment and redeploy.",
    );
  }
  return d1(binding);
}

function d1(database: D1DatabaseBinding): Db {
  return {
    async query(sql, params = []) {
      const prepared = params.length
        ? database.prepare(sql).bind(...params)
        : database.prepare(sql);

      if (/^\s*(select|with|pragma)\b/i.test(sql)) {
        const result = await prepared.all();
        return { rows: result.results ?? [], changes: 0 };
      }

      const result = await prepared.run();
      return { rows: [], changes: Number(result.meta?.changes ?? 0) };
    },
  };
}
