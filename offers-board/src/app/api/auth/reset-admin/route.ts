import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  MIN_RESET_PASSWORD_LENGTH,
  resetAdminPassword,
} from "@/lib/admin-reset";

/**
 * Owner lockout recovery endpoint.
 *
 * Public by necessity — the owner has no session by definition — so every
 * response is gated by the ADMIN_RESET_TOKEN secret and nothing is readable
 * without it. When the secret is unset this route answers 404 like any other
 * unknown path, so a normal deployment exposes nothing.
 */
const resetInput = z.object({
  token: z.string().min(1).max(500),
  password: z.string().min(1).max(200),
});

const FAILED_TOKEN_DELAY_MS = 400;

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const parsed = resetInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "invalid" }, 400);
  }

  const result = await resetAdminPassword(parsed.data);
  if (result.ok) {
    return json({ ok: true, username: result.username }, 200);
  }

  switch (result.error) {
    case "not_configured":
      // Indistinguishable from a path that does not exist.
      return json({ error: "not_found" }, 404);
    case "invalid_token":
      await new Promise((resolve) =>
        setTimeout(resolve, FAILED_TOKEN_DELAY_MS),
      );
      return json({ error: "invalid_token" }, 401);
    case "already_used":
      return json({ error: "already_used" }, 409);
    case "weak_password":
      return json(
        { error: "weak_password", minLength: MIN_RESET_PASSWORD_LENGTH },
        400,
      );
    case "no_admin":
      return json({ error: "no_admin" }, 409);
  }
}
