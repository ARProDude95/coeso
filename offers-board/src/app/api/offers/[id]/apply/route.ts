import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { notifyNewApplication } from "@/lib/notify";
import {
  createApplication,
  getOffer,
  hasAppliedForOffer,
} from "@/lib/store";
import { memberApplicationInput } from "@/lib/validation";

/**
 * Signed-in members apply to a single offer. The applicant's identity comes
 * from the session, never from the request body.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const offer = await getOffer(id);
  if (!offer) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (offer.status !== "open") {
    return NextResponse.json({ error: "closed" }, { status: 409 });
  }

  if (await hasAppliedForOffer(id, session.id)) {
    return NextResponse.json({ error: "already_applied" }, { status: 409 });
  }

  const parsed = memberApplicationInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // null means the unique index rejected a second row: another tab or a repeat
  // double-submit got there first, so the member sees the same message.
  const application = await createApplication(
    {
      offer_id: id,
      name: session.username,
      email: parsed.data.email,
      discord: parsed.data.discord,
      experience: parsed.data.experience,
      availability_hours: parsed.data.availability_hours,
      message: parsed.data.message,
    },
    { id: session.id, username: session.username },
  );

  if (!application) {
    return NextResponse.json({ error: "already_applied" }, { status: 409 });
  }

  await notifyNewApplication({
    application,
    offer,
    origin: new URL(request.url).origin,
  });

  return NextResponse.json({ application }, { status: 201 });
}
