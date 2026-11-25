import type { NextRequest } from "next/server";
import { created, ok, readJson, runApi } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import { listSavedSearches, createSavedSearch } from "@/lib/saved-searches";
import { savedSearchLimit } from "@/lib/tiers";
import { savedSearchCreateSchema } from "@/lib/validation";

/**
 * Saved searches (Pro/Elite). The tier limit is enforced in
 * `createSavedSearch`, so the 403 with `tier_required` / `limit_reached`
 * comes from one place.
 */
export async function GET() {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const searches = await listSavedSearches(ctx.user.id);
    const limit = savedSearchLimit(
      ctx.user.isAdmin ? "elite" : ctx.user.tier,
    );
    return ok({ searches, limit, tier: ctx.user.tier });
  });
}

export async function POST(request: NextRequest) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const input = savedSearchCreateSchema.parse(await readJson(request));
    const search = await createSavedSearch(ctx.user, input);
    return created({ search });
  });
}
