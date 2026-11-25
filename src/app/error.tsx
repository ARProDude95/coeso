"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Root error boundary. Catches unexpected errors thrown while rendering any
 * page below the root layout, so members see a branded recovery screen with a
 * retry instead of Next's bare default. The error is logged here (production
 * server errors are also visible in the Worker logs, keyed by `digest`).
 */
export default function Error({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[page] render failed:", error);
  }, [error]);

  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-5xl font-semibold tracking-tight text-zinc-700">!</p>
      <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm leading-6 text-zinc-400">
        This page failed to load. It may be a temporary problem — try again, or
        head back to the board.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          Try again
        </button>
        <Link href="/offers" className="btn btn-secondary">
          Back to offers
        </Link>
      </div>
      {digest && (
        <p className="text-xs text-zinc-600">Reference: {digest}</p>
      )}
    </div>
  );
}
