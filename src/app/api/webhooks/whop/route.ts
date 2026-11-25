import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import {
  claimWhopEvent,
  releaseWhopEvent,
} from "@/lib/subscriptions";
import { headerValue, verifyWhopWebhook } from "@/lib/whop";
import {
  classifyWhopEvent,
  eventData,
  eventId,
  eventType,
} from "@/lib/whop-events";
import { handleWhopEvent } from "@/lib/whop-handler";

export const dynamic = "force-dynamic";

/**
 * Whop webhook receiver.
 *
 * 1. The signature is verified over the raw body with the SDK; anything else
 *    is a 400 and is never processed.
 * 2. The event id is claimed in `whop_events` first, so a duplicate delivery
 *    (Whop retries) is a no-op.
 * 3. Processing failures release the claim and answer 500, letting Whop retry;
 *    successful or ignored events stay claimed.
 *
 * Our subscription table is the only thing that grants access — this route
 * never trusts a browser session or client-supplied tier.
 */
export async function POST(request: NextRequest) {
  if (!env.whopWebhookSecret) {
    console.error("[whop] WHOP_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { error: "Webhook not configured", code: "not_configured" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers);
  const headerId = headerValue(headers, "webhook-id");

  let event;
  try {
    event = verifyWhopWebhook(rawBody, headers);
  } catch (error) {
    console.warn("[whop] rejected webhook signature:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Invalid webhook signature", code: "invalid_signature" },
      { status: 400 },
    );
  }

  const type = eventType(event);
  const id = eventId(event, headerId);
  if (!id) {
    return NextResponse.json(
      { error: "Webhook is missing an event id", code: "missing_event_id" },
      { status: 400 },
    );
  }

  const kind = classifyWhopEvent(type, eventData(event));

  if (!(await claimWhopEvent(id, type))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await handleWhopEvent(event, kind);
  } catch (error) {
    // Release the claim so Whop's retry can try again instead of being
    // swallowed as a duplicate forever.
    await releaseWhopEvent(id);
    console.error(`[whop] failed to process ${type}:`, error);
    return NextResponse.json(
      { error: "Webhook processing failed", code: "processing_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, type, ignored: kind === "ignored" });
}
