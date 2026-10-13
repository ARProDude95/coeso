package com.coeso.roster.billing;

import org.springframework.stereotype.Component;

/**
 * Razorpay billing provider — a documented stub.
 *
 * <p>Status: <b>not implemented</b>. The interface, the config switch
 * ({@code app.billing.provider=razorpay}) and the shape of the events are in
 * place so the real implementation can drop in without touching
 * {@link BillingService} or the controller.
 *
 * <p>What a real implementation must do (Razorpay's scheme differs from
 * Stripe's in two important ways):
 * <ol>
 *   <li><b>Checkout</b>: create an order via
 *       {@code POST https://api.razorpay.com/v1/orders} with HTTP Basic auth
 *       ({@code key_id:key_secret}), amount in paise, {@code currency: INR},
 *       {@code period: monthly}, then open Razorpay Checkout on the frontend
 *       with that order id. There is no hosted redirect URL like Stripe's.</li>
 *   <li><b>Webhook verification</b>: the {@code X-Razorpay-Signature} header is
 *       the hex HMAC-SHA256 of the <b>raw body</b> using
 *       {@code app.billing.razorpay.webhook-secret} — no timestamp component,
 *       therefore no replay tolerance of its own; protect against replays with
 *       the {@code (provider, event_id)} idempotency ledger instead (already
 *       enforced by {@code uq_billing_events_provider_event}). Verify with
 *       {@link StripeBillingProvider#hmacSha256Hex}, which is generic.</li>
 *   <li><b>Event mapping</b>: {@code subscription.charged} → ACTIVE,
 *       {@code subscription.halted} / {@code payment.failed} → PAST_DUE,
 *       {@code subscription.cancelled} → CANCELED, {@code subscription.activated}
 *       → ACTIVE. Workspace id and plan code travel in the order's
 *       {@code notes} (Razorpay copies order notes onto events).</li>
 * </ol>
 */
@Component
public class RazorpayBillingProvider implements BillingProvider {

    @Override
    public String name() {
        return "razorpay";
    }

    @Override
    public CheckoutSession createCheckout(CheckoutCommand command) {
        throw new UnsupportedOperationException(
                "Razorpay checkout is not implemented yet; switch app.billing.provider "
                        + "to 'stripe' (see README, Phase 4). A real implementation creates "
                        + "an order via POST /v1/orders and returns its id for Razorpay Checkout.");
    }

    @Override
    public VerifiedEvent verifyAndDecode(String payload, String signatureHeader) {
        throw new UnsupportedOperationException(
                "Razorpay webhook verification is not implemented yet; switch "
                        + "app.billing.provider to 'stripe'. A real implementation checks "
                        + "X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret).");
    }
}
