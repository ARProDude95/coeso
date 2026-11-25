"use client";

import Link from "next/link";
import { useState } from "react";

interface Props {
  planKey: string;
  label: string;
  /** False when the API key or that plan's Whop plan id is missing. */
  configured: boolean;
  signedIn: boolean;
  current: boolean;
}

/**
 * Buy button. The browser never sees Whop credentials: it asks our API for a
 * checkout URL (created server-side with the SDK) and follows it.
 */
export function CheckoutButton({
  planKey,
  label,
  configured,
  signedIn,
  current,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (current) {
    return (
      <button type="button" className="btn btn-secondary w-full" disabled>
        Current plan
      </button>
    );
  }

  if (!signedIn) {
    return (
      <Link href="/login" className="btn btn-primary w-full">
        Sign in to subscribe
      </Link>
    );
  }

  if (!configured) {
    return (
      <button type="button" className="btn btn-secondary w-full" disabled>
        Checkout not configured
      </button>
    );
  }

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };

      if (!response.ok || !body.url) {
        setError(body.error ?? "Could not start checkout");
        return;
      }

      window.location.assign(body.url);
    } catch {
      setError("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={busy}
        onClick={() => void subscribe()}
      >
        {busy ? "Opening Whop…" : label}
      </button>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
