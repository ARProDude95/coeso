import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/auth";
import { getSettings, updateSettings } from "@/lib/settings";
import { settingsPatchSchema } from "@/lib/validation";

/** Admin-only board settings: the plan flag and the Discord channel webhook. */
export async function GET() {
  return runApi(async () => {
    await requireAdminApi();
    return ok({ settings: await getSettings() });
  });
}

export async function PATCH(request: NextRequest) {
  return runApi(async () => {
    await requireAdminApi();
    const patch = settingsPatchSchema.parse(await readJson(request));
    if (Object.keys(patch).length === 0) {
      throw new ApiError(400, "No fields to update", "empty_patch");
    }

    // The webhook is configured against the plan the board is moving *to*,
    // so saving the plan and the URL together works, while configuring a
    // webhook on a board that stays free does not.
    const nextPlan = patch.plan ?? (await getSettings()).plan;
    if (patch.discordWebhookUrl && nextPlan !== "paid") {
      throw new ApiError(
        403,
        "Discord announcements are part of the paid plan",
        "upgrade_required",
      );
    }

    return ok({ settings: await updateSettings(patch) });
  });
}
