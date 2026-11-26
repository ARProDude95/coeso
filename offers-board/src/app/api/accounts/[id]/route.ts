import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { generatePassword } from "@/lib/password";
import {
  countAdmins,
  deleteAccount,
  getAccountById,
  setAccountActive,
  setAccountPassword,
} from "@/lib/store";

const patchInput = z.union([
  z.object({ action: z.literal("reset_password") }),
  z.object({ action: z.literal("set_active"), active: z.boolean() }),
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = patchInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { id } = await params;
  const account = await getAccountById(id);
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (parsed.data.action === "reset_password") {
    const password = generatePassword();
    await setAccountPassword(id, password);
    return NextResponse.json({ ok: true, account, password });
  }

  const { active } = parsed.data;
  if (!active && account.id === session.id) {
    return NextResponse.json({ error: "cannot_disable_self" }, { status: 400 });
  }
  if (!active && account.role === "admin" && (await countAdmins()) <= 1) {
    return NextResponse.json({ error: "last_admin" }, { status: 409 });
  }

  await setAccountActive(id, active);
  return NextResponse.json({ ok: true, active });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (id === session.id) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });
  }

  const account = await getAccountById(id);
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (account.role === "admin" && (await countAdmins()) <= 1) {
    return NextResponse.json({ error: "last_admin" }, { status: 409 });
  }

  await deleteAccount(id);
  return NextResponse.json({ ok: true });
}
