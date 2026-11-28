"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";

/** `/offers/:id` belongs to Board just as much as `/offers` does. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  pathname,
  children,
}: {
  href: string;
  pathname: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-active={isActive(pathname, href)}
      className="nav-link"
    >
      {children}
    </Link>
  );
}

/**
 * The header nav is its own client component so the current page can carry a
 * warm underline — the session is passed in already resolved by the layout.
 */
export function SiteNav({
  session,
}: {
  session: { username: string; role: "admin" | "viewer" } | null;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.22em] text-mute sm:gap-6">
      <a href="https://coeso.biz" className="nav-link">
        Coeso
      </a>
      {session ? (
        <>
          <NavLink href="/offers" pathname={pathname}>
            Board
          </NavLink>
          <NavLink href="/applications" pathname={pathname}>
            My applications
          </NavLink>
          {/* "Control room" not "Admin": the signed-in username sits right
              beside this link and the nav is uppercased, so an admin account
              called admin read "ADMIN ADMIN". */}
          {session.role === "admin" ? (
            <NavLink href="/admin" pathname={pathname}>
              Control room
            </NavLink>
          ) : null}
          {/* The username is the way into the member's own profile, so it
              stays visible on small screens too. */}
          <Link
            href="/profile"
            data-active={isActive(pathname, "/profile")}
            className="nav-link text-paper/70"
            title="Your profile"
          >
            {session.username}
          </Link>
          <LogoutButton />
        </>
      ) : (
        <Link
          href="/login"
          className="rounded-full border border-ember/60 px-3 py-1.5 text-ember transition hover:bg-ember hover:text-ink"
        >
          Sign in
        </Link>
      )}
    </nav>
  );
}
