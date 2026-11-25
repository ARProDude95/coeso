"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminLogin({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError("");

    const password = String(new FormData(event.currentTarget).get("password"));

    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (response.status === 503) {
      setError("Admin is not configured on this deployment yet.");
      setSending(false);
      return;
    }

    if (!response.ok) {
      setError("Wrong password.");
      setSending(false);
      return;
    }

    router.refresh();
  }

  return (
    <div className="card p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ember">
        Admin
      </p>
      <h1 className="mt-3 font-display text-3xl">Control room</h1>
      <p className="mt-2 text-sm leading-relaxed text-mute">
        {configured
          ? "Enter the admin password to post and manage offers."
          : "Set ADMIN_PASSWORD and ADMIN_SECRET in the environment to enable this page."}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="admin-password">
            Password
          </label>
          <input
            id="admin-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="field"
            disabled={!configured}
          />
        </div>
        {error ? (
          <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={!configured || sending}
        >
          {sending ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
