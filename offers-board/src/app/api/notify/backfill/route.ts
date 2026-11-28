import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { pushUnreadApplications } from "@/lib/notify";

/**
 * One-off catch-up for applications that arrived while the webhook was unset:
 * posts every application still marked `new` that Discord has not seen. Admin
 * only, and safe to press twice — already-delivered applications are skipped.
 */
export async function POST(request: NextRequest) {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await pushUnreadApplications(new URL(request.url).origin);

  return NextResponse.json(result, {
    status: result.error === "not_configured" ? 400 : 200,
    headers: { "cache-control": "no-store" },
  });
}
