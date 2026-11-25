"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { initials } from "@/lib/initials";

interface Props {
  name: string;
}

export function UserMenu({ name }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setBusy(false);
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 sm:hidden">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-[10px] font-semibold text-zinc-200">
          {initials(name)}
        </span>
      </div>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="btn btn-secondary"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
