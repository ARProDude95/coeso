package com.coeso.roster.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Razorpay billing provider — full implementation behind the same
 * {@link BillingProvider} interface Stripe implements, selected by
 * {@code app.billing.provider}.
 *
 * <p>How this one differs from Stripe (both documented Razorpay behaviours):
 * <ul>
 *   <li><b>Checkout</b>: create an order via
 *       {@code POST https://api.razorpay.com/v1/orders} with HTTP Basic auth
 *       ({@code key_id:key_secret}), amount in paise, {@code currency: inr},
 *       and the workspace id + plan code riding as {@code notes} (Razorpay
 *       copies order notes onto the events it fires). There is NO hosted
 *       redirect URL like Stripe's: the returned order id is handed to the
 *       frontend, which opens Razorpay Checkout.js with it. The session's
 *       {@code providerSubscriptionId} carries the order id and
 *       {@code url} is null for Razorpay.</li>
 *   <li><b>Webhook verification</b>: the {@code X-Razorpay-Signature} header
 *       is the hex HMAC-SHA256 of the <b>raw body</b> using
 *       {@code app.billing.razorpay.webhook-secret} — no timestamp component
 *       and therefore no replay tolerance of its own; replays are blunted by
 *       the {@code (provider, event_id)} idempotency ledger the billing
 *       service enforces on every verified event.</li>
 *   <li><b>Event mapping</b>: {@code subscription.activated} /
 *       {@code subscription.charged} / {@code payment.captured} → ACTIVE,
 *       {@code subscription.halted} / {@code payment.failed} → PAST_DUE,
 *       {@code subscription.cancelled} → CANCELED. Workspace id and plan code
 *       come only from the verified payload's notes, never from headers.</li>
 * </ul>
 *
 * <p>Verification reuses {@link StripeBillingProvider#hmacSha256Hex} and
 * {@link StripeBillingProvider#constantTimeEquals} — the HMAC itself is
 * generic and already covered by tests producing signatures independently.
 */
@Component
public class RazorpayBillingProvider implements BillingProvider {

    private final ObjectMapper objectMapper;
    private final String keyId;
    private final String keySecret;
    private final String webhookSecret;
    private final String apiBase;
    private final HttpClient httpClient;

    public RazorpayBillingProvider(ObjectMapper objectMapper,
                                   @Value("${app.billing.razorpay.key-id:}") String keyId,
                                   @Value("${app.billing.razorpay.key-secret:}") String keySecret,
                                   @Value("${app.billing.razorpay.webhook-secret:}") String webhookSecret,
                                   @Value("${app.billing.razorpay.api-base:https://api.razorpay.com}") String apiBase) {
        this.objectMapper = objectMapper;
        this.keyId = keyId;
        this.keySecret = keySecret;
        this.webhookSecret = webhookSecret;
        this.apiBase = apiBase;
        this.httpClient = HttpClient.newBuilder().build();
    }

    /** True when real API credentials are present; false in dev/test. */
    public boolean configured() {
        return !(keyId == null || keyId.isBlank())
                && !(keySecret == null || keySecret.isBlank());
    }

    @Override
    public boolean isConfigured() {
        return configured();
    }

    @Override
    public String name() {
        return "razorpay";
    }

    @Override
    public CheckoutSession createCheckout(CheckoutCommand command) {
        if (!configured()) {
            throw new IllegalStateException(
                    "Razorpay is not configured; set app.billing.razorpay.key-id "
                            + "and app.billing.razorpay.key-secret");
        }
        try {
            // Razorpay wants the absolute integer amount in the smallest unit
            // (paise), exactly like Stripe's unit_amount in cents.
            Map<String, Object> fields = new LinkedHashMap<>();
            fields.put("amount", planPaise(command.planCode()));
            fields.put("currency", "inr");
            fields.put("receipt", "ws-" + command.workspaceId() + "-" + command.planCode());
            Map<String, String> notes = new LinkedHashMap<>();
            notes.put("workspace_id", String.valueOf(command.workspaceId()));
            notes.put("plan_code", command.planCode());
            fields.put("notes", notes);
            String body = objectMapper.writeValueAsString(fields);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(apiBase + "/v1/orders"))
                    .header("Authorization", basic(keyId, keySecret))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> response = httpClient.send(request,
                    HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 300) {
                throw new IllegalStateException("Razorpay order failed: HTTP "
                        + response.statusCode());
            }
            JsonNode json = objectMapper.readTree(response.body());
            // Deliberately no hosted URL: Razorpay Checkout is opened by the
            // frontend with this order id. subscription logs it as the
            // provider reference so the webhook can be reconciled.
            return new CheckoutSession(null, null, json.path("id").asText(null));
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("Razorpay order request failed", e);
        }
    }

    @Override
    public VerifiedEvent verifyAndDecode(String payload, String signatureHeader) {
        if (webhookSecret == null || webhookSecret.isBlank()) {
            throw new BillingSignatureException(
                    "Razorpay webhook secret is not configured on this server");
        }
        if (signatureHeader == null || signatureHeader.isBlank()) {
            throw new BillingSignatureException("Missing X-Razorpay-Signature header");
        }
        String expected = StripeBillingProvider.hmacSha256Hex(webhookSecret, payload);
        if (!StripeBillingProvider.constantTimeEquals(expected, signatureHeader.trim())) {
            throw new BillingSignatureException("Razorpay signature verification failed");
        }
        return decode(payload);
    }

    /** Parses an already-verified Razorpay payload into the parts this app acts on. */
    private VerifiedEvent decode(String payload) {
        try {
            JsonNode event = objectMapper.readTree(payload);
            String type = event.path("event").asText(null);
            JsonNode payloadRoot = event.path("payload");

            // Notes are copied onto the entities Razorpay fires; look under
            // payment first (one-off charges), then subscription.
            Long workspaceId = null;
            String planCode = null;
            String entityId = null;
            for (String branch : new String[] {"payment", "subscription"}) {
                JsonNode entity = payloadRoot.path(branch).path("entity");
                if (entity.isMissingNode()) {
                    continue;
                }
                if (entityId == null) {
                    entityId = entity.path("id").asText(null);
                }
                JsonNode notes = entity.path("notes");
                if (notes.isObject()) {
                    if (workspaceId == null && notes.hasNonNull("workspace_id")) {
                        workspaceId = parseLongOrNull(notes.get("workspace_id").asText());
                    }
                    if (notes.hasNonNull("plan_code")) {
                        planCode = notes.get("plan_code").asText();
                    }
                }
            }

            SubscriptionState state = SubscriptionState.UNKNOWN;
            Long periodEnd = null;
            switch (type == null ? "" : type) {
                case "subscription.activated", "subscription.charged", "payment.captured" ->
                        state = SubscriptionState.ACTIVE;
                case "subscription.halted", "payment.failed" ->
                        state = SubscriptionState.PAST_DUE;
                case "subscription.cancelled" -> state = SubscriptionState.CANCELED;
                default -> state = SubscriptionState.UNKNOWN;
            }
            JsonNode subscription = payloadRoot.path("subscription").path("entity");
            if (subscription.hasNonNull("current_end")) {
                JsonNode ce = subscription.get("current_end");
                if (ce.canConvertToLong()) {
                    periodEnd = ce.asLong();
                }
            }

            // The event id drives the (provider, event_id) idempotency ledger:
            // a payment entity id is unique per charge, a subscription entity
            // id comes with its own per-notification events. Prefixing with
            // the type keeps the two namespaces apart.
            String eventId = type == null || entityId == null ? null : type + ":" + entityId;
            if (eventId == null || eventId.isBlank() || ":".equals(eventId)) {
                throw new BillingSignatureException(
                        "Razorpay event carries no usable id — cannot make idempotent");
            }
            return new VerifiedEvent(eventId, type, workspaceId, planCode, state, periodEnd);
        } catch (BillingSignatureException e) {
            throw e;
        } catch (Exception e) {
            throw new BillingSignatureException("Razorpay event payload is not valid JSON");
        }
    }

    private static long planPaise(String planCode) {
        // Same price ladder Stripe encodes in cents, expressed in paise (INR).
        return switch (planCode == null ? "" : planCode) {
            case "starter" -> 249000;    // ₹2,490
            case "pro" -> 659000;        // ₹6,590
            case "unlimited" -> 1659000; // ₹16,590
            default -> 0;                // free
        };
    }

    private static String basic(String user, String secret) {
        String token = java.util.Base64.getEncoder().encodeToString(
                (user + ":" + secret).getBytes(StandardCharsets.UTF_8));
        return "Basic " + token;
    }

    private static Long parseLongOrNull(String raw) {
        try {
            return Long.parseLong(raw);
        } catch (Exception e) {
            return null;
        }
    }
}
