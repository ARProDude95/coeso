import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  authConfigured,
  sessionCookieOptions,
  sessionToken,
} from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { getAccountCredentials, markAccountLogin } from "@/lib/store";

export async function POST(request: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    username?: unknown;
    password?: unknown;
  } | null;

  const username =
    typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const account = await getAccountCredentials(username);
  const allowed =
    account &&
    account.active === 1 &&
    verifyPassword(password, account.password_hash);

  if (!account || !allowed) {
    // Slow down guessing without leaking whether the username exists.
    await new Promise((resolve) => setTimeout(resolve, 250));
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  await markAccountLogin(account.id);

  const response = NextResponse.json({
    ok: true,
    role: account.role,
    redirectTo: account.role === "admin" ? "/admin" : "/offers",
  });
  response.cookies.set(
    SESSION_COOKIE,
    sessionToken(account.id),
    sessionCookieOptions(),
  );
  return response;
}
