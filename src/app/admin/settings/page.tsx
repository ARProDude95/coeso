import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminHeader, AdminNav } from "@/components/admin-nav";
import { SettingsForm } from "@/components/settings-form";
import { requireAdminInStaff } from "@/lib/auth";
import { effectiveWebhookUrl, getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Settings",
};

async function BoardSettings() {
  await requireAdminInStaff();
  const settings = await getSettings();

  // Announcements use the stored URL first, then the DISCORD_WEBHOOK_URL
  // environment variable; the form needs to say which one is live.
  const envUrl = effectiveWebhookUrl(settings);
  const source: "settings" | "env" | "none" = settings.discordWebhookUrl
    ? "settings"
    : envUrl
      ? "env"
      : "none";

  return (
    <SettingsForm settings={settings} effectiveUrl={envUrl} source={source} />
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="skeleton h-40 w-full" />
      <div className="skeleton h-64 w-full" />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader
        title="Settings"
        description="Your plan, the Discord channel announcements, and role-gated offers."
      />
      <AdminNav current="settings" />
      <Suspense fallback={<SettingsSkeleton />}>
        <BoardSettings />
      </Suspense>
    </div>
  );
}
