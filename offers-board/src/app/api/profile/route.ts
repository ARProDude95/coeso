import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { saveProfile } from "@/lib/store";
import { profileInput } from "@/lib/validation";

/**
 * Members write only their own profile. The account id comes from the session
 * cookie, never from the request body.
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = profileInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const profile = await saveProfile(session.id, parsed.data);
  return NextResponse.json({ profile });
}
