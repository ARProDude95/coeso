import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildBackup, writeBackup } from "@/lib/backup";

/**
 * The off-site path: the owner downloads the whole board as one JSON file and
 * keeps it wherever they like. The download also refreshes the R2 snapshot, so
 * taking a copy by hand keeps the stored one current.
 */
export async function GET() {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await writeBackup();
  const payload = await buildBackup();
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="coeso-offers-backup-${today}.json"`,
      "cache-control": "no-store",
    },
  });
}
