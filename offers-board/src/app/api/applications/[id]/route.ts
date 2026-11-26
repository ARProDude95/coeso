import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { setApplicationStatus } from "@/lib/store";

const statusInput = z.object({ status: z.enum(["new", "reviewed"]) });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = statusInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { id } = await params;
  const updated = await setApplicationStatus(id, parsed.data.status);
  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, status: parsed.data.status });
}
