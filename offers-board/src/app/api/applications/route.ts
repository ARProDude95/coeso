import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listApplications } from "@/lib/store";

export async function GET() {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ applications: await listApplications() });
}
