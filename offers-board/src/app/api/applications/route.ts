import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createApplication, getOffer, listApplications } from "@/lib/store";
import { applicationInput } from "@/lib/validation";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ applications: await listApplications() });
}

export async function POST(request: NextRequest) {
  const parsed = applicationInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const offer = await getOffer(parsed.data.offer_id);
  if (!offer) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (offer.status !== "open") {
    return NextResponse.json({ error: "offer_closed" }, { status: 409 });
  }

  const application = await createApplication(parsed.data);
  return NextResponse.json(
    { application: { id: application.id } },
    { status: 201 },
  );
}
