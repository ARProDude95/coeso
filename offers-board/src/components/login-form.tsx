"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setSending(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
      }),
    });

    if (response.status === 503) {
      setError("Sign-in is not configured on this deployment yet.");
      setSending(false);
      return;
    }

    if (!response.ok) {
      setError("Wrong username or password. Credentials come from Coeso.");
      setSending(false);
      return;
    }

    const payload = (await response.json().catch(() => null)) as {
      redirectTo?: string;
    } | null;

    router.replace(payload?.redirectTo === "/admin" ? "/admin" : "/offers");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="login-username">
          Username
        </label>
        <input
          id="login-username"
          name="username"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="field"
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
        disabled={sending}
      >
        {sending ? "Checking…" : "Sign in"}
      </button>

      <p className="text-center text-xs leading-relaxed text-mute">
        There is no sign-up. Accounts are created by Coeso’s Owner.
      </p>
    </form>
  );
}
