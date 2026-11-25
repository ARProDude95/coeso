"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Settings } from "@/lib/settings";

interface Props {
  settings: Settings;
  /** Where announcements actually post from: stored URL or env fallback. */
  effectiveUrl: string | null;
  source: "settings" | "env" | "none";
}

interface ApiFailure {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const PAID_FEATURES = [
  "Channel announcements — every new offer posted to a Discord channel",
  "Role-gated offers — hidden from members who don't hold the role",
  "Member roles — assigned on the Members page",
];

export function SettingsForm({ settings, effectiveUrl, source }: Props) {
  const router = useRouter();
  const paid = settings.plan === "paid";

  const [url, setUrl] = useState(settings.discordWebhookUrl);
  const [checkout, setCheckout] = useState(settings.whopCheckoutUrl);
  const [busy, setBusy] = useState<null | "plan" | "webhook" | "checkout">(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<string | null>(null);

  async function patch(
    body: Record<string, unknown>,
    which: "plan" | "webhook" | "checkout",
  ) {
    setBusy(which);
    setError(null);
    setFieldErrors({});
    setSaved(null);

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ApiFailure;
        setError(payload.error ?? "Something went wrong. Please try again.");
        setFieldErrors(payload.fieldErrors ?? {});
        return false;
      }

      router.refresh();
      return true;
    } catch {
      setError("Network error — please try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function togglePlan() {
    const ok = await patch({ plan: paid ? "free" : "paid" }, "plan");
    if (ok) setSaved(paid ? "Switched to the free plan" : "Paid plan enabled");
  }

  async function saveWebhook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await patch({ discordWebhookUrl: url.trim() }, "webhook");
    if (ok) setSaved("Webhook saved");
  }

  async function saveCheckout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await patch({ whopCheckoutUrl: checkout.trim() }, "checkout");
    if (ok) setSaved(checkout.trim() ? "Checkout link saved" : "Checkout link cleared");
  }

  const webhookError = fieldErrors.discordWebhookUrl?.[0];
  const checkoutError = fieldErrors.whopCheckoutUrl?.[0];
  const hasCheckout = checkout.trim() !== "";

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {saved}
        </p>
      )}

      <section className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Plan
              </h2>
              <span
                className={paid ? "badge badge-accent" : "badge badge-neutral"}
              >
                {paid ? "Paid" : "Free"}
              </span>
            </div>
            <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400">
              {paid
                ? "This board is on the paid plan. Discord announcements and role gating are active."
                : "This board is on the free plan: the board, offers and applications work exactly as they always have. The Discord features are what a paying customer unlocks."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!paid && hasCheckout && (
              <a
                href={checkout.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
              >
                Upgrade with Whop
              </a>
            )}
            <button
              type="button"
              className={
                paid || hasCheckout ? "btn btn-secondary" : "btn btn-primary"
              }
              disabled={busy !== null}
              onClick={togglePlan}
            >
              {busy === "plan"
                ? "Saving…"
                : paid
                  ? "Switch to free"
                  : "Switch to paid"}
            </button>
          </div>
        </div>
        {!paid && hasCheckout && (
          <p className="mt-3 text-xs text-zinc-500">
            Payment happens on Whop&apos;s hosted page — flip the plan once it
            comes through.
          </p>
        )}
      </section>

      <section className="panel flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Whop checkout
              </h2>
              <span className="badge badge-neutral">Paid plan</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Paste the checkout link from your Whop dashboard (Checkout links →
              Copy). It powers the upgrade buttons here and on the public
              pricing page; buyers pay on Whop&apos;s own hosted page, then the
              plan is switched over by hand.
            </p>
          </div>
          {hasCheckout && (
            <a
              href={checkout.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              Open checkout ↗
            </a>
          )}
        </div>

        <form onSubmit={saveCheckout} className="flex flex-col gap-2">
          <label className="label" htmlFor="whopCheckout">
            Checkout URL
          </label>
          <input
            id="whopCheckout"
            className="input"
            type="url"
            inputMode="url"
            maxLength={500}
            placeholder="https://whop.com/checkout/plan_…"
            value={checkout}
            onChange={(event) => setCheckout(event.target.value)}
          />
          {checkoutError && <p className="field-error">{checkoutError}</p>}
          <p className="hint">
            {hasCheckout
              ? "Live: the buy buttons open this link in a new tab."
              : "No link yet — /pricing shows the feature comparison without a buy button."}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={busy !== null}
              className="btn btn-primary"
            >
              {busy === "checkout" ? "Saving…" : "Save checkout link"}
            </button>
            {hasCheckout && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy !== null}
                onClick={() => setCheckout("")}
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </section>

      {paid ? (
        <section className="panel flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Discord channel announcement
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Every offer published as <em>open</em> is posted to this channel
              as an embed with the pay, commission and expiry details.
            </p>
          </div>

          <form onSubmit={saveWebhook} className="flex flex-col gap-2">
            <label className="label" htmlFor="webhook">
              Webhook URL
            </label>
            <input
              id="webhook"
              className="input"
              type="url"
              inputMode="url"
              maxLength={500}
              placeholder="https://discord.com/api/webhooks/…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            {webhookError && <p className="field-error">{webhookError}</p>}
            <p className="hint">
              {source === "env"
                ? "Currently posting via the DISCORD_WEBHOOK_URL environment variable — save a URL here to override it."
                : source === "settings"
                  ? `Live: posting to ${effectiveUrl?.slice(0, 42)}…`
                  : "No webhook configured yet — nothing is announced until you save one."}
            </p>

            <div className="mt-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={busy !== null}
                className="btn btn-primary"
              >
                {busy === "webhook" ? "Saving…" : "Save webhook"}
              </button>
              {url !== "" && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy !== null}
                  onClick={() => setUrl("")}
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </section>
      ) : (
        <section className="panel p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  Discord
                </h2>
                <span className="badge badge-accent">Paid plan</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Available when this board moves to the paid plan:
              </p>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm text-zinc-300">
                {PAID_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="text-indigo-300">•</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={togglePlan}
            >
              {busy === "plan" ? "Saving…" : "Switch to paid plan"}
            </button>
          </div>
        </section>
      )}

      <section className="panel p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Role gating
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          {paid
            ? "Open New offer or Edit offer to restrict an offer to a role — members without it never see the offer, its detail page or its apply endpoint. Roles are assigned on the Members page."
            : "Gated offers require the paid plan. On a paid board, set a role from the offer form and assign roles to members from the Members page."}
        </p>
      </section>
    </div>
  );
}
