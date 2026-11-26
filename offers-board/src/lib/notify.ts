import type { Application, Offer } from "./store";

const TIMEOUT_MS = 5_000;
const FIELD_LIMIT = 1_000;
const EMBER = 0xff5a1f;

/** Whether a webhook is configured at all. */
export function notificationsConfigured(): boolean {
  return Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
}

function clip(value: string | number | null | undefined, max = FIELD_LIMIT) {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface ApplicationNotice {
  application: Application;
  offer: Offer;
  origin: string;
}

/**
 * Post one embed to the owner's Discord webhook. Deliberately best-effort: a
 * missing webhook, a network failure or a Discord error must never stop the
 * member's application from being saved or change their response.
 */
export async function notifyNewApplication({
  application,
  offer,
  origin,
}: ApplicationNotice): Promise<void> {
  const webhook = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhook) return;

  const mention = process.env.DISCORD_MENTION?.trim();

  const body = {
    username: "Coeso Offers Board",
    ...(mention
      ? {
          content: `${mention} new application on the offers board`,
          allowed_mentions: { parse: ["roles", "users"] },
        }
      : {}),
    embeds: [
      {
        title: clip(offer.title, 250),
        url: `${origin}/admin`,
        description: `**${clip(application.account_username, 80)}** applied to **${clip(
          offer.company,
          120,
        )}**`,
        color: EMBER,
        timestamp: application.created_at,
        fields: [
          { name: "Member", value: clip(application.account_username), inline: true },
          { name: "Email", value: clip(application.email), inline: true },
          { name: "Discord", value: clip(application.discord), inline: true },
          {
            name: "Hours / week",
            value: clip(application.availability_hours),
            inline: true,
          },
          { name: "Pay", value: clip(offer.pay_type), inline: true },
          { name: "Role", value: clip(offer.role_type), inline: true },
          { name: "Experience", value: clip(application.experience) },
          ...(application.message.trim()
            ? [{ name: "Message", value: clip(application.message) }]
            : []),
        ],
        footer: { text: "Coeso Offers Board · review in /admin" },
      },
    ],
  };

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(
        `[notify] Discord webhook returned ${response.status}`,
        await response.text().catch(() => ""),
      );
    }
  } catch (error) {
    console.error("[notify] Discord webhook failed", error);
  }
}
