import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/auth";
import { getDb } from "@/lib/d1";
import { grantTier } from "@/lib/subscriptions";
import { getUserById, toTier } from "@/lib/users";
import { memberTierSchema } from "@/lib/validation";

/**
 * Admin-only: change a member's tier by hand.
 *
 * The subscription row is the source of truth for access, so this is written
 * as a `granted` override there and mirrored onto `users.tier` for the member
 * list. A later Whop webhook takes the subscription back over.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    await requireAdminApi();
    const { id } = await params;
    const input = memberTierSchema.parse(await readJson(request));

    const user = await getUserById(id);
    if (!user) throw new ApiError(404, "Account not found", "not_found");

    await grantTier(id, input.tier);

    const db = await getDb();
    await db
      .prepare("UPDATE users SET tier = ? WHERE id = ?")
      .bind(input.tier, id)
      .run();

    const updated = await getUserById(id);
    return ok({ ok: true, tier: toTier(updated?.tier) });
  });
}
