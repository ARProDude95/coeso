package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.OfficeHourBooking;
import com.coeso.roster.entity.OfficeHourSlot;
import com.coeso.roster.entity.PayoutLedgerEntry;
import com.coeso.roster.officehours.OfficeHoursRepos.OfficeHourBookingRepository;
import com.coeso.roster.officehours.OfficeHoursRepos.OfficeHourSlotRepository;
import com.coeso.roster.officehours.OfficeHoursRepos.PayoutLedgerEntryRepository;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * Paid office hours:
 *  - only expert members publish slots (flagged by owner/admin),
 *  - server-side validation of startsAt / duration / price,
 *  - booking with an unconfigured provider answers 503 and persists nothing,
 *  - the payment webhook confirms / cancels / refunds through the booking
 *    status machine, idempotently, and splits money by the workspace
 *    commission (default 10%),
 *  - tenant isolation: cross-workspace booking ids are refused,
 *  - payouts and the meeting link follow the role rules.
 *
 * <p>Bookings inside lifecycle tests are created directly through the
 * repositories (the order flow needs Razorpay keys), so the webhook-driven
 * half is exercised against plain fixtures, exactly shaped like the rows the
 * real booking flow writes.
 */
class OfficeHoursTest extends IntegrationTest {

    private static final String RZP_WEBHOOK_SECRET =
            "whsec_test_razorpay_secret_for_signature_checks";

    @Autowired private OfficeHourSlotRepository slotRepository;
    @Autowired private OfficeHourBookingRepository bookingRepository;
    @Autowired private PayoutLedgerEntryRepository payoutRepository;
    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    // ---------------------------------------------------------------- gating

    @Test
    void onlyExpertsPublishSlotsAndAdminsFlagThem() throws Exception {
        Account owner = register("oh-owner");
        long ws = createWorkspace(owner, "OH Experts " + sfx, null);
        Account admin = register("oh-admin");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        Account member = register("oh-member");
        addMember(ws, member.userId(), WorkspaceRole.MANAGER);

        LocalDateTime start = LocalDateTime.now().plusDays(2).withSecond(0).withNano(0);
        String body = "{\"startsAt\":\"" + start + "\",\"durationMinutes\":45,"
                + "\"priceMinor\":50000}";

        // Not an expert yet.
        apiPost(member, ws, "/api/office-hours/slots", body)
                .andExpect(status().isForbidden());

        // Admin flags the member expert; a manager cannot.
        apiPut(admin, ws, "/api/office-hours/members/" + member.userId() + "/expert",
                "{\"expert\":true}").andExpect(status().isOk())
                .andExpect(jsonPath("$.expert").value(true));
        apiPut(member, ws, "/api/office-hours/members/" + member.userId() + "/expert",
                "{\"expert\":true}").andExpect(status().isForbidden());

        // Now the slot goes through; the storefront lists it with the amount.
        apiPost(member, ws, "/api/office-hours/slots", body)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.priceMinor").value(50000))
                .andExpect(jsonPath("$.status").value("OPEN"));
        var storefront = read(apiGet(owner, ws, "/api/office-hours/slots").andReturn());
        assertThat(storefront.isArray()).isTrue();

        // Server-side validation on the way in.
        apiPost(member, ws, "/api/office-hours/slots", "{\"startsAt\":\""
                + LocalDateTime.now().minusDays(1) + "\",\"durationMinutes\":30,"
                + "\"priceMinor\":1000}").andExpect(status().isBadRequest());
        apiPost(member, ws, "/api/office-hours/slots", "{\"startsAt\":\"" + start
                + "\",\"durationMinutes\":9,\"priceMinor\":1000}")
                .andExpect(status().isBadRequest());
        apiPost(member, ws, "/api/office-hours/slots", "{\"startsAt\":\"" + start
                + "\",\"durationMinutes\":30,\"priceMinor\":-5}")
                .andExpect(status().isBadRequest());
    }

    // --------------------------------------------------------------- booking

    @Test
    void bookingWithoutProviderKeysFailsCleanly() throws Exception {
        Account owner = register("oh-book");
        long ws = createWorkspace(owner, "OH Book " + sfx, null);
        Account expert = register("oh-book-exp");
        addMemberWithExpert(ws, expert.userId(), WorkspaceRole.MANAGER);
        Account member = register("oh-book-mem");
        addMember(ws, member.userId(), WorkspaceRole.MANAGER);
        long slotId = repoOpenSlot(ws, expert.userId(), 50000);

        // Missing workspace header: 400, nothing created.
        apiPost(member, null, "/api/office-hours/slots/" + slotId + "/book", null)
                .andExpect(status().isBadRequest());

        // Unconfigured provider: explicit 503 envelope.
        apiPost(member, ws, "/api/office-hours/slots/" + slotId + "/book", null)
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("BILLING_NOT_CONFIGURED"));

        // Nothing persisted: the slot is still open, no booking exists.
        assertThat(slotRepository.findById(slotId).orElseThrow().getStatus())
                .isEqualTo(OfficeHourSlot.Status.OPEN);
        assertThat(bookingRepository.findAll()
                .stream().filter(b -> b.getSlotId().equals(slotId)).count()).isZero();
    }

    // ---------------------------------------------------- webhook lifecycle

    @Test
    void captureThenRefundFlowUpdatesBookingLedgerAndSlot() throws Exception {
        Account owner = register("oh-lif");
        long ws = createWorkspace(owner, "OH Life " + sfx, null);
        Account expert = register("oh-lif-exp");
        addMemberWithExpert(ws, expert.userId(), WorkspaceRole.MANAGER);
        Account member = register("oh-lif-mem");
        addMember(ws, member.userId(), WorkspaceRole.MANAGER);
        long slotId = repoOpenSlot(ws, expert.userId(), 50000);
        OfficeHourBooking booking = repoPendingBooking(ws, slotId, expert.userId(),
                member.userId(), 50000);

        String payload = bookingEvent("payment.captured", booking, "pay_c1_" + sfx);

        // Bad signature -> 401, booking untouched.
        postWebhook(payload, "0".repeat(64)).andExpect(status().isUnauthorized());
        assertThat(bookingRepository.findById(booking.getId()).orElseThrow().getStatus())
                .isEqualTo(OfficeHourBooking.Status.PENDING);

        // Signed capture -> confirmed; slot booked; 10% commission ledger.
        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
        OfficeHourBooking confirmed = bookingRepository.findById(booking.getId()).orElseThrow();
        assertThat(confirmed.getStatus()).isEqualTo(OfficeHourBooking.Status.CONFIRMED);
        assertThat(confirmed.getProviderPaymentId()).isEqualTo("pay_c1_" + sfx);
        assertThat(confirmed.getExpertAmountMinor()).isEqualTo(45000);
        assertThat(confirmed.getPlatformAmountMinor()).isEqualTo(5000);
        assertThat(slotRepository.findById(slotId).orElseThrow().getStatus())
                .isEqualTo(OfficeHourSlot.Status.BOOKED);
        assertThat(payoutRepository.findAll()
                .stream().filter(e -> e.getBookingId().equals(booking.getId())
                        && e.getStatus() == PayoutLedgerEntry.Status.PENDING
                        && !e.isReversal())
                .count()).isEqualTo(1);

        // Duplicate capture -> no-op ("already"), still one ledger row.
        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("already"));
        assertThat(payoutRepository.findAll()
                .stream().filter(e -> e.getBookingId().equals(booking.getId()))
                .count()).isEqualTo(1);

        // Meeting link: only the expert, only a real URL.
        apiPut(member, ws, "/api/office-hours/bookings/" + booking.getId()
                + "/meeting-link", "{\"meetingLink\":\"https://meet.example.com/one\"}")
                .andExpect(status().isForbidden());
        apiPut(expert, ws, "/api/office-hours/bookings/" + booking.getId()
                + "/meeting-link", "{\"meetingLink\":\"https://meet.example.com/one\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.meetingLink").value("https://meet.example.com/one"));
        apiPut(expert, ws, "/api/office-hours/bookings/" + booking.getId()
                + "/meeting-link", "{\"meetingLink\":\"not-a-url\"}")
                .andExpect(status().isBadRequest());

        // Member cancels the paid booking -> refund pending; then the refund
        // webhook finalises: refunded, ledger reversed with a negative row,
        // slot reopens.
        apiPost(member, ws,
                "/api/office-hours/bookings/" + booking.getId() + "/cancel", "{}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REFUND_PENDING"));

        String refunded = bookingEvent("payment.refunded", booking, "pay_c1_" + sfx);
        postWebhook(refunded, sign(refunded))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
        var after = bookingRepository.findById(booking.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(OfficeHourBooking.Status.REFUNDED);
        assertThat(slotRepository.findById(slotId).orElseThrow().getStatus())
                .isEqualTo(OfficeHourSlot.Status.OPEN);
        var ledger = payoutRepository.findAll().stream()
                .filter(e -> e.getBookingId().equals(booking.getId())).toList();
        assertThat(ledger).hasSize(2);
        assertThat(ledger.stream().filter(PayoutLedgerEntry::isReversal).findFirst()
                .orElseThrow().getAmountMinor()).isEqualTo(-45000);
        assertThat(ledger.stream().filter(e -> !e.isReversal()).findFirst()
                .orElseThrow().getStatus()).isEqualTo(PayoutLedgerEntry.Status.REVERSED);

        // Mark a payout paid is admin-gated; the expert's ledger view works.
        // The pending row after the refund is the negative reversal.
        Long pendingEntryId = ledger.stream()
                .filter(e -> e.getStatus() == PayoutLedgerEntry.Status.PENDING)
                .findFirst().orElseThrow().getId();
        apiGet(expert, ws, "/api/office-hours/payouts").andExpect(status().isOk());
        apiPost(member, ws, "/api/office-hours/payouts/" + pendingEntryId + "/paid",
                null).andExpect(status().isForbidden());
        apiPost(adminAccount(ws), ws, ledgerPaidPath(pendingEntryId), "{}")
                .andExpect(status().isOk());
        apiGet(member, ws, "/api/office-hours/bookings").andExpect(status().isOk());
    }

    @Test
    void failedPaymentCancelsBookingAndReopensSlotIdempotently() throws Exception {
        Account owner = register("oh-fail");
        long ws = createWorkspace(owner, "OH Fail " + sfx, null);
        Account expert = register("oh-fail-exp");
        addMemberWithExpert(ws, expert.userId(), WorkspaceRole.MANAGER);
        long slotId = repoOpenSlot(ws, expert.userId(), 30000);
        OfficeHourBooking booking = repoPendingBooking(ws, slotId, expert.userId(),
                owner.userId(), 30000);

        String payload = bookingEvent("payment.failed", booking, "pay_f1_" + sfx);
        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("applied"));
        assertThat(bookingRepository.findById(booking.getId()).orElseThrow().getStatus())
                .isEqualTo(OfficeHourBooking.Status.CANCELLED);
        assertThat(slotRepository.findById(slotId).orElseThrow().getStatus())
                .isEqualTo(OfficeHourSlot.Status.OPEN);
        assertThat(payoutRepository.findAll().stream()
                .filter(e -> e.getBookingId().equals(booking.getId())).count()).isZero();

        // Replay: another no-op, no state change.
        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("already"));

        // Unknown event type is acknowledged but ignored.
        String ignored = bookingEvent("subscription.charged", booking, "pay_f2_" + sfx);
        postWebhook(ignored, sign(ignored))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("ignored"));
        assertThat(bookingRepository.findById(booking.getId()).orElseThrow().getStatus())
                .isEqualTo(OfficeHourBooking.Status.CANCELLED);
    }

    @Test
    void crossWorkspaceBookingIsRefused() throws Exception {
        Account ownerA = register("oh-ten-a");
        long wsA = createWorkspace(ownerA, "OH Ten A " + sfx, null);
        Account ownerB = register("oh-ten-b");
        long wsB = createWorkspace(ownerB, "OH Ten B " + sfx, null);
        Account expert = register("oh-ten-exp");
        addMemberWithExpert(wsA, expert.userId(), WorkspaceRole.MANAGER);
        long slotA = repoOpenSlot(wsA, expert.userId(), 40000);
        OfficeHourBooking bookingA = repoPendingBooking(wsA, slotA, expert.userId(),
                ownerA.userId(), 40000);

        // Notes claim workspace B for a booking that lives in A: refused and
        // nothing changes on either side.
        String payload = "{\"event\":\"payment.captured\",\"payload\":{\"payment\":"
                + "{\"entity\":{\"id\":\"pay_x1_" + sfx + "\",\"notes\":{"
                + "\"workspace_id\":\"" + wsB + "\",\"booking_id\":\""
                + bookingA.getId() + "\"}}}}}";
        postWebhook(payload, sign(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outcome").value("unknown-booking"));
        assertThat(bookingRepository.findById(bookingA.getId()).orElseThrow().getStatus())
                .isEqualTo(OfficeHourBooking.Status.PENDING);

        // Tenant isolation on the REST side too: workspace B cannot see A's
        // slots, nor touch A's bookings (404 keeps rows unguessable).
        var slotsB = read(apiGet(ownerB, wsB, "/api/office-hours/slots").andReturn());
        assertThat(slotsB.toString()).doesNotContain(String.valueOf(slotA));
        apiPut(ownerB, wsB, "/api/office-hours/bookings/" + bookingA.getId()
                + "/meeting-link", "{\"meetingLink\":\"https://meet.example.com/x\"}")
                .andExpect(status().isNotFound());
    }

    @Test
    void commissionIsConfigurablePerWorkspace() throws Exception {
        Account owner = register("oh-comm");
        long ws = createWorkspace(owner, "OH Comm " + sfx, null);
        Account manager = register("oh-comm-mgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);

        // Default 10%.
        apiGet(owner, ws, "/api/office-hours/commission").andExpect(status().isOk())
                .andExpect(jsonPath("$.commissionBp").value(1000));

        // Manager cannot set it; owner can (capped validation first).
        apiPut(manager, ws, "/api/office-hours/commission", "{\"commissionBp\":2000}")
                .andExpect(status().isForbidden());
        apiPut(owner, ws, "/api/office-hours/commission", "{\"commissionBp\":6000}")
                .andExpect(status().isBadRequest());
        apiPut(owner, ws, "/api/office-hours/commission", "{\"commissionBp\":2000}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commissionBp").value(2000));

        Account expert = register("oh-comm-exp");
        addMemberWithExpert(ws, expert.userId(), WorkspaceRole.MANAGER);
        long slotId = repoOpenSlot(ws, expert.userId(), 100000);
        OfficeHourBooking booking = repoPendingBooking(ws, slotId, expert.userId(),
                owner.userId(), 100000, 2000);
        // Commission captured at booking time = 20% of 100000.
        assertThat(booking.getExpertAmountMinor()).isEqualTo(80000);
        assertThat(booking.getPlatformAmountMinor()).isEqualTo(20000);

        String payload = bookingEvent("payment.captured", booking, "pay_cm_" + sfx);
        postWebhook(payload, sign(payload)).andExpect(status().isOk());
        var entry = payoutRepository.findAll().stream()
                .filter(e -> e.getBookingId().equals(booking.getId()))
                .findFirst().orElseThrow();
        assertThat(entry.getAmountMinor()).isEqualTo(80000);
        assertThat(entry.getPlatformAmountMinor()).isEqualTo(20000);
    }

    // ---------------------------------------------------------------- helpers

    private Account adminAccount(long ws) {
        Account admin = register("oh-admin-");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        return admin;
    }

    private String ledgerPaidPath(Long entryId) {
        return "/api/office-hours/payouts/" + entryId + "/paid";
    }

    /** Adds as a member AND flags expert through the repository. */
    private void addMemberWithExpert(long ws, Long userId, WorkspaceRole role) {
        Membership membership = new Membership();
        membership.setWorkspaceId(ws);
        membership.setUserId(userId);
        membership.setRole(role);
        membership.setExpert(true);
        membershipRepository.save(membership);
    }

    private long repoOpenSlot(long ws, Long expertUserId, long priceMinor) {
        OfficeHourSlot slot = new OfficeHourSlot();
        slot.setWorkspaceId(ws);
        slot.setExpertUserId(expertUserId);
        slot.setStartsAt(LocalDateTime.now().plusDays(3).withSecond(0).withNano(0));
        slot.setDurationMinutes(30);
        slot.setPriceMinor(priceMinor);
        slot.setCurrency("INR");
        slot.setStatus(OfficeHourSlot.Status.OPEN);
        slotRepository.save(slot);
        return slot.getId();
    }

    private OfficeHourBooking repoPendingBooking(long ws, long slotId, Long expertUserId,
                                                 Long memberUserId, long priceMinor,
                                                 int commissionBp) {
        OfficeHourBooking booking = new OfficeHourBooking();
        booking.setWorkspaceId(ws);
        booking.setSlotId(slotId);
        booking.setExpertUserId(expertUserId);
        booking.setMemberUserId(memberUserId);
        booking.setStatus(OfficeHourBooking.Status.PENDING);
        booking.setPriceMinor(priceMinor);
        booking.setCommissionBp(commissionBp);
        booking.setExpertAmountMinor(priceMinor - priceMinor * commissionBp / 10_000);
        booking.setPlatformAmountMinor(priceMinor * commissionBp / 10_000);
        booking.setCurrency("INR");
        booking.setProvider("razorpay");
        booking.setProviderOrderId("order_fix_" + sfx);
        return bookingRepository.save(booking);
    }

    private OfficeHourBooking repoPendingBooking(long ws, long slotId, Long expertUserId,
                                                 Long memberUserId, long priceMinor) {
        return repoPendingBooking(ws, slotId, expertUserId, memberUserId, priceMinor, 1000);
    }

    /** The webhook body Razorpay sends for office-hour payments. */
    private String bookingEvent(String type, OfficeHourBooking booking, String paymentId) {
        return "{\"event\":\"" + type + "\",\"payload\":{\"payment\":{\"entity\":"
                + "{\"id\":\"" + paymentId + "\",\"order_id\":\""
                + booking.getProviderOrderId() + "\",\"notes\":{"
                + "\"workspace_id\":\"" + booking.getWorkspaceId() + "\","
                + "\"booking_id\":\"" + booking.getId() + "\"}}}}}";
    }

    private org.springframework.test.web.servlet.ResultActions postWebhook(
            String payload, String signature) throws Exception {
        var request = org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .post("/api/payments/webhooks/razorpay")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload);
        if (signature != null) {
            request.header("X-Razorpay-Signature", signature);
        }
        return mockMvc.perform(request);
    }

    /** Independent HMAC-SHA256 over the raw body (the Razorpay scheme). */
    private static String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(
                    RZP_WEBHOOK_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
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
