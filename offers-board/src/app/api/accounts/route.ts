import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { generatePassword } from "@/lib/password";
import { createAccount, getAccountCredentials, listAccounts } from "@/lib/store";
import { accountInput } from "@/lib/validation";

export async function GET() {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ accounts: await listAccounts() });
}

export async function POST(request: NextRequest) {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = accountInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (await getAccountCredentials(parsed.data.username)) {
    return NextResponse.json({ error: "username_taken" }, { status: 409 });
  }

  const password = generatePassword();
  const account = await createAccount({
    username: parsed.data.username,
    password,
    role: parsed.data.role,
  });

  // The plaintext password is returned exactly once, for the admin to send on.
  return NextResponse.json({ account, password }, { status: 201 });
}
