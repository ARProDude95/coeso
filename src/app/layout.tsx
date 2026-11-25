import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Coeso Offers Board",
    template: "%s · Coeso Offers Board",
  },
  description:
    "Private job board for Coeso sales reps — find and apply to setter and closer offers.",
};

function HeaderFallback() {
  return (
    <div className="flex w-full items-center justify-between gap-4">
      <div className="skeleton h-8 w-36" />
      <div className="skeleton h-8 w-40" />
    </div>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Suspense fallback={<HeaderFallback />}>
          <SiteHeader />
        </Suspense>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </main>
        <footer className="border-t border-zinc-800/80 py-6">
          <p className="mx-auto w-full max-w-6xl px-4 text-xs text-zinc-500 sm:px-6">
            Coeso Offers Board — a private board for Coeso reps. Accounts use an
            email and password; no third-party login is involved.
          </p>
        </footer>
      </body>
    </html>
  );
}
