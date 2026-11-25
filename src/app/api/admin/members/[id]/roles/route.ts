import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/auth";
import { assignRole, InvalidRoleError, removeRole } from "@/lib/roles";
import { getUserById } from "@/lib/users";
import { memberRoleSchema } from "@/lib/validation";

/**
 * Admin-only: grant or revoke an access role on a member's account.
 *
 * Roles are plain slugs on the account (see src/lib/roles.ts) — the shape
 * Discord's API will fill in later, so nothing here has to change when the
 * sync lands.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    await requireAdminApi();
    const { id } = await params;
    const input = memberRoleSchema.parse(await readJson(request));

    const user = await getUserById(id);
    if (!user) throw new ApiError(404, "Account not found", "not_found");

    if (input.action === "add") {
      try {
        const role = await assignRole(id, input.role);
        return ok({ ok: true, action: "add", role });
      } catch (error) {
        if (error instanceof InvalidRoleError) {
          throw new ApiError(400, "That isn't a valid role", "invalid_role");
        }
        throw error;
      }
    }

    const removed = await removeRole(id, input.role);
    if (!removed) {
      throw new ApiError(
        404,
        "That member doesn't hold that role",
        "role_absent",
      );
    }
    return ok({ ok: true, action: "remove", role: input.role });
  });
}
