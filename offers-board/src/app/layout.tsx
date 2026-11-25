import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coeso Offers Board — setter and closer roles",
  description:
    "Open setter and closer offers from businesses inside Coeso. Find a role, see the split, apply in under a minute.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
            <Link href="/offers" className="group flex items-baseline gap-3">
              <span className="font-display text-xl tracking-[0.18em]">
                COESO
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-mute transition group-hover:text-ember">
                Offers Board
              </span>
            </Link>
            <nav className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.22em] text-mute sm:gap-7">
              <a href="https://coeso.biz" className="hover:text-paper">
                Coeso
              </a>
              <Link href="/offers" className="hover:text-paper">
                Board
              </Link>
              <Link href="/offers/admin" className="hover:text-paper">
                Admin
              </Link>
            </nav>
          </div>
        </header>

        {children}

        <footer className="mt-24 border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-xs text-mute sm:flex-row sm:items-center sm:justify-between">
            <span>
              Coeso Offers Board — a product of{" "}
              <a className="underline hover:text-paper" href="https://coeso.biz">
                coeso.biz
              </a>
            </span>
            <span className="font-mono uppercase tracking-[0.22em]">
              Setters · Closers · Deals
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
