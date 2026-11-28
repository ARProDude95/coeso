import type { Metadata } from "next";
import Link from "next/link";
import { NavProgress } from "@/components/nav-progress";
import { SiteNav } from "@/components/site-nav";
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
        {/* A route change waits on D1; this is the only cue until it lands. */}
        <NavProgress />
        <header className="header-sheen sticky top-0 z-20 border-b border-line bg-ink/80 backdrop-blur-md">
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
            <SiteNav
              session={
                session
                  ? { username: session.username, role: session.role }
                  : null
              }
            />
          </div>
        </header>

        <ToastProvider>{children}</ToastProvider>

        <footer className="relative mt-24 border-t border-line">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line-bright/70 to-transparent"
          />
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
