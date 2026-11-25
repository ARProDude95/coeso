/**
 * `node:sqlite` is available in Node 24 at runtime, but this project's
 * @types/node pin predates its declarations. Only the surface the test adapter
 * uses is declared here.
 */
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): { changes: number | bigint };
    };
    close(): void;
  }
}
