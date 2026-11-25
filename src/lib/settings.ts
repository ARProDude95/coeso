import "server-only";
import { ApiError } from "./api";
import { getDb, type D1Database } from "./d1";
import { env } from "./env";

/**
 * Site-wide settings: a single row keyed on the constant `singleton`.
 *
 * The plan flag is how the Discord features are sold — flip it to `paid` from
 * /admin/settings when a customer pays. Free boards keep every feature they
 * had before this table existed; only the Discord announcement and role
 * gating sit behind `paid`.
 */
export type Plan = "free" | "paid";

export const PLANS: Plan[] = ["free", "paid"];

export interface Settings {
  plan: Plan;
  /**
   * Webhook configured in /admin/settings. May be empty, in which case the
   * `DISCORD_WEBHOOK_URL` environment variable is used as a fallback.
   */
  discordWebhookUrl: string;
  /**
   * Hosted Whop checkout link for buying the paid plan. Purchases happen on
   * Whop's own page, so the board only has to remember to flip the flag —
   * hence no API key or webhook secret anywhere in this app.
   */
  whopCheckoutUrl: string;
  updatedAt: string;
}

/** The only settings a public page is allowed to see. */
export interface PublicPricing {
  checkoutUrl: string;
}

const SETTINGS_ID = "singleton";

interface SettingsRow {
  id: string;
  plan: string;
  discord_webhook_url: string;
  whop_checkout_url?: string;
  updated_at: string;
}

function toSettings(row: SettingsRow): Settings {
  return {
    plan: row.plan === "paid" ? "paid" : "free",
    discordWebhookUrl: row.discord_webhook_url ?? "",
    whopCheckoutUrl: row.whop_checkout_url ?? "",
    updatedAt: row.updated_at,
  };
}

const FALLBACK: Settings = {
  plan: "free",
  discordWebhookUrl: "",
  whopCheckoutUrl: "",
  updatedAt: "",
};

async function readRow(db?: D1Database): Promise<SettingsRow | null> {
  const database = db ?? (await getDb());
  return database
    .prepare("SELECT * FROM settings WHERE id = ?")
    .bind(SETTINGS_ID)
    .first<SettingsRow>();
}

/**
 * Reads the singleton, creating it on the free plan the first time a board is
 * used. The default is deliberately `free`, so every deployment made before
 * the plan flag existed keeps behaving exactly as it did.
 */
export async function getSettings(): Promise<Settings> {
  const db = await getDb();
  const row = await readRow(db);
  if (row) return toSettings(row);

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO settings (id, plan, discord_webhook_url, whop_checkout_url, updated_at)
       VALUES (?, 'free', '', '', ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(SETTINGS_ID, now)
    .run();

  const created = await readRow(db);
  return created ? toSettings(created) : FALLBACK;
}

/** True when the board is on the paid plan. */
export async function isPaidPlan(): Promise<boolean> {
  return (await getSettings()).plan === "paid";
}

/**
 * Throws `403 upgrade_required` unless the board is on the paid plan. Call it
 * before touching any paid-only feature; the message names the feature.
 */
export async function requirePaidPlan(feature: string): Promise<Settings> {
  const settings = await getSettings();
  if (settings.plan !== "paid") {
    throw new ApiError(
      403,
      `${feature} is part of the paid plan`,
      "upgrade_required",
    );
  }
  return settings;
}

export async function updateSettings(patch: {
  plan?: Plan;
  discordWebhookUrl?: string;
  whopCheckoutUrl?: string;
}): Promise<Settings> {
  // Ensure the row exists so a plain UPDATE always has somewhere to land.
  await getSettings();

  const db = await getDb();
  const assignments: string[] = ["updated_at = ?"];
  const values: unknown[] = [new Date().toISOString()];

  if (patch.plan !== undefined) {
    assignments.push("plan = ?");
    values.push(patch.plan);
  }
  if (patch.discordWebhookUrl !== undefined) {
    assignments.push("discord_webhook_url = ?");
    values.push(patch.discordWebhookUrl.trim());
  }
  if (patch.whopCheckoutUrl !== undefined) {
    assignments.push("whop_checkout_url = ?");
    values.push(patch.whopCheckoutUrl.trim());
  }

  await db
    .prepare(`UPDATE settings SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values, SETTINGS_ID)
    .run();

  const row = await readRow(db);
  return row ? toSettings(row) : FALLBACK;
}

/**
 * Everything a public page may read. Deliberately narrow: the settings row
 * also holds the Discord webhook, which is a channel-creation secret and must
 * never reach an unauthenticated response.
 */
export async function getPublicPricing(): Promise<PublicPricing> {
  const settings = await getSettings();
  return { checkoutUrl: settings.whopCheckoutUrl.trim() };
}

/**
 * The webhook to post to: settings first, then the `DISCORD_WEBHOOK_URL`
 * environment fallback, or null when neither is configured.
 */
export function effectiveWebhookUrl(settings: Settings): string | null {
  const configured = settings.discordWebhookUrl.trim();
  if (configured) return configured;
  return env.discordWebhookUrl;
}
