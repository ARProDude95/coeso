import { DatabaseSync } from "node:sqlite";
import { BILLING_SCHEMA } from "../../src/lib/billing-schema";
import type {
  D1Database,
  D1Result,
  D1Statement,
} from "../../src/lib/d1";

/**
 * A tiny D1-compatible adapter over Node's built-in SQLite, used only by the
 * billing tests. It supports the exact surface `src/lib/subscriptions.ts`
 * uses (`prepare/bind/first/all/run` and `batch`), against a real SQLite
 * engine — so the conditional founding-slot claim and the `INSERT OR IGNORE`
 * idempotency check are tested as SQL, not as mocks.
 */

interface SqliteRunResult {
  changes: number | bigint;
}

interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): SqliteRunResult;
}

class MemoryStatement implements D1Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  private statement(): SqliteStatement {
    return this.db.prepare(this.sql) as unknown as SqliteStatement;
  }

  bind(...values: unknown[]): D1Statement {
    return new MemoryStatement(this.db, this.sql, values);
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.statement().get(...this.params);
    return (row as T | undefined) ?? null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const rows = this.statement().all(...this.params) as T[];
    return { success: true, results: rows };
  }

  async run(): Promise<D1Result<unknown>> {
    const result = this.statement().run(...this.params);
    return {
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }
}

class MemoryD1 implements D1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): D1Statement {
    return new MemoryStatement(this.db, sql);
  }

  async batch<T = unknown>(
    statements: D1Statement[],
  ): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push((await statement.all<T>()) as D1Result<T>);
    }
    return results;
  }
}

/** Fresh in-memory database with the users and billing tables created. */
export async function createBillingDb(): Promise<D1Database> {
  const sqlite = new DatabaseSync(":memory:");
  // These tests exercise billing statements; accounts are managed elsewhere,
  // so don't make every fixture insert five users just to satisfy the FK.
  sqlite.exec("PRAGMA foreign_keys = OFF");
  const db = new MemoryD1(sqlite);
  // Billing rows reference accounts, and the admin flag query joins them.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
         id    TEXT PRIMARY KEY,
         name  TEXT NOT NULL,
         email TEXT NOT NULL
       )`,
    )
    .run();
  for (const statement of BILLING_SCHEMA) {
    await db.prepare(statement).run();
  }
  return db;
}
