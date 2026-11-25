"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StatusToggle({
  id,
  status,
}: {
  id: string;
  status: "open" | "closed";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch(`/api/offers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: status === "open" ? "closed" : "open" }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-paper disabled:opacity-50"
    >
      {busy ? "…" : status === "open" ? "Close" : "Reopen"}
    </button>
  );
}
