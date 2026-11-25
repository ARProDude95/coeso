import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/auth";
import { grantTier } from "@/lib/subscriptions";
import { getUserById } from "@/lib/users";
import { getDb } from "@/lib/d1";
import { billingGrantSchema } from "@/lib/validation";

/**
 * Admin-only manual tier override. Writes the authoritative subscription row
 * (`source = 'admin'`, status `granted`) so access is granted immediately, and
 * mirrors it onto `users.tier` so the legacy member list agrees.
 */
export async function POST(request: NextRequest) {
  return runApi(async () => {
    await requireAdminApi();
    const input = billingGrantSchema.parse(await readJson(request));

    const user = await getUserById(input.userId);
    if (!user) throw new ApiError(404, "Account not found", "not_found");

    const subscription = await grantTier(input.userId, input.tier);

    const db = await getDb();
    await db
      .prepare("UPDATE users SET tier = ? WHERE id = ?")
      .bind(input.tier, input.userId)
      .run();

    return ok({
      ok: true,
      tier: subscription.tier,
      status: subscription.status,
    });
  });
}
