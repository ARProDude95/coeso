import { NextResponse } from "next/server";
import { runApi } from "@/lib/api";
import { destroySession } from "@/lib/session";

export async function POST() {
  return runApi(async () => {
    await destroySession();
    return NextResponse.json({ ok: true });
  });
}
