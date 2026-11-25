import type { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import { deleteSavedSearch, updateSavedSearch } from "@/lib/saved-searches";
import { savedSearchPatchSchema } from "@/lib/validation";

/** Owner-scoped: the user id is always the session's, never the body's. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const { id } = await params;
    const patch = savedSearchPatchSchema.parse(await readJson(request));

    const search = await updateSavedSearch(ctx.user.id, id, patch);
    if (!search) {
      throw new ApiError(404, "Saved search not found", "not_found");
    }
    return ok({ search });
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const { id } = await params;

    const deleted = await deleteSavedSearch(ctx.user.id, id);
    if (!deleted) {
      throw new ApiError(404, "Saved search not found", "not_found");
    }
    return ok({ ok: true });
  });
}
