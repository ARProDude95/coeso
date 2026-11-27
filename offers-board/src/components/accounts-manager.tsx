"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SelectMenu } from "@/components/select-menu";
import type { Account } from "@/lib/store";

const ROLE_OPTIONS: Array<{ value: Account["role"]; label: string }> = [
  { value: "viewer", label: "Viewer — board only" },
  { value: "admin", label: "Admin — full control" },
];

interface Credentials {
  username: string;
  password: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function CredentialsBox({
  title,
  credentials,
  copied,
  onCopy,
}: {
  title: string;
  credentials: Credentials;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-ember/40 bg-ember/10 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ember">
        {title}
      </p>
      <p className="mt-2 text-sm text-paper/85">
        Send these to the person yourself — the password is only shown once.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-ink px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mute">
            Username
          </p>
          <p className="mt-1 font-mono text-sm">{credentials.username}</p>
        </div>
        <div className="rounded-lg border border-line bg-ink px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-mute">
            Password
          </p>
          <p className="mt-1 font-mono text-sm">{credentials.password}</p>
        </div>
      </div>
      <button type="button" onClick={onCopy} className="btn mt-3">
        {copied ? "Copied" : "Copy credentials"}
      </button>
    </div>
  );
}

export function AccountsManager({
  accounts,
  currentId,
}: {
  accounts: Account[];
  currentId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Account["role"]>("viewer");
  const [busyId, setBusyId] = useState("");
  const [created, setCreated] = useState<Credentials | null>(null);
  const [reset, setReset] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState("");

  async function copy(credentials: Credentials, tag: string) {
    const text = `Coeso Offers Board\nUsername: ${credentials.username}\nPassword: ${credentials.password}\nSign in: ${window.location.origin}/login`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
    }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setBusy(true);
    setError("");
    setCreated(null);

    const response = await fetch("/api/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        role: data.get("role"),
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      account?: Account;
      password?: string;
    } | null;

    setBusy(false);

    if (!response.ok || !payload?.account || !payload.password) {
      setError(
        payload?.error === "username_taken"
          ? "That username already has an account."
          : payload?.error === "invalid"
            ? "Usernames are 3–30 letters, numbers, dots, dashes or underscores."
            : "Could not create the account.",
      );
      return;
    }

    form.reset();
    setRole("viewer");
    setCreated({
      username: payload.account.username,
      password: payload.password,
    });
    router.refresh();
  }

  async function act(
    account: Account,
    body: { action: "reset_password" } | { action: "set_active"; active: boolean },
  ) {
    setBusyId(account.id);
    setError("");

    const response = await fetch(`/api/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      password?: string;
    } | null;

    setBusyId("");

    if (!response.ok) {
      setError(
        payload?.error === "last_admin"
          ? "There has to be at least one active admin."
          : payload?.error === "cannot_disable_self"
            ? "You cannot disable the account you are signed in with."
            : "That change did not go through.",
      );
      return;
    }

    if (payload?.password) {
      setReset({ username: account.username, password: payload.password });
    }
    router.refresh();
  }

  async function remove(account: Account) {
    if (
      !window.confirm(
        `Delete the account "${account.username}"? They will lose access immediately.`,
      )
    ) {
      return;
    }

    setBusyId(account.id);
    setError("");

    const response = await fetch(`/api/accounts/${account.id}`, {
      method: "DELETE",
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    setBusyId("");

    if (!response.ok) {
      setError(
        payload?.error === "cannot_delete_self"
          ? "You cannot delete the account you are signed in with."
          : payload?.error === "last_admin"
            ? "There has to be at least one active admin."
            : "Could not delete that account.",
      );
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <form
        onSubmit={create}
        className="card grid gap-4 p-6 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end"
      >
        <div>
          <label className="label" htmlFor="account-username">
            Username
          </label>
          <input
            id="account-username"
            name="username"
            required
            minLength={3}
            maxLength={30}
            autoCapitalize="none"
            spellCheck={false}
            className="field"
            placeholder="e.g. jordan"
          />
        </div>
        <div>
          <span className="label">Access</span>
          <input type="hidden" name="role" value={role} />
          <SelectMenu
            label="Access"
            value={role}
            options={ROLE_OPTIONS}
            onChange={setRole}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>

      {error ? (
        <p className="mt-3 rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember">
          {error}
        </p>
      ) : null}

      {created ? (
        <CredentialsBox
          title="Account created"
          credentials={created}
          copied={copied === "created"}
          onCopy={() => copy(created, "created")}
        />
      ) : null}

      {reset ? (
        <CredentialsBox
          title="Password reset"
          credentials={reset}
          copied={copied === "reset"}
          onCopy={() => copy(reset, "reset")}
        />
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-coal font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
            <tr>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">Access</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last sign-in</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {accounts.map((account) => {
              const isSelf = account.id === currentId;
              const working = busyId === account.id;

              return (
                <tr key={account.id}>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs">{account.username}</span>
                    {isSelf ? (
                      <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.2em] text-ember">
                        you
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-mute">
                    {account.role === "admin" ? "Admin" : "Viewer"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        account.active === 1 ? "text-ember" : "text-mute"
                      }
                    >
                      {account.active === 1 ? "active" : "disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-mute">
                    {formatDate(account.last_login_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-4">
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => act(account, { action: "reset_password" })}
                        className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-paper disabled:opacity-50"
                      >
                        Reset password
                      </button>
                      {!isSelf ? (
                        <>
                          <button
                            type="button"
                            disabled={working}
                            onClick={() =>
                              act(account, {
                                action: "set_active",
                                active: account.active !== 1,
                              })
                            }
                            className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-paper disabled:opacity-50"
                          >
                            {account.active === 1 ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => remove(account)}
                            className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-ember disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
