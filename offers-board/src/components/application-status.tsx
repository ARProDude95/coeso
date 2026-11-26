"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApplicationStatus({
  id,
  status,
}: {
  id: string;
  status: "new" | "reviewed";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: status === "new" ? "reviewed" : "new" }),
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
      {busy ? "…" : status === "new" ? "Mark reviewed" : "Mark new"}
    </button>
  );
}
