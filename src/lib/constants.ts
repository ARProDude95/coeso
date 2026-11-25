/**
 * Runtime-agnostic constants shared by server code *and* the Next proxy.
 * Kept out of `session.ts` so the proxy never pulls in a `server-only` module.
 */
export const SESSION_COOKIE = "coeso_session";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
