import Link from "next/link";
import { Suspense } from "react";
import { getAuthContext } from "@/lib/auth";
import { CoesoLogo } from "./coeso-logo";
import { initials } from "@/lib/initials";
import { countUnreadNotifications } from "@/lib/notifications";
import { isPartnerRole } from "@/lib/partners";
import { getUserRoles } from "@/lib/roles";
import { UserMenu } from "./user-menu";

function Brand() {
  return (
    <Link href="/offers" className="flex items-center gap-2.5">
      <CoesoLogo className="h-8 w-auto" />
      <span className="text-[15px] font-medium tracking-tight text-zinc-400">
        Offers Board
      </span>
    </Link>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-zinc-700/70 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800/70 hover:text-white"
    >
      {children}
    </Link>
  );
}

/** Reads the session, so it streams in behind a boundary. */
async function HeaderContent() {
  const ctx = await getAuthContext();
  // The badge count and the role lookup only need the id, so they run
  // together — the tabs behind this boundary appear one round trip sooner.
  const [unread, roles] = await Promise.all([
    ctx ? countUnreadNotifications(ctx.user.id) : Promise.resolve(0),
    ctx && !ctx.user.isAdmin
      ? getUserRoles(ctx.user.id)
      : Promise.resolve([] as string[]),
  ]);
  const isPartner = ctx && !ctx.user.isAdmin ? isPartnerRole(roles) : false;

  return (
    <>
      <nav className="flex items-center gap-1 sm:gap-1.5">
        <NavLink href="/offers">Offers</NavLink>
        {ctx && <NavLink href="/applications">My applications</NavLink>}
        {ctx && <NavLink href="/deals">My deals</NavLink>}
        {ctx && <NavLink href="/leaderboard">Leaderboard</NavLink>}
        {ctx && <NavLink href="/billing">Billing</NavLink>}
        {ctx && (
          <NavLink href="/notifications">
            Alerts
            {unread > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </NavLink>
        )}
        {ctx && (ctx.user.isAdmin || isPartner) && (
          <NavLink href="/admin">{ctx.user.isAdmin ? "Admin" : "Partner"}</NavLink>
        )}
        <NavLink href="/pricing">Pricing</NavLink>
      </nav>

      <div className="flex items-center gap-2">
        {ctx ? (
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-semibold text-zinc-200">
                {initials(ctx.user.name)}
              </span>
              <span className="max-w-[9rem] truncate text-sm text-zinc-300">
                {ctx.user.name}
              </span>
            </div>
            <UserMenu name={ctx.user.name} />
          </div>
        ) : (
          <Link href="/login" className="btn btn-primary">
            Sign in
          </Link>
        )}
      </div>
    </>
  );
}

function HeaderFallback() {
  return (
    <>
      <div className="skeleton h-8 w-32" />
      <div className="skeleton ml-auto h-8 w-24" />
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Brand />
        <Suspense fallback={<HeaderFallback />}>
          <div className="flex flex-1 items-center justify-end gap-3 sm:gap-5">
            <HeaderContent />
          </div>
        </Suspense>
      </div>
    </header>
  );
}
