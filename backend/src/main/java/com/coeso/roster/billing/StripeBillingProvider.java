package com.coeso.roster.billing;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Stripe billing provider.
 *
 * <p>Webhook verification implements Stripe's documented scheme: the
 * {@code Stripe-Signature} header carries {@code t=<unix>,v1=<hex>} entries;
 * {@code v1} is the hex HMAC-SHA256 of {@code "<t>.<raw body>"} using the
 * webhook signing secret. Signatures older than the tolerance window are
 * rejected to blunt replay attacks.
 *
 * <p>Checkout is a single form-encoded POST to the Checkout Sessions API. The
 * workspace id rides along as {@code client_reference_id} and in metadata, so
 * when the webhook arrives we learn the workspace from the verified payload —
 * the provider never tells us anything we did not put there.
 *
 * <p>With no secret key configured (local dev, CI) the provider reports
 * {@code configured() == false}; the billing service answers with a clear 503
 * instead of a confusing NPE, and webhook tests inject events through the
 * same verified-decode path with a test secret.
 */
@Component
public class StripeBillingProvider implements BillingProvider {

    /** Tolerance for signature timestamps, in seconds (Stripe recommends 300). */
    static final long TOLERANCE_SECONDS = 300;

    private final ObjectMapper objectMapper;
    private final String secretKey;
    private final String webhookSecret;
    private final String apiBase;
    private final HttpClient httpClient;

    public StripeBillingProvider(ObjectMapper objectMapper,
                                 @Value("${app.billing.stripe.secret-key:}") String secretKey,
                                 @Value("${app.billing.stripe.webhook-secret:}") String webhookSecret,
                                 @Value("${app.billing.stripe.api-base:https://api.stripe.com}") String apiBase) {
        this.objectMapper = objectMapper;
        this.secretKey = secretKey;
        this.webhookSecret = webhookSecret;
        this.apiBase = apiBase;
        this.httpClient = HttpClient.newBuilder().build();
    }

    /** True when real credentials are present; false in dev/test. */
    public boolean configured() {
        return !secretKey.isBlank();
    }

    @Override
    public boolean isConfigured() {
        return configured();
    }

    @Override
    public String name() {
        return "stripe";
    }

    @Override
    public CheckoutSession createCheckout(CheckoutCommand command) {
        if (!configured()) {
            throw new IllegalStateException(
                    "Stripe is not configured; set app.billing.stripe.secret-key");
        }
        try {
            Map<String, String> fields = new LinkedHashMap<>();
            fields.put("mode", "subscription");
            fields.put("client_reference_id", String.valueOf(command.workspaceId()));
            fields.put("success_url", command.successUrl());
            fields.put("cancel_url", command.cancelUrl());
            fields.put("line_items[0][quantity]", "1");
            // Price ids are Stripe objects; we use price_data so no pre-created
            // product/price is needed. The plan code also travels in metadata
            // so the webhook can resolve it.
            fields.put("line_items[0][price_data][currency]", "usd");
            fields.put("line_items[0][price_data][unit_amount]", priceCents(command.planCode()));
            fields.put("line_items[0][price_data][recurring][interval]", "month");
            fields.put("line_items[0][price_data][product_data][name]",
                    "Roster plan: " + command.planCode());
            fields.put("metadata[workspace_id]", String.valueOf(command.workspaceId()));
            fields.put("metadata[plan_code]", command.planCode());
            fields.put("subscription_data[metadata][workspace_id]",
                    String.valueOf(command.workspaceId()));
            fields.put("subscription_data[metadata][plan_code]", command.planCode());
            String body = form(fields);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(apiBase + "/v1/checkout/sessions"))
                    .header("Authorization", "Bearer " + secretKey)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            HttpResponse<String> response = httpClient.send(request,
                    HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 300) {
                throw new IllegalStateException("Stripe checkout failed: HTTP "
                        + response.statusCode());
            }
            JsonNode json = objectMapper.readTree(response.body());
            return new CheckoutSession(
                    json.path("url").asText(null),
                    json.path("customer").asText(null),
                    json.path("subscription").asText(null));
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("Stripe checkout request failed", e);
        }
    }

    @Override
    public VerifiedEvent verifyAndDecode(String payload, String signatureHeader) {
        if (webhookSecret.isBlank()) {
            throw new BillingSignatureException(
                    "Stripe webhook secret is not configured on this server");
        }
        if (signatureHeader == null || signatureHeader.isBlank()) {
            throw new BillingSignatureException("Missing Stripe-Signature header");
        }

        long timestamp = -1;
        String candidate = null;
        for (String part : signatureHeader.split(",")) {
            String[] kv = part.trim().split("=", 2);
            if (kv.length != 2) {
                continue;
            }
            if ("t".equals(kv[0])) {
                try {
                    timestamp = Long.parseLong(kv[1]);
                } catch (NumberFormatException e) {
                    throw new BillingSignatureException("Malformed Stripe timestamp");
                }
            } else if ("v1".equals(kv[0])) {
                candidate = kv[1]; // last v1 wins; verified below
            }
        }
        if (timestamp < 0 || candidate == null) {
            throw new BillingSignatureException(
                    "Stripe-Signature must contain t and v1 components");
        }

        long age = Math.abs(Instant.now().getEpochSecond() - timestamp);
        if (age > TOLERANCE_SECONDS) {
            throw new BillingSignatureException("Stripe signature timestamp outside tolerance");
        }

        String expected = hmacSha256Hex(webhookSecret, timestamp + "." + payload);
        if (!constantTimeEquals(expected, candidate)) {
            throw new BillingSignatureException("Stripe signature verification failed");
        }

        return decode(payload);
    }

    /** Parses an already-verified payload into the parts this app acts on. */
    private VerifiedEvent decode(String payload) {
        try {
            JsonNode event = objectMapper.readTree(payload);
            String eventId = event.path("id").asText(null);
            String type = event.path("type").asText(null);
            JsonNode object = event.path("data").path("object");

            Long workspaceId = null;
            String planCode = null;
            if (object.hasNonNull("client_reference_id")) {
                workspaceId = parseLongOrNull(object.get("client_reference_id").asText());
            }
            if (object.hasNonNull("metadata") && object.get("metadata").has("workspace_id")) {
                workspaceId = parseLongOrNull(
                        object.get("metadata").get("workspace_id").asText());
            }
            if (object.hasNonNull("metadata") && object.get("metadata").has("plan_code")) {
                planCode = object.get("metadata").get("plan_code").asText();
            }

            SubscriptionState state = SubscriptionState.UNKNOWN;
            Long periodEnd = null;
            switch (type == null ? "" : type) {
                case "checkout.session.completed" -> {
                    state = object.path("payment_status").asText("paid").equals("paid")
                            ? SubscriptionState.ACTIVE : SubscriptionState.INCOMPLETE;
                    // Subscription state is tracked by the customer.subscription.*
                    // events that follow; metadata above already carries the plan.
                }
                case "customer.subscription.created", "customer.subscription.updated" -> {
                    state = mapStatus(object.path("status").asText(""));
                    if (object.hasNonNull("current_period_end")) {
                        periodEnd = object.get("current_period_end").asLong();
                    }
                    if (object.hasNonNull("metadata")
                            && object.get("metadata").has("plan_code")) {
                        planCode = object.get("metadata").get("plan_code").asText();
                    }
                }
                case "customer.subscription.deleted" -> state = SubscriptionState.CANCELED;
                case "invoice.payment_failed" -> state = SubscriptionState.PAST_DUE;
                case "invoice.paid" -> state = SubscriptionState.ACTIVE;
                default -> state = SubscriptionState.UNKNOWN;
            }
            return new VerifiedEvent(eventId, type, workspaceId, planCode, state, periodEnd);
        } catch (BillingSignatureException e) {
            throw e;
        } catch (Exception e) {
            throw new BillingSignatureException("Stripe event payload is not valid JSON");
        }
    }

    private static SubscriptionState mapStatus(String status) {
        return switch (status) {
            case "trialing" -> SubscriptionState.TRIALING;
            case "active" -> SubscriptionState.ACTIVE;
            case "past_due", "unpaid" -> SubscriptionState.PAST_DUE;
            case "canceled" -> SubscriptionState.CANCELED;
            case "incomplete" -> SubscriptionState.INCOMPLETE;
            case "incomplete_expired" -> SubscriptionState.INCOMPLETE_EXPIRED;
            default -> SubscriptionState.UNKNOWN;
        };
    }

    private static String priceCents(String planCode) {
        return switch (planCode == null ? "" : planCode) {
            case "starter" -> "2900";
            case "pro" -> "7900";
            case "unlimited" -> "19900";
            default -> "0"; // free
        };
    }

    static String hmacSha256Hex(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16))
                        .append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", e);
        }
    }

    static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) {
            return false;
        }
        int diff = 0;
        for (int i = 0; i < a.length(); i++) {
            diff |= a.charAt(i) ^ b.charAt(i);
        }
        return diff == 0;
    }

    private static Long parseLongOrNull(String raw) {
        try {
            return Long.parseLong(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static String form(java.util.Map<String, String> fields) {
        StringBuilder sb = new StringBuilder();
        for (var entry : fields.entrySet()) {
            if (!sb.isEmpty()) {
                sb.append('&');
            }
            sb.append(urlEncode(entry.getKey())).append('=').append(urlEncode(entry.getValue()));
        }
        return sb.toString();
    }

    private static String urlEncode(String raw) {
        return java.net.URLEncoder.encode(raw, StandardCharsets.UTF_8);
    }
}
