import type { Metadata } from "next";
import { SavedSearches } from "@/components/saved-searches";
import { requireMember } from "@/lib/auth";
import { listSavedSearches } from "@/lib/saved-searches";
import { savedSearchLimit, viewerCanUse } from "@/lib/tiers";

export const metadata: Metadata = {
  title: "Saved searches",
};

export default async function SavedSearchesPage() {
  const ctx = await requireMember();
  const searches = await listSavedSearches(ctx.user.id);
  const limit = savedSearchLimit(ctx.user.isAdmin ? "elite" : ctx.user.tier);

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
          Saved searches
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Save a filter set and get an in-app notification (plus a Discord DM
          when the bot is configured) whenever a matching offer is published.
        </p>
      </div>

      <SavedSearches
        initial={searches.map((search) => ({
          id: search.id,
          name: search.name,
          roleType: search.roleType,
          tier: search.tier,
          keywords: search.keywords,
          minCommission: search.minCommission,
        }))}
        limit={limit}
        isPaid={viewerCanUse(ctx.user, "pro")}
      />
    </div>
  );
}
