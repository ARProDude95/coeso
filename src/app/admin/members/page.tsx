import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminHeader, AdminNav } from "@/components/admin-nav";
import { MemberRoles } from "@/components/member-roles";
import { MemberTier } from "@/components/member-tier";
import { requireAdminInStaff } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";
import { initials } from "@/lib/initials";
import { getRolesForUsers, listRolesInUse } from "@/lib/roles";
import { getTiersForUsers } from "@/lib/subscriptions";
import { listUsers, toTier } from "@/lib/users";

export const metadata: Metadata = {
  title: "Members",
};

async function MembersList() {
  const ctx = await requireAdminInStaff();
  const users = await listUsers();
  const [rolesByUser, suggestions, tierByUser] = await Promise.all([
    getRolesForUsers(users.map((user) => user.id)),
    listRolesInUse(),
    // Whop webhooks write the subscription, not `users.tier`; show the tier
    // that access actually uses and fall back for accounts that never
    // subscribed.
    getTiersForUsers(users.map((user) => user.id)),
  ]);

  if (users.length === 0) {
    return (
      <div className="panel px-6 py-12 text-center">
        <p className="text-sm text-zinc-400">No accounts yet.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {users.map((user) => {
        const isAdmin = user.is_admin === 1;
        return (
          <li key={user.id} className="panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={
                  isAdmin
                    ? "flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white"
                    : "flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-sm font-bold text-zinc-300"
                }
                aria-hidden
              >
                {initials(user.name)}
              </span>

              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-zinc-50">
                  <span className="truncate">{user.name}</span>
                  {user.id === ctx.user.id && (
                    <span className="text-xs font-normal text-zinc-500">
                      (you)
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {user.email} · joined {formatDate(user.created_at)} ·{" "}
                  {formatRelative(user.created_at)}
                </p>
              </div>

              {isAdmin && <span className="badge badge-accent ml-auto">Admin</span>}
            </div>

            <MemberRoles
              userId={user.id}
              roles={rolesByUser.get(user.id) ?? []}
              suggestions={suggestions}
            />

            <MemberTier
              userId={user.id}
              tier={tierByUser.get(user.id) ?? toTier(user.tier)}
            />
          </li>
        );
      })}
    </ul>
  );
}

function MembersSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="skeleton h-32 w-full" />
      ))}
    </div>
  );
}

export default function MembersPage() {
  return (
    <div className="flex flex-col gap-6">
      <AdminHeader
        title="Members"
        description="Every account on this board, and the access roles each one holds."
      />
      <AdminNav current="members" />
      <Suspense fallback={<MembersSkeleton />}>
        <MembersList />
      </Suspense>
    </div>
  );
}
