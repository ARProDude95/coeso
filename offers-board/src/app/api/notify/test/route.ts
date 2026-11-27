import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * Posts one message to the configured webhook so the owner can prove the
 * pipeline works without waiting for a real application. The webhook URL is
 * never returned or logged; only Discord's status code leaves this route.
 */
export async function POST() {
  if ((await getSession())?.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhook) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  // Carry the same mention a real application would, so the test proves the
  // ping and not just that the message arrived.
  const mention = process.env.DISCORD_MENTION?.trim();

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "Coeso Offers Board",
      content: mention
        ? `${mention} test ping — Coeso Offers Board notifications are wired up.`
        : "Test ping — Coeso Offers Board notifications are wired up.",
      ...(mention ? { allowed_mentions: { parse: ["roles", "users"] } } : {}),
    }),
  }).catch(() => null);

  return NextResponse.json(
    { ok: Boolean(response?.ok), status: response?.status ?? 0 },
    { headers: { "cache-control": "no-store" } },
  );
}
