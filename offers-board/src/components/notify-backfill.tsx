"use client";

import { useState } from "react";

interface BackfillPayload {
  total?: number;
  sent?: number;
  skipped?: number;
  failed?: number;
  error?: string;
}

/**
 * One click to push the applications that were never announced. Idempotent, so
 * pressing it again only retries whatever did not make it.
 */
export function NotifyBackfill({ unread }: { unread: number }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );
  const [detail, setDetail] = useState("");

  async function push() {
    setState("sending");
    setDetail("");

    const response = await fetch("/api/notify/backfill", {
      method: "POST",
    }).catch(() => null);

    const payload = (await response?.json().catch(() => null)) as
      | BackfillPayload
      | null;

    if (!response?.ok || payload?.error) {
      setState("error");
      setDetail(
        payload?.error === "not_configured"
          ? "no webhook set on this deployment"
          : "Discord did not accept the post",
      );
      return;
    }

    setState("done");
    if (!payload?.total) {
      setDetail("nothing unread");
    } else if (!payload.sent) {
      setDetail(`${payload.total} already sent`);
    } else {
      setDetail(
        `${payload.sent} sent${payload.failed ? `, ${payload.failed} failed` : ""}`,
      );
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={push}
        disabled={state === "sending"}
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember underline decoration-ember/40 underline-offset-4 hover:text-paper disabled:opacity-50"
      >
        {state === "sending"
          ? "Pushing…"
          : `Push ${unread} unread to Discord`}
      </button>
      {detail ? (
        <span
          role="status"
          className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
            state === "error" ? "text-mute" : "text-ember"
          }`}
        >
          {detail}
        </span>
      ) : null}
    </span>
  );
}
