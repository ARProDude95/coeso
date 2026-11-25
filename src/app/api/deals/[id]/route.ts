import { ApiError, ok, runApi } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import { deleteDeal } from "@/lib/deals";

/** Removes one of the signed-in rep's own logs; anyone else's is a 404. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const { id } = await params;

    const removed = await deleteDeal(id, ctx.user.id);
    if (!removed) throw new ApiError(404, "Deal not found", "not_found");

    return ok({ ok: true });
  });
}
