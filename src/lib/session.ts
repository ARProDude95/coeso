import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "./constants";

export { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS };

/**
 * Deliberately tiny payload: the database row is the source of truth for the
 * account (email, name, admin flag), which is re-read on every request.
 */
export interface SessionPayload {
  /** user.id */
  uid: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function createSession(uid: string): Promise<void> {
  const token = await new SignJWT({ uid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret());

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    if (typeof payload.uid !== "string") return null;
    return { uid: payload.uid };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
