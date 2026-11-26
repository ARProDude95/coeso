import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { createOffer, listOffers } from "@/lib/store";
import { offerInput } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const includeClosed =
    session.role === "admin" &&
    request.nextUrl.searchParams.get("all") === "1";
  const offers = await listOffers({ includeClosed });
  return NextResponse.json({ offers });
}

export async function POST(request: NextRequest) {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = offerInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const offer = await createOffer(parsed.data);
  return NextResponse.json({ offer }, { status: 201 });
}
