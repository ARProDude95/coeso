import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "./db";
import { getSetting, setSetting } from "./store";

/**
 * Application data lives in D1, where a cascading delete or a bad write takes
 * it with it. This module writes a full JSON snapshot into the site's R2 bucket
 * — separate storage from the database — once a day, keeps the last two weeks
 * and exposes the same snapshot as a download so the owner can also keep a copy
 * off the platform entirely.
 */

const PREFIX = "backups/coeso-offers-";
const KEEP = 14;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LAST_KEY = "backup_last_at";

/** The subset of the R2 API this app uses. */
interface R2BucketBinding {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  list(options?: {
    prefix?: string;
    limit?: number;
  }): Promise<{ objects: Array<{ key: string }> }>;
  delete(keys: string[]): Promise<unknown>;
}

export interface BackupPayload {
  app: "coeso-offers-board";
  version: 1;
  generated_at: string;
  counts: { offers: number; applications: number; accounts: number };
  offers: Record<string, unknown>[];
  applications: Record<string, unknown>[];
  accounts: Record<string, unknown>[];
}

async function filesBinding(): Promise<R2BucketBinding | null> {
  try {
    const context = await getCloudflareContext({ async: true });
    return (context.env as { FILES?: R2BucketBinding }).FILES ?? null;
  } catch {
    return null;
  }
}

/**
 * Every table, untruncated. Password hashes are deliberately left out: they are
 * not needed to restore the board and should not be copied around.
 */
export async function buildBackup(): Promise<BackupPayload> {
  // getSetting() runs the schema setup, so the tables below always exist.
  await getSetting(LAST_KEY);
  const db = await getDb();
  const [offers, applications, accounts] = await Promise.all([
    db.query("SELECT * FROM offers ORDER BY created_at ASC"),
    db.query("SELECT * FROM applications ORDER BY created_at ASC"),
    db.query(
      "SELECT id, username, role, active, created_at, last_login_at FROM accounts ORDER BY created_at ASC",
    ),
  ]);

  return {
    app: "coeso-offers-board",
    version: 1,
    generated_at: new Date().toISOString(),
    counts: {
      offers: offers.rows.length,
      applications: applications.rows.length,
      accounts: accounts.rows.length,
    },
    offers: offers.rows,
    applications: applications.rows,
    accounts: accounts.rows,
  };
}

export interface BackupResult {
  ok: boolean;
  key?: string;
  reason?: "no_bucket" | "failed";
}

/** Write one snapshot to R2, prune older ones, and record the time. */
export async function writeBackup(): Promise<BackupResult> {
  const bucket = await filesBinding();
  if (!bucket) return { ok: false, reason: "no_bucket" };

  try {
    const payload = await buildBackup();
    const stamp = payload.generated_at.replace(/[:.]/g, "-");
    const key = `${PREFIX}${stamp}.json`;

    await bucket.put(key, JSON.stringify(payload, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    // Newest first, then drop anything past the retention window.
    const listed = await bucket.list({ prefix: PREFIX, limit: 1000 });
    const stale = listed.objects
      .map((object) => object.key)
      .sort()
      .reverse()
      .slice(KEEP);
    if (stale.length > 0) await bucket.delete(stale);

    await setSetting(LAST_KEY, payload.generated_at);
    return { ok: true, key };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * Snapshots on demand at most once a day: the admin page calls this, so the
 * backup happens whenever the owner is actually looking at the board, and a
 * page reload does not hammer R2.
 */
export async function ensureDailyBackup(): Promise<BackupResult> {
  const last = await getSetting(LAST_KEY);
  if (last) {
    const age = Date.now() - new Date(last).getTime();
    if (Number.isFinite(age) && age < MAX_AGE_MS) {
      return { ok: true };
    }
  }
  return writeBackup();
}

export async function lastBackupAt(): Promise<string | null> {
  return getSetting(LAST_KEY);
}
