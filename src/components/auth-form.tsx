"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Mode = "signin" | "signup";

interface Props {
  next: string;
}

export function AuthForm({ next }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setFieldErrors({});
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const endpoint = mode === "signin" ? "/api/auth/login" : "/api/auth/signup";
    const body =
      mode === "signin" ? { email, password } : { name, email, password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          fieldErrors?: Record<string, string[]>;
        };
        setError(payload.error ?? "Something went wrong. Please try again.");
        setFieldErrors(payload.fieldErrors ?? {});
        return;
      }

      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (key: string) => fieldErrors[key]?.[0];

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4 text-left">
      <div className="flex rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
        <button
          type="button"
          onClick={() => switchMode("signin")}
          aria-pressed={mode === "signin"}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "signin"
              ? "bg-zinc-800 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => switchMode("signup")}
          aria-pressed={mode === "signup"}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "signup"
              ? "bg-zinc-800 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Create account
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {mode === "signup" && (
        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            name="name"
            className="input"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={60}
          />
          {fieldError("name") && (
            <p className="field-error">{fieldError("name")}</p>
          )}
        </div>
      )}

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          maxLength={254}
        />
        {fieldError("email") && (
          <p className="field-error">{fieldError("email")}</p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={mode === "signin" ? 1 : 8}
          maxLength={200}
        />
        {mode === "signup" && (
          <p className="hint">At least 8 characters.</p>
        )}
        {fieldError("password") && (
          <p className="field-error">{fieldError("password")}</p>
        )}
      </div>

      <button type="submit" disabled={busy} className="btn btn-primary mt-1 py-2.5">
        {busy
          ? "Working…"
          : mode === "signin"
            ? "Sign in"
            : "Create account"}
      </button>
    </form>
  );
}
