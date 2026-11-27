import { createHash, timingSafeEqual } from "node:crypto";
import {
  getRecoveryAdmin,
  getSetting,
  setAccountActive,
  setAccountPassword,
  setSetting,
} from "./store";

/**
 * Owner lockout recovery.
 *
 * The board has no sign-up and only bootstraps an admin when the table is
 * empty, so losing the admin password used to be permanent. This module gives
 * one narrow way back in, gated entirely by a server-side secret:
 *
 *   - Nothing here runs unless ADMIN_RESET_TOKEN is set in the environment, so
 *     a normal deployment has no reset surface at all.
 *   - The token must be at least 32 characters, which makes guessing it
 *     through the public site impractical.
 *   - A token works once. Its SHA-256 is stored in `settings` after the first
 *     successful reset and that exact token is refused from then on. To reset
 *     again the owner sets a new token value.
 *   - The token is never stored in plaintext, never logged and never returned.
 */

const MIN_TOKEN_LENGTH = 32;
export const MIN_RESET_PASSWORD_LENGTH = 12;
const USED_KEY = "admin_reset_used";

/** The configured reset token, or null when the feature is switched off. */
export function configuredResetToken(): string | null {
  const token = process.env.ADMIN_RESET_TOKEN?.trim();
  if (!token || token.length < MIN_TOKEN_LENGTH) return null;
  return token;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time token comparison; length leaks nothing useful here. */
export function tokensMatch(candidate: string, expected: string): boolean {
  if (!candidate || !expected) return false;
  const a = digest(candidate);
  const b = digest(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type AdminResetError =
  | "not_configured"
  | "invalid_token"
  | "already_used"
  | "no_admin"
  | "weak_password";

export type AdminResetResult =
  | { ok: true; username: string }
  | { ok: false; error: AdminResetError };

export async function resetAdminPassword(input: {
  token: string;
  password: string;
}): Promise<AdminResetResult> {
  const expected = configuredResetToken();
  if (!expected) return { ok: false, error: "not_configured" };

  if (!tokensMatch(input.token, expected)) {
    return { ok: false, error: "invalid_token" };
  }

  const fingerprint = digest(expected).toString("hex");
  if ((await getSetting(USED_KEY)) === fingerprint) {
    return { ok: false, error: "already_used" };
  }

  if (
    input.password.length < MIN_RESET_PASSWORD_LENGTH ||
    input.password.length > 200 ||
    input.password.trim().length === 0
  ) {
    return { ok: false, error: "weak_password" };
  }

  const admin = await getRecoveryAdmin();
  if (!admin) return { ok: false, error: "no_admin" };

  await setAccountPassword(admin.id, input.password);
  // A disabled or previously deleted-permissions admin is back in control.
  await setAccountActive(admin.id, true);
  await setSetting(USED_KEY, fingerprint);

  return { ok: true, username: admin.username };
}
