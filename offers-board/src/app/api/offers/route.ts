import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createOffer, listOffers } from "@/lib/store";
import { offerInput } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const includeClosed =
    request.nextUrl.searchParams.get("all") === "1" && (await isAdmin());
  const offers = await listOffers({ includeClosed });
  return NextResponse.json({ offers });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
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
