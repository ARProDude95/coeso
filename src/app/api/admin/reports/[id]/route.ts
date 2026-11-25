import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/auth";
import { dismissReport } from "@/lib/reports";
import { reportActionSchema } from "@/lib/validation";

/** Admin-only: dismiss a report (lowering its offer's open count). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    await requireAdminApi();
    const { id } = await params;
    reportActionSchema.parse(await readJson(request));

    const dismissed = await dismissReport(id);
    if (!dismissed) {
      throw new ApiError(404, "Report not found or already dismissed", "not_found");
    }
    return ok({ ok: true });
  });
}
