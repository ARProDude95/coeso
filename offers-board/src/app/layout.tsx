import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { ToastProvider } from "@/components/toast";
import { getSession } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coeso Offers Board — setter and closer roles",
  description:
    "Private setter and closer offers from businesses inside Coeso. Access is invite-only.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();

  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
            <Link href="/offers" className="group flex items-center gap-3">
              {/* Wordmark: the supplied logo, trimmed and keyed to sit on any
                  background. Rendered as a plain img so no image optimiser is
                  needed on the Workers runtime. */}
              <img
                src="/coeso-logo.png"
                alt="Coeso"
                width={525}
                height={120}
                className="h-5 w-auto"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-mute transition group-hover:text-ember">
                Offers Board
              </span>
            </Link>
            <nav className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.22em] text-mute sm:gap-6">
              <a href="https://coeso.biz" className="hover:text-paper">
                Coeso
              </a>
              {session ? (
                <>
                  <Link href="/offers" className="hover:text-paper">
                    Board
                  </Link>
                  <Link href="/applications" className="hover:text-paper">
                    My applications
                  </Link>
                  {/* "Control room" not "Admin": the signed-in username sits
                      right beside this link and the nav is uppercased, so an
                      admin account called admin read "ADMIN ADMIN". */}
                  {session.role === "admin" ? (
                    <Link href="/admin" className="hover:text-paper">
                      Control room
                    </Link>
                  ) : null}
                  <span className="hidden text-paper/70 sm:inline">
                    {session.username}
                  </span>
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
          </div>
        </header>

        <ToastProvider>{children}</ToastProvider>

        <footer className="mt-24 border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-xs text-mute sm:flex-row sm:items-center sm:justify-between">
            <span>
              Coeso Offers Board — a product of{" "}
              <a className="underline hover:text-paper" href="https://coeso.biz">
                coeso.biz
              </a>
            </span>
            <span className="font-mono uppercase tracking-[0.22em]">
              Invite only · Discord a1rymn
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
