import "server-only";
import { WhopClient } from "@whop/sdk";
import { unwrapWebhook } from "@whop/sdk/helpers";
import { env } from "./env";
import {
  WHOP_API_VERSION,
  planId,
  type PricingPlan,
} from "./pricing";
import type { WhopEvent } from "./whop-events";

/**
 * Whop integration — official SDK only, REST v1 underneath, with the API
 * version pinned in one place (`WHOP_API_VERSION` in pricing.ts).
 *
 * Checkout is created server-side (the buyer never sees our API key) and the
 * webhook is verified against the raw request body with the SDK's
 * `unwrapWebhook` (Standard Webhooks HMAC).
 */

function client(): WhopClient {
  const token = env.whopApiKey;
  if (!token) {
    throw new Error("WHOP_API_KEY is not configured");
  }
  return new WhopClient({
    token,
    apiVersionDate: WHOP_API_VERSION,
    baseUrl: env.whopApiBaseUrl,
  });
}

/** Checkout needs an API key and the plan's Whop plan id. */
export function checkoutConfigured(plan: PricingPlan): boolean {
  return Boolean(env.whopApiKey && planId(plan));
}

/**
 * Creates a hosted checkout for one plan and returns its `purchase_url`.
 * Our user id travels in `metadata.user_id` so the webhook can match the
 * payment to the Discord/member account — the client never supplies it.
 */
export async function createWhopCheckout(
  plan: PricingPlan,
  userId: string,
): Promise<string> {
  const whopPlanId = planId(plan);
  if (!env.whopApiKey || !whopPlanId) {
    throw new Error(
      `Whop checkout is not configured for ${plan.key} (${plan.envVar})`,
    );
  }

  const checkout = await client().checkoutConfigurations.create({
    plan_id: whopPlanId,
    ...(env.whopAccountId ? { account_id: env.whopAccountId } : {}),
    metadata: {
      user_id: userId,
      plan_key: plan.key,
      founding: plan.founding ? "1" : "0",
    },
    redirect_url: `${env.appUrl}/billing?checkout=success`,
  });

  if (!checkout.purchase_url) {
    throw new Error("Whop returned a checkout without a purchase_url");
  }
  return checkout.purchase_url;
}

/**
 * Verifies the signature over the exact raw body and returns the event.
 * Throws `WebhookVerificationError` (or the SDK's missing-key error) — the
 * route turns that into a 400/503, never into a processed event.
 */
export function verifyWhopWebhook(
  rawBody: string,
  headers: Record<string, string>,
): WhopEvent {
  const secret = env.whopWebhookSecret;
  if (!secret) throw new Error("WHOP_WEBHOOK_SECRET is not configured");
  return unwrapWebhook<WhopEvent>(rawBody, { headers, key: secret });
}

/** Header lookup that does not depend on `Headers` (tests pass plain objects). */
export function headerValue(
  headers: Record<string, string>,
  name: string,
): string | null {
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key ? headers[key] : null;
}
