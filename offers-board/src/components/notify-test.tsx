"use client";

import { useState } from "react";

/** One-click proof that the Discord webhook is reachable. */
export function NotifyTest() {
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">(
    "idle",
  );
  const [detail, setDetail] = useState("");

  async function send() {
    setState("sending");
    setDetail("");

    const response = await fetch("/api/notify/test", { method: "POST" }).catch(
      () => null,
    );
    const payload = (await response?.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      status?: number;
    } | null;

    if (payload?.ok) {
      setState("ok");
      setDetail("posted to Discord");
      return;
    }

    setState("error");
    setDetail(
      payload?.error === "not_configured"
        ? "no webhook set on this deployment"
        : `Discord answered ${payload?.status ?? "nothing"}`,
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={send}
        disabled={state === "sending"}
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-paper disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Send test ping"}
      </button>
      {detail ? (
        <span
          role="status"
          className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
            state === "ok" ? "text-ember" : "text-mute"
          }`}
        >
          {detail}
        </span>
      ) : null}
    </span>
  );
}
