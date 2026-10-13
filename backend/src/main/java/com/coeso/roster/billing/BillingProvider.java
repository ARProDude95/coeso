package com.coeso.roster.billing;

/**
 * Payment provider abstraction. Stripe is fully implemented; Razorpay is a
 * documented stub behind the same interface, selected by
 * {@code app.billing.provider}.
 *
 * <p>Deliberately SDK-free: both providers authenticate webhooks with an HMAC
 * over the raw payload, which is a few lines of JDK code, and checkout is one
 * REST call. That keeps the dependency tree small and makes signature
 * verification testable without network access.
 */
public interface BillingProvider {

    /** Stable provider key stored on subscriptions / billing_events. */
    String name();

    /**
     * True when the provider has its keys configured. An unconfigured provider
     * answers checkout with 503 instead of failing obscurely; webhooks for it
     * are still rejected (no secret to verify against).
     */
    default boolean isConfigured() {
        return true;
    }

    /**
     * Creates a hosted checkout for one workspace's plan change and returns
     * where to send the user. The workspace id travels back to us as the
     * session's client reference, never as a trust decision by the provider.
     */
    CheckoutSession createCheckout(CheckoutCommand command);

    /**
     * Verifies the provider's signature over the raw webhook body and decodes
     * the event. Implementations MUST reject a bad or missing signature by
     * throwing {@link BillingSignatureException} — the caller never parses an
     * unverified payload.
     */
    VerifiedEvent verifyAndDecode(String payload, String signatureHeader);

    record CheckoutCommand(Long workspaceId, String planCode, String successUrl,
                           String cancelUrl) {
    }

    record CheckoutSession(String url, String providerCustomerId, String providerSubscriptionId) {
    }

    /**
     * The parts of a webhook event this app acts on. {@code eventId} drives
     * idempotency; {@code workspaceId} and {@code planCode} come only from the
     * verified payload (plus our own client reference), never from headers.
     */
    record VerifiedEvent(String eventId, String type, Long workspaceId, String planCode,
                         SubscriptionState state, Long periodEndEpochSeconds) {
    }

    /** Provider-normalised subscription status. */
    enum SubscriptionState {
        TRIALING, ACTIVE, PAST_DUE, CANCELED, INCOMPLETE, UNPAID, INCOMPLETE_EXPIRED, UNKNOWN
    }
}
