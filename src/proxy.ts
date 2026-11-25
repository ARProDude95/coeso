import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/constants";

const PROTECTED_PREFIXES = [
  "/offers",
  "/applications",
  "/admin",
  // Member-only pages gated by `requireMember`. Covering them here keeps every
  // auth redirect a clean 307 with `?next=`, instead of the HTTP-200 soft
  // redirect a page-level `redirect()` produces once its Suspense shell has
  // started streaming — and it preserves the page the visitor came from.
  "/billing",
  "/deals",
  "/notifications",
  "/saved-searches",
  "/reps",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

async function hasValidSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET), {
      algorithms: ["HS256"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Optimistic gate only: it proves the cookie is signed and unexpired, which
 * saves rendering a protected shell for anonymous visitors. The authoritative
 * check lives in `requireMember` / `requireAdmin`.
 */
export async function proxy(request: NextRequest) {
  if (!isProtected(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const valid = await hasValidSession(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  if (valid) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(
    request.nextUrl.pathname + request.nextUrl.search,
  )}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/offers/:path*",
    "/applications/:path*",
    "/admin/:path*",
    "/billing",
    "/deals",
    "/notifications",
    "/saved-searches",
    // `/reps` alone has no page and should stay a 404, so match one segment
    // or more rather than zero.
    "/reps/:path+",
  ],
};
