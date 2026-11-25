import { ok, runApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/auth";
import { listReports } from "@/lib/reports";

/** Admin-only list of every report, newest first. */
export async function GET() {
  return runApi(async () => {
    await requireAdminApi();
    return ok({ reports: await listReports() });
  });
}
