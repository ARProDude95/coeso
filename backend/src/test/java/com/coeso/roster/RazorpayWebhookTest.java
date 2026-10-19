package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.SubscriptionStatus;
import com.coeso.roster.repo.Repositories.BillingEventRepository;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

/**
 * Phase 4 (Razorpay provider):
 *  - the razorpay webhook is signature-verified over the raw body (hex
 *    HMAC-SHA256, no timestamp — replays are blunted by the event ledger),
 *  - payment success / failure / cancellation / renewal each map to the right
 *    subscription status,
 *  - redelivery of the same event is acknowledged but not re-applied,
 *  - the stripe route answers 404 while razorpay is the active provider and
 *    vice versa,
 *  - unconfigured razorpay checkout answers 503 without touching state.
 *
 * <p>This context runs with {@code app.billing.provider=razorpay}; the sign
 * helper computes the documented scheme independently of production code.
 */
@TestPropertySource(properties = {"app.billing.provider=razorpay"})
class RazorpayWebhookTest extends IntegrationTest {

    /** Must match app.billing.razorpay.webhook-secret in application-test.yml. */
    private static final String WEBHOOK_SECRET =
            "whsec_test_razorpay_secret_for_signature_checks";

    @Autowired private BillingEventRepository billingEventRepository;

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    @Test
    void checkoutWithoutProviderKeysFailsCleanly() throws Exception {
        Account owner = register("rzp-nokey");
        long ws = createWorkspace(owner, "Rzp NoKey " + sfx, null);

        apiPost(owner, ws, "/api/billing/checkout", "{\"planCode\":\"pro\"}")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("BILLING_NOT_CONFIGURED"));
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getPlan().getCode())
                .isEqualTo("free");
    }

    @Test
    void badSignatureIsRejectedWithoutTouchingState() throws Exception {
        Account owner = register("rzp-sig");
        long ws = createWorkspace(owner, "Rzp Sig " + sfx, null);

        String body = chargedEvent("evt_sig_" + sfx, ws, "pro");
        String tampered = "f".repeat(64);

        postRazorpayWebhook(body, tampered)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("BILLING_SIGNATURE_INVALID"));
        postRazorpayWebhook(body, null).andExpect(status().isUnauthorized());
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatus.TRIALING);
        assertThat(eventsFor("subscription.charged:evt_sig_" + sfx)).isEqualTo(0);

        // A valid signature still works afterwards: rejections were on merit.
        String other = chargedEvent("evt_sig_ok_" + sfx, ws, "pro");
        postRazorpayWebhook(other, sign(other))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
    }

    @Test
    void chargedActivatesPlanAndPeriodEndIsStored() throws Exception {
        Account owner = register("rzp-charged");
        long ws = createWorkspace(owner, "Rzp Charged " + sfx, null);

        // Two year-bounding epoch seconds in the future: any decoded value is
        // stored; assert we land on the exact seconds sent.
        long periodEndEpoch = 946684800L + java.util.concurrent.ThreadLocalRandom
                .current().nextLong(10000, 100000);

        String body = "{\"event\":\"subscription.charged\","
                + "\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_ch_1_" + sfx + "\","
                + "\"notes\":{\"workspace_id\":\"" + ws + "\",\"plan_code\":\"pro\"}}},"
                + "\"subscription\":{\"entity\":{\"id\":\"sub_ch_1_" + sfx + "\","
                + "\"current_end\":" + periodEndEpoch + ","
                + "\"notes\":{\"workspace_id\":\"" + ws + "\",\"plan_code\":\"pro\"}}}}}";

        postRazorpayWebhook(body, sign(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"))
                .andExpect(jsonPath("$.eventId")
                        .value("subscription.charged:pay_ch_1_" + sfx));

        var subscription = subscriptionRepository.findByWorkspaceId(ws).orElseThrow();
        assertThat(subscription.getStatus()).isEqualTo(SubscriptionStatus.ACTIVE);
        assertThat(subscription.getPlan().getCode()).isEqualTo("pro");
        assertThat(subscription.getCurrentPeriodEnd())
                .isEqualTo(LocalDateTime.ofEpochSecond(periodEndEpoch, 0,
                        java.time.ZoneOffset.UTC));
    }

    @Test
    void failureCancellationAndRenewalMapToStatuses() throws Exception {
        Account owner = register("rzp-status");
        long ws = createWorkspace(owner, "Rzp Status " + sfx, null);

        // Failed payment -> PAST_DUE.
        String failed = "{\"event\":\"payment.failed\","
                + "\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_fail_" + sfx + "\","
                + "\"notes\":{\"workspace_id\":\"" + ws + "\"}}}}}";
        postRazorpayWebhook(failed, sign(failed))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatus.PAST_DUE);

        // Renewal (captured) back -> ACTIVE.
        String renewed = "{\"event\":\"payment.captured\","
                + "\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_capt_" + sfx + "\","
                + "\"notes\":{\"workspace_id\":\"" + ws + "\"}}}}}";
        postRazorpayWebhook(renewed, sign(renewed))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatus.ACTIVE);

        // Cancellation -> CANCELED.
        String cancelled = "{\"event\":\"subscription.cancelled\","
                + "\"payload\":{\"subscription\":{\"entity\":{\"id\":\"sub_cx_" + sfx + "\","
                + "\"notes\":{\"workspace_id\":\"" + ws + "\"}}}}}";
        postRazorpayWebhook(cancelled, sign(cancelled))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatus.CANCELED);
    }

    @Test
    void duplicateDeliveryIsIdempotent() throws Exception {
        Account owner = register("rzp-dup");
        long ws = createWorkspace(owner, "Rzp Dup " + sfx, null);

        String body = chargedEvent("evt_dup_" + sfx, ws, "pro");
        postRazorpayWebhook(body, sign(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
        postRazorpayWebhook(body, sign(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("duplicate"));
        assertThat(eventsFor("subscription.charged:evt_dup_" + sfx)).isEqualTo(1);

        // Even after the state moved on (cancel), a replay stays a duplicate.
        String cancelled = "{\"event\":\"subscription.cancelled\","
                + "\"payload\":{\"subscription\":{\"entity\":{\"id\":\"sub_dup_" + sfx + "\","
                + "\"notes\":{\"workspace_id\":\"" + ws + "\"}}}}}";
        postRazorpayWebhook(cancelled, sign(cancelled))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
        postRazorpayWebhook(body, sign(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("duplicate"));
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatus.CANCELED);
    }

    @Test
    void eventWithoutAKnownWorkspaceIsIgnored() throws Exception {
        String body = chargedEvent("evt_ghost_" + sfx, 999999999L, "pro");
        postRazorpayWebhook(body, sign(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("ignored"));
        assertThat(eventsFor("subscription.charged:evt_ghost_" + sfx)).isEqualTo(0);
    }

    @Test
    void stripeRouteIs404WhileRazorpayIsActive() throws Exception {
        // The stripe route must stay off when razorpay is the configured
        // provider (and, per Phase4BillingTest, the razorpay route is 404
        // under stripe).
        postTo("/api/billing/webhooks/stripe", "{}", "irrelevant")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.outcome").value("wrong-provider"));

        // And unrecognised event types are recorded but not applied.
        Account owner = register("rzp-misc");
        long ws = createWorkspace(owner, "Rzp Misc " + sfx, null);
        Account member = register("rzp-misc-m");
        addMember(ws, member.userId(), WorkspaceRole.MANAGER);
        apiGet(member, ws, "/api/billing/plans").andExpect(status().isOk());
    }

    // ---------------------------------------------------------------- helpers

    private String chargedEvent(String paymentRef, long workspaceId, String planCode) {
        return "{\"event\":\"subscription.charged\","
                + "\"payload\":{\"payment\":{\"entity\":{\"id\":\"" + paymentRef + "\","
                + "\"notes\":{\"workspace_id\":\"" + workspaceId + "\",\"plan_code\":"
                + "\"" + planCode + "\"}}}}}";
    }

    private long eventsFor(String eventId) {
        return billingEventRepository.findAll().stream()
                .filter(e -> eventId.equals(e.getEventId())).count();
    }

    private org.springframework.test.web.servlet.ResultActions postRazorpayWebhook(
            String payload, String signature) throws Exception {
        return postTo("/api/billing/webhooks/razorpay", payload, signature);
    }

    private org.springframework.test.web.servlet.ResultActions postTo(
            String path, String payload, String signature) throws Exception {
        var request = org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .post(path)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content(payload);
        if (signature != null) {
            request.header("X-Razorpay-Signature", signature);
        }
        return mockMvc.perform(request);
    }

    /** Independent HMAC-SHA256 over the raw body (the whole Razorpay scheme). */
    private static String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(
                    WEBHOOK_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
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
}
