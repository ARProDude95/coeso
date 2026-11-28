import type { Application, Offer } from "./store";
import {
  getOffer,
  getSetting,
  listUnreadApplications,
  setSetting,
} from "./store";

const TIMEOUT_MS = 5_000;
const FIELD_LIMIT = 1_000;
const EMBER = 0xff5a1f;

/** Applications Discord has already been told about, so nothing is posted twice. */
const NOTIFIED_KEY = "discord_notified_v1";

/** Whether a webhook is configured at all. */
export function notificationsConfigured(): boolean {
  return Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
}

function clip(value: string | number | null | undefined, max = FIELD_LIMIT) {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function mention(): string | undefined {
  return process.env.DISCORD_MENTION?.trim() || undefined;
}

interface ApplicationNotice {
  application: Application;
  offer: Offer;
  origin: string;
}

/** The embed one application produces, shared by the live flow and the backfill. */
function applicationEmbed({ application, offer, origin }: ApplicationNotice) {
  return {
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
  };
}

/**
 * One webhook message: the embed plus a line of context. The role mention is
 * what turns a message into a ping, so it is only added when one is configured.
 */
function messageBody(notice: ApplicationNotice, line: string) {
  const role = mention();
  return {
    username: "Coeso Offers Board",
    content: role ? `${role} ${line}` : line,
    ...(role ? { allowed_mentions: { parse: ["roles", "users"] } } : {}),
    embeds: [applicationEmbed(notice)],
  };
}

interface Posted {
  ok: boolean;
  status: number;
}

/** Best-effort post: Discord problems are logged, never thrown. */
async function post(webhook: string, body: unknown): Promise<Posted> {
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
      return { ok: false, status: response.status };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    console.error("[notify] Discord webhook failed", error);
    return { ok: false, status: 0 };
  }
}

async function readNotifiedIds(): Promise<Set<string>> {
  const raw = await getSetting(NOTIFIED_KEY).catch(() => null);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

/**
 * Remember that Discord has seen this application. Failing to write the marker
 * only risks a repeat post from the backfill, so it never surfaces.
 */
async function rememberNotified(ids: Set<string>, id: string): Promise<void> {
  ids.add(id);
  await setSetting(NOTIFIED_KEY, JSON.stringify([...ids])).catch((error) =>
    console.error("[notify] could not record notified application", error),
  );
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

  const posted = await post(
    webhook,
    messageBody({ application, offer, origin }, "new application on the offers board"),
  );
  if (posted.ok) await rememberNotified(await readNotifiedIds(), application.id);
}

export interface BackfillResult {
  /** Unread applications found. */
  total: number;
  sent: number;
  /** Already posted to Discord by an earlier click or a live notification. */
  skipped: number;
  failed: number;
  configured: boolean;
  error?: "not_configured";
}

/**
 * One-off catch-up: posts every application still marked `new` that Discord has
 * not seen, which is what built up while the webhook was unset. Idempotent — a
 * second click only covers what the first one failed to deliver.
 */
export async function pushUnreadApplications(
  origin: string,
): Promise<BackfillResult> {
  const webhook = process.env.DISCORD_WEBHOOK_URL?.trim();
  const result: BackfillResult = {
    total: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    configured: Boolean(webhook),
  };

  if (!webhook) {
    result.error = "not_configured";
    return result;
  }

  const unread = await listUnreadApplications();
  result.total = unread.length;
  if (unread.length === 0) return result;

  const notified = await readNotifiedIds();

  for (const application of unread) {
    if (notified.has(application.id)) {
      result.skipped += 1;
      continue;
    }

    // Deleting an offer takes its applications with it, so a missing offer here
    // only means the row changed under us; skip it rather than post half a card.
    const offer = await getOffer(application.offer_id);
    if (!offer) {
      result.failed += 1;
      continue;
    }

    const posted = await post(
      webhook,
      messageBody(
        { application, offer, origin },
        "unread application recovered from before notifications were on",
      ),
    );

    if (!posted.ok) {
      result.failed += 1;
      continue;
    }

    await rememberNotified(notified, application.id);
    result.sent += 1;
  }

  return result;
}
