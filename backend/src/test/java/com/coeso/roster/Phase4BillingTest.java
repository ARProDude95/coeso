package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.SubscriptionStatus;
import com.coeso.roster.repo.Repositories.BillingEventRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * Phase 4:
 *  - a duplicate webhook delivery does not double-activate the subscription
 *    (the (provider, event_id) ledger makes it idempotent),
 *  - a bad or missing signature is rejected before any state is touched,
 *  - a downgrade beyond the target plan's limits is blocked with 409 while
 *    upgrades always pass,
 *  - checkout and plan changes are owner-only,
 *  - webhooks leave an audit row.
 *
 * <p>The Stripe webhook secret comes from application-test.yml
 * ({@code whsec_test_secret_for_signature_checks}); signatures are computed in
 * the test with the same documented scheme Stripe uses, so the verification
 * path is exercised end to end through MockMvc.
 */
class Phase4BillingTest extends IntegrationTest {

    /** Must match app.billing.stripe.webhook-secret in application-test.yml. */
    private static final String WEBHOOK_SECRET = "whsec_test_secret_for_signature_checks";

    @Autowired private BillingEventRepository billingEventRepository;

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    // ---------------------------------------------------------------- webhooks

    @Test
    void duplicateWebhookDeliveryDoesNotDoubleActivate() throws Exception {
        Account owner = register("bill-dup");
        long ws = createWorkspace(owner, "Bill Dup " + sfx, null);

        String eventId = "evt_dup_" + sfx;
        String payload = subscriptionEvent(eventId, ws, "pro", "active");

        // First delivery applies the event: subscription becomes ACTIVE on pro.
        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"))
                .andExpect(jsonPath("$.eventId").value(eventId));

        var subscription = subscriptionRepository.findByWorkspaceId(ws).orElseThrow();
        assertThat(subscription.getStatus()).isEqualTo(SubscriptionStatus.ACTIVE);
        assertThat(subscription.getPlan().getCode()).isEqualTo("pro");
        assertThat(billingEventRepository.findAll().stream()
                .filter(e -> eventId.equals(e.getEventId())).count()).isEqualTo(1);

        // Second delivery of the SAME event: acknowledged, not re-applied.
        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("duplicate"));

        var after = subscriptionRepository.findByWorkspaceId(ws).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(SubscriptionStatus.ACTIVE);
        assertThat(billingEventRepository.findAll().stream()
                .filter(e -> eventId.equals(e.getEventId())).count())
                .as("redelivery must not create a second ledger row")
                .isEqualTo(1);

        // A webhook that flips the plan back must not be undone by replaying
        // the first (older) event: the replay is still just a duplicate.
        String cancelId = "evt_cancel_" + sfx;
        String cancelPayload = subscriptionEvent(cancelId, ws, "pro", "canceled");
        postWebhook(cancelPayload, sign(cancelPayload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatus.CANCELED);

        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("duplicate"));
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getStatus())
                .as("replaying an old event must not resurrect prior state")
                .isEqualTo(SubscriptionStatus.CANCELED);

        // The applied webhook left an audit row (rule 8) with no user actor.
        assertThat(auditLogRepository.findAll().stream()
                .filter(a -> a.getEntityType().equals("subscription")
                        && a.getAction().equals("UPDATE")
                        && String.valueOf(a.getWorkspaceId()).equals(String.valueOf(ws)))
                .count()).isGreaterThanOrEqualTo(1);
    }

    @Test
    void badSignatureIsRejectedWithoutTouchingState() throws Exception {
        Account owner = register("bill-sig");
        long ws = createWorkspace(owner, "Bill Sig " + sfx, null);

        String eventId = "evt_sig_" + sfx;
        String payload = subscriptionEvent(eventId, ws, "pro", "active");
        String tamperedSignature = "t=" + Instant.now().getEpochSecond()
                + ",v1=" + "0".repeat(64);

        // Wrong signature -> 401, nothing recorded, subscription untouched.
        postWebhook(payload, tamperedSignature)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("BILLING_SIGNATURE_INVALID"));
        assertThat(billingEventRepository.findAll().stream()
                .noneMatch(e -> eventId.equals(e.getEventId()))).isTrue();
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getStatus())
                .isEqualTo(SubscriptionStatus.TRIALING);

        // Missing signature header entirely -> also 401.
        postWebhook(payload, null)
                .andExpect(status().isUnauthorized());

        // A stale timestamp (replay window exceeded) is rejected too.
        String stale = "t=" + (Instant.now().getEpochSecond() - 3600)
                + ",v1=" + signWithTimestamp(payload, Instant.now().getEpochSecond() - 3600);
        postWebhook(payload, stale)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value(
                        "Stripe signature timestamp outside tolerance"));

        // Correct signature still works afterwards: the endpoint is live, the
        // bad requests were rejected on merit.
        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
    }

    @Test
    void unknownWorkspaceEventIsAcknowledgedButIgnored() throws Exception {
        String eventId = "evt_ghost_" + sfx;
        // Workspace id 999999999 does not exist (or belongs to no one).
        String payload = subscriptionEvent(eventId, 999999999L, "pro", "active");

        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("ignored"));
        assertThat(billingEventRepository.findAll().stream()
                .noneMatch(e -> eventId.equals(e.getEventId()))).isTrue();
    }

    // ----------------------------------------------------------------- plans

    @Test
    void overLimitDowngradeIsBlockedWhileUpgradePasses() throws Exception {
        Account owner = register("bill-down");
        long ws = createWorkspace(owner, "Bill Down " + sfx, null);
        for (int i = 0; i < 60; i++) {
            repoRep(ws, "Dn Rep " + i);
        }

        // Upgrade free -> pro: always allowed (250 reps >= 60).
        apiPost(owner, ws, "/api/billing/plan", "{\"planCode\":\"pro\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planCode").value("pro"));

        // Downgrade pro -> starter: blocked, 60 reps exceed the 50 cap.
        apiPost(owner, ws, "/api/billing/plan", "{\"planCode\":\"starter\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("50 reps")));

        // Downgrade to free: blocked too; the plan is unchanged.
        apiPost(owner, ws, "/api/billing/plan", "{\"planCode\":\"free\"}")
                .andExpect(status().isConflict());
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getPlan().getCode())
                .isEqualTo("pro");

        // A move within the ceiling (pro -> unlimited) passes.
        apiPost(owner, ws, "/api/billing/plan", "{\"planCode\":\"unlimited\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planCode").value("unlimited"));
    }

    @Test
    void downgradeIsBlockedByMemberCountToo() throws Exception {
        Account owner = register("bill-mem");
        long ws = createWorkspace(owner, "Bill Mem " + sfx, null);
        for (int i = 0; i < 4; i++) {
            Account member = register("bill-mem-user" + i);
            addMember(ws, member.userId(), WorkspaceRole.MANAGER);
        }
        // 5 members now; starter caps at 10 so the upgrade passes...
        apiPost(owner, ws, "/api/billing/plan", "{\"planCode\":\"starter\"}")
                .andExpect(status().isOk());
        // ...but free caps at 3, so the downgrade is blocked by members.
        apiPost(owner, ws, "/api/billing/plan", "{\"planCode\":\"free\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("3 members")));
    }

    // ---------------------------------------------------------------- roles

    @Test
    void checkoutAndPlanChangeAreOwnerOnly() throws Exception {
        Account owner = register("bill-role");
        long ws = createWorkspace(owner, "Bill Role " + sfx, null);

        Account admin = register("bill-role-admin");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        Account manager = register("bill-role-mgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        Account rep = register("bill-role-rep");
        addMember(ws, rep.userId(), WorkspaceRole.REP);

        String body = "{\"planCode\":\"starter\"}";
        for (Account lower : new Account[] {admin, manager, rep}) {
            apiPost(lower, ws, "/api/billing/checkout", body)
                    .andExpect(status().isForbidden());
            apiPost(lower, ws, "/api/billing/plan", body)
                    .andExpect(status().isForbidden());
        }

        // Viewing plans and the subscription is fine for any member.
        apiGet(rep, ws, "/api/billing/plans").andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.code == 'free')]").exists())
                .andExpect(jsonPath("$[?(@.code == 'unlimited')]").exists());
        apiGet(rep, ws, "/api/billing/subscription").andExpect(status().isOk())
                .andExpect(jsonPath("$.planCode").value("free"))
                .andExpect(jsonPath("$.status").value("TRIALING"));

        // The current plan is flagged on the pricing list.
        var plans = read(apiGet(owner, ws, "/api/billing/plans").andReturn());
        assertThat(plans.isArray()).isTrue();
        long currentCount = 0;
        for (var plan : plans) {
            if (plan.get("current").asBoolean()) {
                currentCount++;
                assertThat(plan.get("code").asText()).isEqualTo("free");
            }
        }
        assertThat(currentCount).isEqualTo(1);
    }

    @Test
    void checkoutWithoutProviderKeysFailsCleanly() throws Exception {
        Account owner = register("bill-nokey");
        long ws = createWorkspace(owner, "Bill NoKey " + sfx, null);

        // Tests run without STRIPE_SECRET_KEY: checkout must answer 503 with a
        // clear message instead of an opaque 500, and must not touch state.
        apiPost(owner, ws, "/api/billing/checkout", "{\"planCode\":\"pro\"}")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("BILLING_NOT_CONFIGURED"));
        assertThat(subscriptionRepository.findByWorkspaceId(ws).orElseThrow().getPlan().getCode())
                .isEqualTo("free");

        // Unknown plan codes are a 404, missing planCode a 400.
        apiPost(owner, ws, "/api/billing/plan", "{\"planCode\":\"enterprise\"}")
                .andExpect(status().isNotFound());
        apiPost(owner, ws, "/api/billing/plan", "{}")
                .andExpect(status().isBadRequest());
    }

    // ---------------------------------------------------------------- helpers

    private org.springframework.test.web.servlet.ResultActions postWebhook(
            String payload, String signature) throws Exception {
        var request = org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .post("/api/billing/webhooks/stripe")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload);
        if (signature != null) {
            request.header("Stripe-Signature", signature);
        }
        return mockMvc.perform(request);
    }

    /**
     * A customer.subscription.updated event carrying the workspace id and plan
     * code in metadata, exactly as {@code StripeBillingProvider.createCheckout}
     * would have set them.
     */
    private String subscriptionEvent(String eventId, long workspaceId, String planCode,
                                     String status) {
        return "{"
                + "\"id\":\"" + eventId + "\","
                + "\"type\":\"customer.subscription.updated\","
                + "\"data\":{\"object\":{"
                + "\"status\":\"" + status + "\","
                + "\"metadata\":{\"workspace_id\":\"" + workspaceId + "\","
                + "\"plan_code\":\"" + planCode + "\"}"
                + "}}}";
    }

    /** Signs with the current timestamp: {@code t=<now>,v1=<hmac>}. */
    private String sign(String payload) {
        long timestamp = Instant.now().getEpochSecond();
        return "t=" + timestamp + ",v1=" + signWithTimestamp(payload, timestamp);
    }

    /** Just the v1 hex digest for a fixed timestamp. */
    private String signWithTimestamp(String payload, long timestamp) {
        return hmacSha256Hex(WEBHOOK_SECRET, timestamp + "." + payload);
    }

    /**
     * Independent HMAC-SHA256 implementation (does not reuse the production
     * helper) so the test verifies the scheme, not just self-consistency.
     */
    private static String hmacSha256Hex(String secret, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
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
