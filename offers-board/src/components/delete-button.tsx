"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteButton({
  path,
  confirmText,
  label = "Delete",
}: {
  path: string;
  confirmText: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    await fetch(path, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-ember disabled:opacity-50"
    >
      {busy ? "…" : label}
    </button>
  );
}
