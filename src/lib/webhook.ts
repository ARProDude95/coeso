import "server-only";
import { effectiveWebhookUrl, getSettings } from "./settings";
import { env } from "./env";
import type { Offer } from "./types";
import { OFFER_STATUS_LABELS, ROLE_TYPE_LABELS } from "./types";

/** Antique gold, matching the board's accent colour (same as The Roster). */
const EMBED_COLOR = 0xd2a95f;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Posts a new-offer embed to the configured Discord channel webhook.
 *
 * Paid-plan feature: boards on the free plan never post, even when a webhook
 * URL is configured, so the announcement is what the customer buys.
 *
 * Never throws: a webhook outage must not roll back or fail the offer the
 * admin just published. Returns `false` when the plan, the configuration or
 * Discord itself says no.
 */
export async function announceOffer(offer: Offer): Promise<boolean> {
  try {
    const settings = await getSettings();
    if (settings.plan !== "paid") return false;

    const url = effectiveWebhookUrl(settings);
    if (!url) return false;

    return await postOffer(url, offer);
  } catch (error) {
    console.error("[webhook] failed to announce offer:", error);
    return false;
  }
}

/**
 * Moderation alert: posted when an offer is auto-paused by reports.
 *
 * Unlike `announceOffer` this is *not* behind the paid-plan flag — it is an
 * operational safety notice, and it only fires when a webhook URL exists at
 * all. Still never throws: the report flow must not fail on Discord.
 */
export async function announceReport(offer: Offer, reportCount: number): Promise<boolean> {
  try {
    const settings = await getSettings();
    const url = effectiveWebhookUrl(settings);
    if (!url) return false;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Coeso Offers Board",
        embeds: [
          {
            title: `⚠️ Auto-paused: ${truncate(offer.title, 256)}`,
            url: `${env.appUrl}/offers/${offer.id}`,
            description: truncate(
              `${reportCount} unique reports — the offer was paused automatically. Review it from the admin reports page.`,
              1000,
            ),
            color: 0xdc2626,
            timestamp: new Date().toISOString(),
            footer: { text: "Coeso Offers Board" },
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`[webhook] report alert rejected (${response.status})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[webhook] failed to post report alert:", error);
    return false;
  }
}

async function postOffer(url: string, offer: Offer): Promise<boolean> {
  const appUrl = `${env.appUrl}/offers/${offer.id}`;

  const payload = {
    username: "Coeso Offers Board",
    embeds: [
      {
        title: truncate(offer.title, 256),
        url: appUrl,
        description: truncate(offer.description, 600),
        color: EMBED_COLOR,
        fields: [
          { name: "Company", value: truncate(offer.company, 1024), inline: true },
          { name: "Role", value: ROLE_TYPE_LABELS[offer.roleType], inline: true },
          { name: "Pay type", value: truncate(offer.payType, 1024), inline: true },
          { name: "Commission", value: truncate(offer.commission, 1024), inline: true },
          {
            name: "Status",
            value: OFFER_STATUS_LABELS[offer.status],
            inline: true,
          },
          {
            name: "Expires",
            value: offer.expiresAt
              ? new Date(offer.expiresAt).toLocaleDateString("en-US")
              : "No expiry",
            inline: true,
          },
        ],
        timestamp: offer.createdAt,
        footer: { text: "Coeso Offers Board" },
      },
    ],
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `[webhook] Discord rejected the announcement (${response.status}): ${text}`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("[webhook] failed to announce offer:", error);
    return false;
  }
}
