import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth";
import { initials } from "@/lib/initials";
import { currentMonth, monthLabel } from "@/lib/leaderboard";
import {
  listAwards,
  listMonthlyEntries,
  previousMonthSummary,
  syncLeaderboardAwards,
} from "@/lib/leaderboard-data";
import { pluralise } from "@/lib/format";

export const metadata: Metadata = {
  title: "Leaderboard",
};

async function Board() {
  const ctx = await requireMember();
  const month = currentMonth();

  // Lazy month-end job: revoke last month's roles and award this month's top
  // three. Both are idempotent, so every read is safe (PROGRESS #8).
  await syncLeaderboardAwards(month);

  const [entries, awards, previous] = await Promise.all([
    listMonthlyEntries(month),
    listAwards(month),
    previousMonthSummary(month),
  ]);

  const rankByUser = new Map(awards.map((award) => [award.userId, award.rank]));
  const viewerRank = entries.findIndex((entry) => entry.userId === ctx.user.id);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">
            Monthly leaderboard
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">
            {monthLabel(month)}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Ranked by deals closed. The top three get the Top Closer role in
            Discord until the month ends.
          </p>
        </div>
        {viewerRank >= 0 && (
          <div className="panel px-4 py-3 text-sm">
            <span className="text-zinc-500">Your position</span>{" "}
            <span className="font-semibold text-zinc-100">
              #{viewerRank + 1}
            </span>{" "}
            <span className="text-zinc-500">
              · {pluralise(entries[viewerRank].deals, "deal")}
            </span>
          </div>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="panel px-6 py-12 text-center">
          <p className="text-sm text-zinc-400">
            No deals logged this month yet.{" "}
            <Link href="/deals" className="text-indigo-300 hover:text-indigo-200">
              Log your first one
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-3 font-medium">#</th>
                <th className="px-5 py-3 font-medium">Rep</th>
                <th className="px-5 py-3 text-right font-medium">Deals</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const rank = rankByUser.get(entry.userId);
                return (
                  <tr
                    key={entry.userId}
                    className={`border-b border-zinc-800/60 last:border-0 ${
                      entry.userId === ctx.user.id ? "bg-indigo-950/20" : ""
                    }`}
                  >
                    <td className="px-5 py-3 tabular-nums text-zinc-400">
                      {index + 1}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/reps/${entry.username}`}
                        className="flex items-center gap-2.5 text-zinc-100 hover:text-indigo-300"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-semibold text-zinc-200">
                          {initials(entry.name)}
                        </span>
                        <span className="font-medium">{entry.name}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-zinc-100">
                      {entry.deals}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {rank && rank <= 3 && (
                        <span className="badge badge-featured">
                          Top Closer
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          {monthLabel(previous.month)} winners
        </h2>
        {previous.awards.length === 0 ? (
          <div className="panel px-6 py-8 text-center">
            <p className="text-sm text-zinc-400">
              No awards recorded for {monthLabel(previous.month)}.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {previous.awards.map((award) => {
              const entry = previous.entries.find(
                (candidate) => candidate.userId === award.userId,
              );
              return (
                <li
                  key={award.id}
                  className="panel flex flex-wrap items-center gap-3 p-4"
                >
                  <span className="badge badge-featured">#{award.rank}</span>
                  <span className="text-sm font-medium text-zinc-100">
                    {entry?.name ?? "Member"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {pluralise(entry?.deals ?? 0, "deal")} ·{" "}
                    {award.revokedAt
                      ? "role returned at month end"
                      : "role active"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-zinc-500">
        The award job runs when this page is opened. Winners get an in-app
        notice and, when{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5">
          TOP_CLOSER_ROLE_ID
        </code>{" "}
        and the Discord bot are configured, the role itself.
      </p>
    </>
  );
}

export default function LeaderboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="skeleton h-96 w-full" />}>
        <Board />
      </Suspense>
    </div>
  );
}
