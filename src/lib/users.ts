import "server-only";
import { getDb } from "./d1";
import { handleFromEmail, slugifyHandle, uniqueHandle } from "./reps";
import type { Tier, User } from "./types";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
  tier: string | null;
  discord_id: string | null;
  username: string | null;
  hide_earnings: number;
}

/** Unknown tiers fall back to `free`, so a bad row can never grant access. */
export function toTier(value: string | null | undefined): Tier {
  return value === "pro" || value === "elite" ? value : "free";
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: row.is_admin === 1,
    tier: toTier(row.tier),
    username: row.username ?? slugifyHandle(handleFromEmail(row.email)),
    hideEarnings: row.hide_earnings === 1,
    createdAt: row.created_at,
  };
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const db = await getDb();
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function getUserByUsername(
  username: string,
): Promise<UserRow | null> {
  const db = await getDb();
  return db
    .prepare(
      "SELECT * FROM users WHERE lower(username) = lower(?) ORDER BY created_at ASC",
    )
    .bind(username.trim())
    .first<UserRow>();
}

/** Every handle in use — used to pick a collision-free handle at signup. */
async function listUsernames(): Promise<string[]> {
  const db = await getDb();
  const { results } = await db
    .prepare("SELECT username FROM users WHERE username IS NOT NULL")
    .all<{ username: string }>();
  return (results ?? []).map((row) => row.username);
}

/** Rep hides or shows the earnings range on their public profile. */
export async function setHideEarnings(
  userId: string,
  hide: boolean,
): Promise<void> {
  const db = await getDb();
  await db
    .prepare("UPDATE users SET hide_earnings = ? WHERE id = ?")
    .bind(hide ? 1 : 0, userId)
    .run();
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const db = await getDb();
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(normaliseEmail(email))
    .first<UserRow>();
}

/** Every account, oldest first — powers the admin members page. */
export async function listUsers(): Promise<UserRow[]> {
  const db = await getDb();
  const { results } = await db
    .prepare("SELECT * FROM users ORDER BY created_at ASC")
    .all<UserRow>();
  return results ?? [];
}

/**
 * Creates an account. The very first account becomes the admin, so a fresh
 * deployment always has exactly one owner without shipping a default password.
 */
export async function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
}): Promise<UserRow> {
  const db = await getDb();

  const existing = await getUserByEmail(input.email);
  if (existing) throw new Error("EMAIL_TAKEN");

  const { count } = (await db
    .prepare("SELECT COUNT(*) AS count FROM users")
    .first<{ count: number }>()) ?? { count: 0 };

  const username = uniqueHandle(
    handleFromEmail(input.email),
    await listUsernames(),
  );

  const row: UserRow = {
    id: crypto.randomUUID(),
    email: normaliseEmail(input.email),
    name: input.name,
    password_hash: input.passwordHash,
    is_admin: count === 0 ? 1 : 0,
    created_at: new Date().toISOString(),
    tier: "free",
    discord_id: null,
    username,
    hide_earnings: 0,
  };

  await db
    .prepare(
      `INSERT INTO users (
         id, email, name, password_hash, is_admin, created_at, username,
         hide_earnings
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.email,
      row.name,
      row.password_hash,
      row.is_admin,
      row.created_at,
      row.username,
      row.hide_earnings,
    )
    .run();

  return row;
}
