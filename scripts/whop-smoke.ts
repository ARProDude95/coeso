/**
 * Whop sandbox smoke test.
 *
 * 1. Resolves (or creates) a throwaway member on the running app.
 * 2. Creates a real hosted checkout through the Whop sandbox SDK — unless
 *    `--skip-checkout` is passed.
 * 3. Sends a correctly signed `payment.succeeded` webhook to the running app.
 * 4. Replays the exact same delivery and expects a duplicate no-op.
 * 5. Opens /billing as the member (when it created one) and checks the plan
 *    and status actually rendered.
 *
 * Usage:
 *   npm run smoke:whop -- --create-user
 *   npm run smoke:whop -- --user-id <uuid> --plan elite_monthly
 *   npm run smoke:whop -- --skip-checkout --create-user
 *
 * Required env:
 *   WHOP_WEBHOOK_SECRET   must match the running app's secret
 *   WHOP_PLAN_ID_<PLAN>   the plan id for the chosen plan (also used in the
 *                         replayed event so the handler can map the tier)
 *
 * Optional env:
 *   WHOP_API_KEY          required unless --skip-checkout
 *   WHOP_API_BASE_URL     defaults to the sandbox REST base
 *   WHOP_SMOKE_APP_URL    defaults to NEXT_PUBLIC_APP_URL or localhost:3000
 *
 * Secrets are never printed. The script refuses to create a real checkout
 * against the production Whop API unless `--allow-production` is passed.
 */

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { WhopClient } from "@whop/sdk";
import {
  WHOP_API_VERSION,
  formatPrice,
  planByKey,
  planId,
  priceFor,
} from "../src/lib/pricing";

interface Options {
  baseUrl: string;
  planKey: string;
  userId: string | null;
  createUser: boolean;
  skipCheckout: boolean;
  allowProduction: boolean;
}

interface JsonBody {
  [key: string]: unknown;
}

const SANDBOX_BASE = "https://sandbox-api.whop.com/api/v1";
const DEFAULT_PLAN = "pro_monthly";

function parseArgs(argv: string[]): Options {
  const options: Options = {
    baseUrl:
      process.env.WHOP_SMOKE_APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      "http://localhost:3000",
    planKey: DEFAULT_PLAN,
    userId: process.env.WHOP_SMOKE_USER_ID?.trim() || null,
    createUser: false,
    skipCheckout: false,
    allowProduction: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--create-user") options.createUser = true;
    else if (arg === "--skip-checkout") options.skipCheckout = true;
    else if (arg === "--allow-production") options.allowProduction = true;
    else if (arg === "--base-url") options.baseUrl = argv[++index] ?? "";
    else if (arg === "--plan") options.planKey = argv[++index] ?? "";
    else if (arg === "--user-id") options.userId = argv[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  options.baseUrl = options.baseUrl.replace(/\/$/, "");
  return options;
}

function printHelp(): void {
  console.log(`Whop sandbox smoke test

Options:
  --create-user       create a throwaway account on the app (recommended)
  --user-id <uuid>    use an existing app account id
  --plan <key>        plan key from src/lib/pricing.ts (default: pro_monthly)
  --skip-checkout     only replay the signed webhook (no Whop API call)
  --allow-production  permit checkout creation against the production API
  --base-url <url>    app origin (default: http://localhost:3000)

Env: WHOP_WEBHOOK_SECRET, WHOP_PLAN_ID_*, WHOP_API_KEY (checkout),
     WHOP_API_BASE_URL (default: sandbox)
`);
}

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`Missing required environment variable ${name}`);
  return value;
}

async function readJson(response: Response): Promise<JsonBody> {
  const text = await response.text();
  try {
    return JSON.parse(text) as JsonBody;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function sessionCookie(response: Response): string | null {
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  const session = cookies.find((cookie) => cookie.startsWith("coeso_session="));
  return session ? session.split(";")[0] : null;
}

async function createSmokeUser(
  baseUrl: string,
): Promise<{ id: string; email: string; cookie: string | null }> {
  const stamp = Date.now().toString(36);
  const email = `whop-smoke+${stamp}@example.com`;
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Whop Smoke ${stamp}`,
      email,
      password: `smoke-${randomBytes(18).toString("base64url")}`,
    }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    fail(`Could not create the smoke account: ${JSON.stringify(body)}`);
  }

  const user = body.user as { id?: string } | undefined;
  if (!user?.id) fail("Signup succeeded but returned no user id");

  return { id: user.id, email, cookie: sessionCookie(response) };
}

async function createCheckout(
  planKey: string,
  userId: string,
  options: Options,
): Promise<string> {
  if (options.skipCheckout) return "skipped (--skip-checkout)";

  const apiKey = requireEnv("WHOP_API_KEY");
  const plan = planByKey(planKey);
  if (!plan) fail(`Unknown plan key: ${planKey}`);
  const whopPlanId = planId(plan);
  if (!whopPlanId) fail(`Missing ${plan.envVar}`);

  const baseUrl = process.env.WHOP_API_BASE_URL?.trim() || SANDBOX_BASE;
  if (!/sandbox/i.test(baseUrl) && !options.allowProduction) {
    fail(
      `Refusing to create a checkout against ${baseUrl} without --allow-production`,
    );
  }

  const client = new WhopClient({
    token: apiKey,
    apiVersionDate: WHOP_API_VERSION,
    baseUrl,
  });
  const accountId = process.env.WHOP_ACCOUNT_ID?.trim();

  const checkout = await client.checkoutConfigurations.create({
    plan_id: whopPlanId,
    ...(accountId ? { account_id: accountId } : {}),
    metadata: { user_id: userId, plan_key: plan.key, smoke: "1" },
    redirect_url: `${options.baseUrl}/billing?checkout=success`,
  });

  if (!checkout.purchase_url) {
    fail("Whop returned a checkout without a purchase_url");
  }
  return checkout.purchase_url;
}

/**
 * Builds a `payment.succeeded` event for the chosen plan and signs it exactly
 * like Whop does (Standard Webhooks: HMAC-SHA256 over `id.timestamp.body`,
 * base64 in `webhook-signature` as `v1,<signature>`).
 */
function signedPaymentEvent(
  planKey: string,
  userId: string,
  secret: string,
): { body: string; headers: Record<string, string>; eventId: string } {
  const plan = planByKey(planKey);
  if (!plan) fail(`Unknown plan key: ${planKey}`);
  const whopPlanId = planId(plan);
  if (!whopPlanId) fail(`Missing ${plan.envVar}`);

  const eventId = `evt_smoke_${randomUUID()}`;
  const body = JSON.stringify({
    id: eventId,
    type: "payment.succeeded",
    data: {
      id: `pay_smoke_${randomUUID()}`,
      plan_id: whopPlanId,
      membership_id: `mem_smoke_${randomUUID()}`,
      renewal_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      amount: priceFor(plan, "USD"),
      currency: "usd",
      metadata: { user_id: userId, plan_key: plan.key, smoke: "1" },
    },
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${eventId}.${timestamp}.${body}`)
    .digest("base64");

  return {
    body,
    eventId,
    headers: {
      "content-type": "application/json",
      "webhook-id": eventId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
  };
}

async function postWebhook(
  baseUrl: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: JsonBody }> {
  const response = await fetch(`${baseUrl}/api/webhooks/whop`, {
    method: "POST",
    headers,
    body,
  });
  return { status: response.status, body: await readJson(response) };
}

async function verifyBilling(
  baseUrl: string,
  cookie: string,
  planLabel: string,
): Promise<string[]> {
  const failures: string[] = [];
  const response = await fetch(`${baseUrl}/billing`, {
    headers: { Cookie: cookie, Accept: "text/html" },
  });
  const html = await response.text();

  if (!response.ok) {
    failures.push(`/billing returned HTTP ${response.status}`);
    return failures;
  }
  if (!html.includes(planLabel)) {
    failures.push(`/billing did not render the plan “${planLabel}”`);
  }
  if (!html.includes("Active")) {
    failures.push("/billing did not render an Active status");
  }
  return failures;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const secret = requireEnv("WHOP_WEBHOOK_SECRET");
  const plan = planByKey(options.planKey);
  if (!plan) fail(`Unknown plan key: ${options.planKey}`);

  console.log("Whop sandbox smoke test");
  console.log(`  app:   ${options.baseUrl}`);
  console.log(
    `  plan:  ${plan.key} — ${formatPrice(priceFor(plan, "USD"), "USD")}`,
  );

  let userId = options.userId;
  let cookie: string | null = null;

  if (!userId || options.createUser) {
    const user = await createSmokeUser(options.baseUrl);
    userId = user.id;
    cookie = user.cookie;
    console.log(`  user:  created ${user.email}`);
  } else {
    console.log(`  user:  ${userId} (existing)`);
  }

  const checkoutUrl = await createCheckout(plan.key, userId, options);
  console.log(`  checkout: ${checkoutUrl}`);

  const event = signedPaymentEvent(plan.key, userId, secret);
  const first = await postWebhook(options.baseUrl, event.body, event.headers);
  if (first.status !== 200 || first.body.ok !== true) {
    fail(
      `Webhook was not accepted: HTTP ${first.status} ${JSON.stringify(first.body)}`,
    );
  }
  console.log("  webhook: 200 ok");

  const repeat = await postWebhook(options.baseUrl, event.body, event.headers);
  if (repeat.status !== 200 || repeat.body.duplicate !== true) {
    fail(
      `Duplicate delivery was not ignored: HTTP ${repeat.status} ${JSON.stringify(repeat.body)}`,
    );
  }
  console.log("  replay:  200 duplicate");

  if (cookie) {
    const failures = await verifyBilling(
      options.baseUrl,
      cookie,
      plan.label,
    );
    if (failures.length > 0) {
      fail(`Billing check failed:\n  - ${failures.join("\n  - ")}`);
    }
    console.log(`  billing: shows ${plan.label} and Active`);
  } else {
    console.log(
      "  billing: skipped (no session — pass --create-user to verify the page)",
    );
  }

  console.log("\n✔ Whop smoke test passed\n");
}

main().catch((error: unknown) => {
  console.error("\n✖ Smoke test crashed:\n", error);
  process.exit(1);
});
