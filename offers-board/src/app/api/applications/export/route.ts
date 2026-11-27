import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listAllApplications } from "@/lib/store";

const COLUMNS = [
  "received_at",
  "status",
  "member",
  "email",
  "discord",
  "account",
  "offer",
  "company",
  "hours_per_week",
  "experience",
  "message",
  "application_id",
  "offer_id",
] as const;

/**
 * One CSV cell. Values are quoted, embedded quotes are doubled, and a leading
 * =, +, - or @ is neutralised so a spreadsheet cannot treat a member-supplied
 * string as a formula.
 */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\r\n]/.test(safe) || /^\s|\s$/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export async function GET() {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const applications = await listAllApplications();

  const rows = applications.map((application) =>
    [
      application.created_at,
      application.status,
      application.name,
      application.email,
      application.discord,
      application.account_username,
      application.offer_title ?? "",
      application.offer_company ?? "",
      application.availability_hours,
      application.experience,
      application.message,
      application.id,
      application.offer_id,
    ]
      .map(cell)
      .join(","),
  );

  // The BOM makes Excel read the file as UTF-8; CRLF is what it expects.
  const body = `\uFEFF${COLUMNS.join(",")}\r\n${rows.join("\r\n")}\r\n`;
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="coeso-applications-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
