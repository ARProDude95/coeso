import type { Metadata } from "next";
import { NotificationsList } from "@/components/notifications-list";
import { requireMember } from "@/lib/auth";
import { listNotifications } from "@/lib/notifications";

export const metadata: Metadata = {
  title: "Notifications",
};

export default async function NotificationsPage() {
  const ctx = await requireMember();
  const notifications = await listNotifications(ctx.user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
          Notifications
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Alerts for this account — saved-search matches and admin notices.
        </p>
      </div>

      <NotificationsList
        initial={notifications.map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          body: item.body,
          offerId: item.offerId,
          read: item.readAt !== null,
          createdAt: item.createdAt,
        }))}
      />
    </div>
  );
}
