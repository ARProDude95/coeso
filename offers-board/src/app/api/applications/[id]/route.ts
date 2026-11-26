import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getApplication,
  setApplicationStatus,
  setOfferStatus,
} from "@/lib/store";
import { applicationStatusInput } from "@/lib/validation";

/**
 * Admin-only status change. Marking an application hired closes its offer, so
 * a filled role never sits on the board collecting applications.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = applicationStatusInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { id } = await params;
  const application = await getApplication(id);
  if (!application) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const updated = await setApplicationStatus(id, parsed.data.status);
  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const offerClosed =
    parsed.data.status === "hired"
      ? await setOfferStatus(application.offer_id, "closed")
      : false;

  return NextResponse.json({
    ok: true,
    status: parsed.data.status,
    offerClosed,
  });
}
