/**
 * Centralised, lazily-read environment access.
 *
 * Values are read on call rather than at import time so that `next build`
 * (which evaluates module scope) does not explode when secrets are absent.
 */

function str(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`[env] Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get appUrl(): string {
    return (
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      "http://localhost:3000"
    );
  },

  get sessionSecret(): string {
    return str("SESSION_SECRET", process.env.SESSION_SECRET);
  },

  /**
   * Optional Discord webhook used only to announce new offers in a channel.
   * It is unrelated to sign-in: accounts are email + password.
   */
  get discordWebhookUrl(): string | null {
    return process.env.DISCORD_WEBHOOK_URL?.trim() || null;
  },

  /**
   * Bot credentials — all optional. Without them the Discord half of an
   * alert (DM, role change) is skipped and logged; the in-app path always
   * works. Never required for any feature to function.
   */
  get discordBotToken(): string | null {
    return process.env.DISCORD_BOT_TOKEN?.trim() || null;
  },

  get discordGuildId(): string | null {
    return process.env.DISCORD_GUILD_ID?.trim() || null;
  },

  /** Role id the bot hands to the monthly Top Closer (feature 7). */
  get topCloserRoleId(): string | null {
    return process.env.TOP_CLOSER_ROLE_ID?.trim() || null;
  },

  /* ------------------------------ Whop ------------------------------ */

  /** Server-side Whop API key. Never sent to the browser. */
  get whopApiKey(): string | null {
    return process.env.WHOP_API_KEY?.trim() || null;
  },

  /** `ws_…` signing secret of the /api/webhooks/whop endpoint. */
  get whopWebhookSecret(): string | null {
    return process.env.WHOP_WEBHOOK_SECRET?.trim() || null;
  },

  /**
   * REST base. Leave unset for production; point at
   * https://sandbox-api.whop.com/api/v1 in development.
   */
  get whopApiBaseUrl(): string {
    return (
      process.env.WHOP_API_BASE_URL?.trim() ||
      "https://api.whop.com/api/v1"
    );
  },

  /** Optional `biz_…` account id sent with checkout configuration requests. */
  get whopAccountId(): string | null {
    return process.env.WHOP_ACCOUNT_ID?.trim() || null;
  },

  /** Where "manage or cancel" sends the buyer (Whop's member hub). */
  get whopManageUrl(): string {
    return process.env.WHOP_MANAGE_URL?.trim() || "https://whop.com/hub";
  },
};
