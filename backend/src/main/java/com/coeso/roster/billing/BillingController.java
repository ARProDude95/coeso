package com.coeso.roster.billing;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Billing endpoints.
 *
 * <p>{@code /api/billing/webhooks/stripe} is deliberately outside the JWT and
 * tenant filter chain: payment providers call it server-to-server with no user
 * session. Trust is established solely by the provider's signature over the
 * raw body, which is why the controller takes the body as a String (a parsed
 * DTO would lose the exact bytes the signature covers) and never populates
 * TenantContext from it.
 */
@RestController
@RequestMapping("/api/billing")
public class BillingController {

    private final BillingService billingService;
    private final BillingProviders providers;

    public BillingController(BillingService billingService, BillingProviders providers) {
        this.billingService = billingService;
        this.providers = providers;
    }

    /** Pricing page data: all plans, current one flagged. Any member may view. */
    @GetMapping("/plans")
    public List<BillingService.PlanView> plans() {
        return billingService.listPlans();
    }

    /** The workspace's subscription (plan, status, trial end). */
    @GetMapping("/subscription")
    public BillingService.SubscriptionView subscription() {
        return billingService.currentSubscription();
    }

    /** Starts hosted checkout for a plan (owner only). */
    @PostMapping("/checkout")
    public BillingService.CheckoutView checkout(@RequestBody Map<String, String> body) {
        return billingService.checkout(body.get("planCode"));
    }

    /** Switches plan without payment (owner only; blocked when over limits). */
    @PostMapping("/plan")
    public BillingService.SubscriptionView changePlan(@RequestBody Map<String, String> body) {
        return billingService.changePlan(body.get("planCode"));
    }

    /**
     * Stripe webhook. Signature-verified against the raw body; duplicates are
     * skipped via the (provider, event_id) ledger. Responds 200 for anything
     * acknowledged (applied, duplicate, ignored) so the provider stops
     * retrying; 401 for a bad signature; 400 for a malformed event.
     */
    @PostMapping("/webhooks/stripe")
    public ResponseEntity<Map<String, String>> stripeWebhook(
            @RequestBody String payload,
            @RequestHeader(value = "Stripe-Signature", required = false) String signature) {
        return webhook("stripe", payload, signature);
    }

    /**
     * Razorpay webhook: same guarantees as Stripe's, with the provider's own
     * header ({@code X-Razorpay-Signature}, hex HMAC over the raw body with no
     * timestamp) and its event shape. Route is live only when Razorpay is the
     * configured provider, mirroring the Stripe route.
     */
    @PostMapping("/webhooks/razorpay")
    public ResponseEntity<Map<String, String>> razorpayWebhook(
            @RequestBody String payload,
            @RequestHeader(value = "X-Razorpay-Signature", required = false) String signature) {
        return webhook("razorpay", payload, signature);
    }

    /** Shared webhook path: wrong-provider -> 404, verify -> apply, ledger. */
    private ResponseEntity<Map<String, String>> webhook(String providerName,
                                                        String payload, String signature) {
        if (!providerName.equals(providers.active().name())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("outcome", "wrong-provider"));
        }
        BillingProvider provider = providers.active();
        // Signature check throws BillingSignatureException -> 401 in the
        // exception handler. Nothing is parsed or persisted before this passes.
        BillingProvider.VerifiedEvent event = provider.verifyAndDecode(payload, signature);
        BillingService.WebhookResult result = billingService.processVerifiedEvent(event, payload);
        return ResponseEntity.ok(Map.of("outcome", result.outcome(), "eventId", result.eventId()));
    }
}
