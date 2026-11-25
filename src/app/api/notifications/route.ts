import { ok, readJson, runApi } from "@/lib/api";
import { requireMemberApi } from "@/lib/auth";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications";
import type { NextRequest } from "next/server";
import { z } from "zod";

/**
 * The signed-in member's own notifications. Both actions are scoped to the
 * session user in SQL, so an id can never mark someone else's row read.
 */
export async function GET() {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const [notifications, unread] = await Promise.all([
      listNotifications(ctx.user.id),
      countUnreadNotifications(ctx.user.id),
    ]);
    return ok({ notifications, unread });
  });
}

const actionSchema = z.object({ id: z.string().min(1).optional() });

/** `{ id }` marks one read; an empty body marks all of them read. */
export async function POST(request: NextRequest) {
  return runApi(async () => {
    const ctx = await requireMemberApi();
    const body = actionSchema.parse(await readJson(request).catch(() => ({})));

    if (body.id) {
      await markNotificationRead(ctx.user.id, body.id);
    } else {
      await markAllNotificationsRead(ctx.user.id);
    }
    return ok({ ok: true });
  });
}
