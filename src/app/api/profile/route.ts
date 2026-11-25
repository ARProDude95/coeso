import type { NextRequest } from "next/server";
import { ok, readJson, runApi } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import { setHideEarnings } from "@/lib/users";
import { profilePatchSchema } from "@/lib/validation";

/** Self-service profile setting: hide or show the earnings range. */
export async function PATCH(request: NextRequest) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const input = profilePatchSchema.parse(await readJson(request));

    await setHideEarnings(ctx.user.id, input.hideEarnings);
    return ok({ ok: true, hideEarnings: input.hideEarnings });
  });
}
