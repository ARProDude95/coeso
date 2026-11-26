import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAccountById } from "./store";

export const SESSION_COOKIE = "coeso_offers_session";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export type AccountRole = "admin" | "viewer";

export interface Session {
  id: string;
  username: string;
  role: AccountRole;
}

function secret(): string | null {
  return (
    process.env.ADMIN_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    null
  );
}

/** Whether the deployment has the keys needed to sign in at all. */
export function authConfigured(): boolean {
  return Boolean(secret());
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

export function sessionToken(accountId: string): string {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${accountId}.${expires}`;
  return `${payload}.${sign(payload, secret() ?? "")}`;
}

function readToken(value: string): string | null {
  const key = secret();
  if (!key) return null;

  const [accountId, expires, signature] = value.split(".");
  if (!accountId || !expires || !signature) return null;

  const expected = sign(`${accountId}.${expires}`, key);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  if (Number(expires) * 1000 < Date.now()) return null;

  return accountId;
}

/**
 * The signed-in account for this request, or null. Accounts are created by the
 * admin, so a missing/inactive row invalidates the cookie immediately.
 */
export async function getSession(): Promise<Session | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;

  const accountId = readToken(value);
  if (!accountId) return null;

  const account = await getAccountById(accountId);
  if (!account || account.active !== 1) return null;

  return {
    id: account.id,
    username: account.username,
    role: account.role,
  };
}

export async function isAdmin(): Promise<boolean> {
  return (await getSession())?.role === "admin";
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
