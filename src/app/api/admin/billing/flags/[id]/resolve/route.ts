import { ApiError, ok, runApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/auth";
import { resolveBillingFlag } from "@/lib/subscriptions";

/** Marks a billing flag as handled after the admin has fixed it on Whop. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runApi(async () => {
    await requireAdminApi();
    const { id } = await params;

    const resolved = await resolveBillingFlag(id);
    if (!resolved) throw new ApiError(404, "Flag not found", "not_found");

    return ok({ ok: true });
  });
}
