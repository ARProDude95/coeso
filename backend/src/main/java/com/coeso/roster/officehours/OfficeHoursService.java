package com.coeso.roster.officehours;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.billing.BillingUnavailableException;
import com.coeso.roster.billing.RazorpayBillingProvider;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ForbiddenException;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.UnauthorizedException;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.OfficeHourBooking;
import com.coeso.roster.entity.OfficeHourSlot;
import com.coeso.roster.entity.PayoutLedgerEntry;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import org.springframework.stereotype.Service;

/**
 * Paid office hours: expert members publish bookable paid time slots; other
 * members book them and pay through Razorpay. A booking is only CONFIRMED
 * once the verified payment webhook arrives — the client never reports
 * success. Every status transition (book, cancel, refund) leaves an audit
 * row, and settled expert proceeds land in the payout ledger (platform
 * commission configurable per workspace, default 10%).
 *
 * <p>Payments deliberately target Razorpay (the platform's INR rail): there
 * is no hosted-redirect URL round-trip for bookings, the frontend opens
 * Razorpay Checkout.js with the returned order id, and confirmation arrives
 * on {@code POST /api/payments/webhooks/razorpay}.
 */
@Service
public class OfficeHoursService {

    public record SlotRequest(
            LocalDateTime startsAt,
            Integer durationMinutes,
            Long priceMinor,
            String currency) {
    }

    /** Slot as the storefront shows it: expert display name resolved. */
    public record SlotView(Long id, Long expertUserId, String expertName,
                           LocalDateTime startsAt, Integer durationMinutes,
                           long priceMinor, String currency, String status) {
    }

    public record BookingView(Long id, Long slotId, Long expertUserId,
                              Long memberUserId, String status, long priceMinor,
                              long expertAmountMinor, long platformAmountMinor,
                              String currency, String meetingLink,
                              String providerOrderId, LocalDateTime confirmedAt,
                              LocalDateTime cancelledAt, LocalDateTime startsAt,
                              Integer durationMinutes, String expertName,
                              LocalDateTime createdAt) {
    }

    public record PayoutView(Long id, Long bookingId, Long expertUserId, String status,
                             long amountMinor, long platformAmountMinor, String currency,
                             boolean reversal, LocalDateTime createdAt) {
    }

    private static final int MAX_COMMISSION_BP = 5000;
    private static final int DEFAULT_COMMISSION_BP = 1000;

    private final OfficeHoursRepos.OfficeHourSlotRepository slots;
    private final OfficeHoursRepos.OfficeHourBookingRepository bookings;
    private final OfficeHoursRepos.PayoutLedgerEntryRepository payouts;
    private final OfficeHoursRepos.MembershipExpertRepository memberships;
    private final WorkspaceRepository workspaces;
    private final RazorpayBillingProvider razorpay;
    private final AuditService audit;

    public OfficeHoursService(OfficeHoursRepos.OfficeHourSlotRepository slots,
                              OfficeHoursRepos.OfficeHourBookingRepository bookings,
                              OfficeHoursRepos.PayoutLedgerEntryRepository payouts,
                              OfficeHoursRepos.MembershipExpertRepository memberships,
                              WorkspaceRepository workspaces,
                              RazorpayBillingProvider razorpay,
                              AuditService audit) {
        this.slots = slots;
        this.bookings = bookings;
        this.payouts = payouts;
        this.memberships = memberships;
        this.workspaces = workspaces;
        this.razorpay = razorpay;
        this.audit = audit;
    }

    // ------------------------------------------------------------------ slots

    /** Storefront: every open, future slot in the workspace, soonest first. */
    public java.util.List<SlotView> openSlots() {
        Long ws = TenantContext.requireWorkspaceId();
        return slots.findByWorkspaceIdAndStatus(ws, OfficeHourSlot.Status.OPEN).stream()
                .filter(s -> s.getStartsAt().isAfter(LocalDateTime.now()))
                .sorted(java.util.Comparator.comparing(OfficeHourSlot::getStartsAt))
                .map(s -> toSlotView(s, displayName(s.getExpertUserId())))
                .toList();
    }

    /** The caller's own published slots, newest first. */
    public java.util.List<SlotView> mySlots() {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        return slots.findByWorkspaceIdAndExpertUserIdOrderByStartsAtDesc(ws, userId)
                .stream()
                .map(s -> toSlotView(s, null))
                .toList();
    }

    /** Publishes a slot (experts only). */
    public SlotView createSlot(SlotRequest request) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        Membership membership = memberships.findByWorkspaceIdAndUserId(ws, userId)
                .orElseThrow(() -> new NotFoundException("No membership in this workspace"));
        if (!membership.isExpert()) {
            throw new ForbiddenException(
                    "Only expert members can publish office-hour slots");
        }
        if (request.startsAt() == null || request.startsAt().isBefore(LocalDateTime.now())) {
            throw new BadRequestException("startsAt is required and must be in the future");
        }
        Integer duration = request.durationMinutes();
        if (duration == null || duration < 15 || duration > 240) {
            throw new BadRequestException("durationMinutes must be between 15 and 240");
        }
        if (request.priceMinor() == null || request.priceMinor() < 0) {
            throw new BadRequestException("priceMinor is required and must be >= 0");
        }
        String currency = normalizeCurrency(request.currency());

        Workspace workspace = workspaces.findById(ws)
                .orElseThrow(() -> new NotFoundException("No workspace"));
        int commissionBp = workspace.getOfficeHoursCommissionBp();
        split(request.priceMinor(), commissionBp); // validates split within the cap

        OfficeHourSlot slot = new OfficeHourSlot();
        slot.setWorkspaceId(ws);
        slot.setExpertUserId(userId);
        slot.setStartsAt(request.startsAt().withSecond(0).withNano(0));
        slot.setDurationMinutes(duration);
        slot.setPriceMinor(request.priceMinor());
        slot.setCurrency(currency);
        slot.setStatus(OfficeHourSlot.Status.OPEN);
        slots.save(slot);
        audit.record("CREATE", "office_hour_slot", slot.getId(),
                Map.of("startsAt", slot.getStartsAt().toString(),
                        "priceMinor", slot.getPriceMinor(),
                        "durationMinutes", duration));
        return toSlotView(slot, null);
    }

    /** Cancels one of the caller's unbooked slots. */
    public SlotView cancelSlot(Long slotId) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        OfficeHourSlot slot = requireSlot(ws, slotId);
        if (!slot.getExpertUserId().equals(userId)) {
            throw new ForbiddenException("You can only cancel your own slots");
        }
        if (slot.getStatus() != OfficeHourSlot.Status.OPEN) {
            throw new ConflictException("Only open slots without bookings can be cancelled");
        }
        if (bookings.findFirstByWorkspaceIdAndSlotId(ws, slotId).isPresent()) {
            throw new ConflictException(
                    "This slot has a booking; cancel the booking instead");
        }
        slot.setStatus(OfficeHourSlot.Status.CANCELLED);
        slots.save(slot);
        audit.record("UPDATE", "office_hour_slot", slot.getId(),
                Map.of("event", "slot_cancelled"));
        return toSlotView(slot, null);
    }

    // ---------------------------------------------------------------- bookings

    /**
     * Books a slot for the caller. Creates a PENDING booking and a Razorpay
     * order; the booking stays PENDING until the verified webhook confirms
     * the payment Razorpay reports for that order.
     */
    public Map<String, Object> book(Long slotId) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        OfficeHourSlot slot = requireSlot(ws, slotId);
        if (slot.getStatus() != OfficeHourSlot.Status.OPEN) {
            throw new ConflictException("This slot is no longer open for booking");
        }
        if (!slot.getStartsAt().isAfter(LocalDateTime.now())) {
            throw new BadRequestException("This slot already started");
        }
        if (slot.getExpertUserId().equals(userId)) {
            throw new BadRequestException("You cannot book your own slot");
        }
        if (bookings.findFirstByWorkspaceIdAndSlotId(ws, slotId).isPresent()) {
            throw new ConflictException("Someone is already booking this slot");
        }

        Workspace workspace = workspaces.findById(ws)
                .orElseThrow(() -> new NotFoundException("No workspace"));
        int commissionBp = workspace.getOfficeHoursCommissionBp();
        if (commissionBp < 0 || commissionBp > MAX_COMMISSION_BP) {
            throw new ConflictException("Office-hours commission setting is out of range");
        }
        long[] split = split(slot.getPriceMinor(), commissionBp);

        OfficeHourBooking booking = new OfficeHourBooking();
        booking.setSlotId(slot.getId());
        booking.setExpertUserId(slot.getExpertUserId());
        booking.setMemberUserId(userId);
        booking.setStatus(OfficeHourBooking.Status.PENDING);
        booking.setPriceMinor(slot.getPriceMinor());
        booking.setCommissionBp(commissionBp);
        booking.setExpertAmountMinor(split[0]);
        booking.setPlatformAmountMinor(split[1]);
        booking.setCurrency(slot.getCurrency());

        // Razorpay order first (it is the booking's payment reference), then
        // persist. An unconfigured provider answers 503 before any state.
        if (!razorpay.configured()) {
            throw new BillingUnavailableException(
                    "Razorpay is not configured on this server; bookings are disabled "
                            + "(set app.billing.razorpay.key-id / key-secret, see README)");
        }
        Map<String, String> notes = new LinkedHashMap<>(new TreeMap<>());
        notes.put("workspace_id", String.valueOf(ws));
        notes.put("booking_id", null); // replaced with the persisted id below
        String orderId;
        try {
            bookings.save(booking);
            notes.put("booking_id", String.valueOf(booking.getId()));
            orderId = razorpay.createPaymentOrderForBooking(
                    slot.getPriceMinor(), slot.getCurrency(), notes,
                    "oh-ws" + ws + "-b" + booking.getId());
            booking.setProvider("razorpay");
            booking.setProviderOrderId(orderId);
            bookings.save(booking);
        } catch (IllegalStateException providerFailure) {
            bookings.delete(booking);
            bookings.flush();
            throw new com.coeso.roster.billing.BillingUnavailableException(
                    "Razorpay checkout is not available on this server: "
                            + providerFailure.getMessage());
        }
        audit.record("CREATE", "office_hour_booking", booking.getId(),
                Map.of("event", "booking_requested", "slotId", slot.getId(),
                        "amountMinor", booking.getPriceMinor()));
        return Map.of("bookingId", booking.getId(), "provider", booking.getProvider(),
                "orderId", booking.getProviderOrderId(), "amountMinor", booking.getPriceMinor(),
                "currency", booking.getCurrency(), "status", booking.getStatus().name());
    }

    /** Expert or member cancels; confirmed bookings await a provider refund. */
    public BookingView cancelBooking(Long bookingId) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        OfficeHourBooking booking = requireBooking(ws, bookingId);
        if (!booking.getExpertUserId().equals(userId)
                && !booking.getMemberUserId().equals(userId)) {
            throw new ForbiddenException(
                    "Only the expert or the booking member can cancel this booking");
        }
        OfficeHourBooking.Status was = booking.getStatus();
        if (was == OfficeHourBooking.Status.REFUNDED
                || was == OfficeHourBooking.Status.CANCELLED) {
            throw new ConflictException("This booking is already settled");
        }
        if (was == OfficeHourBooking.Status.PENDING) {
            booking.setStatus(OfficeHourBooking.Status.CANCELLED);
        } else {
            // confirmed / refund_pending: the session will not happen; money
            // is already captured and the refund is driven by the provider
            // (the payment.refunded webhook finalises the ledger reversal).
            booking.setStatus(OfficeHourBooking.Status.REFUND_PENDING);
        }
        booking.setCancelledAt(LocalDateTime.now());
        reopenSlotIfBooked(booking.getSlotId());
        bookings.save(booking);
        audit.record("UPDATE", "office_hour_booking", booking.getId(),
                Map.of("event", "booking_cancelled", "was", was.name(),
                        "now", booking.getStatus().name()));
        return toBookingView(booking);
    }

    /** Pasteable meeting link; set or refresh by the expert any time. */
    public BookingView setMeetingLink(Long bookingId, String meetingLink) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        OfficeHourBooking booking = requireBooking(ws, bookingId);
        if (!booking.getExpertUserId().equals(userId)) {
            throw new ForbiddenException("Only the expert can set the meeting link");
        }
        if (meetingLink == null || meetingLink.isBlank()) {
            throw new BadRequestException("meetingLink is required");
        }
        if (meetingLink.length() > 500) {
            throw new BadRequestException("meetingLink is too long (max 500 chars)");
        }
        if (!meetingLink.matches("^https?://[0-9A-Za-z._~:/?#@!$&'()*+,;=%\\[\\]-]+$")) {
            throw new BadRequestException("meetingLink must be an http(s) URL");
        }
        booking.setMeetingLink(meetingLink);
        bookings.save(booking);
        audit.record("UPDATE", "office_hour_booking", booking.getId(),
                Map.of("event", "meeting_link_set"));
        return toBookingView(booking);
    }

    /** All bookings for the caller: as member, and as expert. */
    public Map<String, Object> myBookings() {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        return Map.of(
                "asMember", bookings.findByWorkspaceIdAndMemberUserId(ws, userId)
                        .stream().map(this::toBookingView).toList(),
                "asExpert", bookings.findByWorkspaceIdAndExpertUserId(ws, userId)
                        .stream().map(this::toBookingView).toList());
    }

    // --------------------------------------------------------------- payments

    /**
     * The verified webhook path: capture confirms, failure cancels, refund
     * settles. Only transitions from the expected status apply, so duplicate
     * deliveries are no-ops. Called from the (permitAll) payments webhook
     * controller after the provider's HMAC passes — no client ever reaches
     * this code path with anything but a verified Razorpay payload.
     */
    public String applyPaymentWebhook(String type, Long workspaceId, Long bookingId,
                                      String paymentId) {
        if (workspaceId == null || bookingId == null) {
            return "ignored";
        }
        // Webhook threads carry no TenantContext: the Hibernate filter is off,
        // so a plain findById resolves the row across tenants — the row picked
        // must belong to the workspace taken from the VERIFIED notes.
        OfficeHourBooking booking = bookings.findById(bookingId).orElse(null);
        if (booking == null || !Objects.equals(workspaceId, booking.getWorkspaceId())) {
            return "unknown-booking";
        }
        switch (type == null ? "" : type) {
            case "payment.captured" -> {
                if (booking.getStatus() != OfficeHourBooking.Status.PENDING) {
                    return "already";
                }
                confirm(booking, paymentId);
            }
            case "payment.failed" -> {
                if (booking.getStatus() != OfficeHourBooking.Status.PENDING) {
                    return "already";
                }
                booking.setStatus(OfficeHourBooking.Status.CANCELLED);
                booking.setCancelledAt(LocalDateTime.now());
                reopenSlotIfBooked(booking.getSlotId());
                bookings.save(booking);
                audit.recordUnattributed(booking.getWorkspaceId(), "UPDATE",
                        "office_hour_booking", booking.getId(),
                        Map.of("event", "payment_failed",
                                "paymentId", paymentId == null ? "" : paymentId));
            }
            case "payment.refunded" -> {
                if (booking.getStatus() != OfficeHourBooking.Status.CONFIRMED
                        && booking.getStatus() != OfficeHourBooking.Status.REFUND_PENDING) {
                    return "already";
                }
                refund(booking, paymentId);
            }
            default -> {
                return "ignored";
            }
        }
        return "applied";
    }

    private void confirm(OfficeHourBooking booking, String paymentId) {
        booking.setStatus(OfficeHourBooking.Status.CONFIRMED);
        booking.setConfirmedAt(LocalDateTime.now());
        booking.setProviderPaymentId(paymentId);
        bookings.save(booking);
        OfficeHourSlot slot = slots.findById(booking.getSlotId()).orElse(null);
        if (slot != null) {
            slot.setStatus(OfficeHourSlot.Status.BOOKED);
            slots.save(slot);
        }
        PayoutLedgerEntry entry = new PayoutLedgerEntry();
        entry.setWorkspaceId(booking.getWorkspaceId());
        entry.setBookingId(booking.getId());
        entry.setExpertUserId(booking.getExpertUserId());
        entry.setStatus(PayoutLedgerEntry.Status.PENDING);
        entry.setAmountMinor(booking.getExpertAmountMinor());
        entry.setPlatformAmountMinor(booking.getPlatformAmountMinor());
        entry.setCurrency(booking.getCurrency());
        payouts.save(entry);
        audit.recordUnattributed(booking.getWorkspaceId(), "UPDATE",
                "office_hour_booking", booking.getId(),
                Map.of("event", "payment_captured",
                        "paymentId", paymentId == null ? "" : paymentId,
                        "ledgerEntry", entry.getId()));
    }

    /** Refunds reverse the original ledger row with a negative entry (append-only). */
    private void refund(OfficeHourBooking booking, String paymentId) {
        booking.setStatus(OfficeHourBooking.Status.REFUNDED);
        bookings.save(booking);
        reopenSlotIfBooked(booking.getSlotId());
        PayoutLedgerEntry original = payouts.findByWorkspaceIdAndExpertUserId(
                        booking.getWorkspaceId(), booking.getExpertUserId()).stream()
                .filter(e -> e.getBookingId().equals(booking.getId())
                        && !e.isReversal()
                        && e.getStatus() != PayoutLedgerEntry.Status.PAID)
                .findFirst().orElse(null);
        if (original != null) {
            original.setStatus(PayoutLedgerEntry.Status.REVERSED);
            payouts.save(original);
            PayoutLedgerEntry reversal = new PayoutLedgerEntry();
            reversal.setWorkspaceId(booking.getWorkspaceId());
            reversal.setBookingId(booking.getId());
            reversal.setExpertUserId(booking.getExpertUserId());
            reversal.setStatus(PayoutLedgerEntry.Status.PENDING);
            reversal.setAmountMinor(-original.getAmountMinor());
            reversal.setPlatformAmountMinor(-original.getPlatformAmountMinor());
            reversal.setCurrency(original.getCurrency());
            reversal.setReversesEntryId(original.getId());
            payouts.save(reversal);
        }
        audit.recordUnattributed(booking.getWorkspaceId(), "UPDATE",
                "office_hour_booking", booking.getId(),
                Map.of("event", "payment_refunded",
                        "paymentId", paymentId == null ? "" : paymentId));
    }

    // ---------------------------------------------------------------- payouts

    /** Owners/admins see the whole ledger; experts their own rows. */
    public java.util.List<PayoutView> payouts() {
        Long ws = TenantContext.requireWorkspaceId();
        var role = TenantContext.role();
        Long userId = requireActor();
        boolean privileged = role != null
                && (role == com.coeso.roster.common.WorkspaceRole.OWNER
                        || role == com.coeso.roster.common.WorkspaceRole.ADMIN);
        return (privileged
                ? payouts.findByWorkspaceId(ws)
                : payouts.findByWorkspaceIdAndExpertUserId(ws, userId))
                .stream().map(this::toPayoutView).toList();
    }

    /** Marks a pending payout paid (owner/admin) after paying the expert out of band. */
    public PayoutView markPayoutPaid(Long entryId) {
        Long ws = TenantContext.requireWorkspaceId();
        PayoutLedgerEntry entry = payouts.findById(entryId)
                .orElseThrow(() -> new NotFoundException("No payout entry"));
        if (!Objects.equals(ws, entry.getWorkspaceId())) {
            throw new NotFoundException("No payout entry");
        }
        if (entry.getStatus() != PayoutLedgerEntry.Status.PENDING) {
            throw new ConflictException("Only pending payouts can be marked paid");
        }
        entry.setStatus(PayoutLedgerEntry.Status.PAID);
        payouts.save(entry);
        audit.record("CREATE", "payout_ledger_entry", entry.getId(),
                Map.of("event", "payout_paid", "amountMinor", entry.getAmountMinor()));
        return toPayoutView(entry);
    }

    // ------------------------------------------------------------- commission

    /** Per-space commission in basis points; owner-only, capped at 50%. */
    public int setCommission(Integer commissionBp) {
        Long ws = TenantContext.requireWorkspaceId();
        if (commissionBp == null || commissionBp < 0 || commissionBp > MAX_COMMISSION_BP) {
            throw new BadRequestException(
                    "commissionBp must be between 0 and " + MAX_COMMISSION_BP);
        }
        Workspace workspace = workspaces.findById(ws)
                .orElseThrow(() -> new NotFoundException("No workspace"));
        workspace.setOfficeHoursCommissionBp(commissionBp);
        workspaces.save(workspace);
        audit.record("UPDATE", "workspace", ws,
                Map.of("event", "commission_set", "commissionBp", commissionBp));
        return workspace.getOfficeHoursCommissionBp();
    }

    public int commission() {
        Long ws = TenantContext.requireWorkspaceId();
        Workspace workspace = workspaces.findById(ws)
                .orElseThrow(() -> new NotFoundException("No workspace"));
        return workspace.getOfficeHoursCommissionBp();
    }

    // -------------------------------------------------------------- experts

    /** Flags/unflags a member as expert (owner/admin). */
    public boolean setExpert(Long userId, boolean expert) {
        Long ws = TenantContext.requireWorkspaceId();
        Membership membership = memberships.findByWorkspaceIdAndUserId(ws, userId)
                .orElseThrow(() -> new NotFoundException("That user is not a member"));
        membership.setExpert(expert);
        memberships.save(membership);
        audit.record("UPDATE", "membership", membership.getId(),
                Map.of("event", expert ? "expert_flagged" : "expert_unflagged"));
        return membership.isExpert();
    }

    public java.util.List<Map<String, Object>> experts() {
        Long ws = TenantContext.requireWorkspaceId();
        return memberships.findAll().stream()
                .filter(m -> Objects.equals(ws, m.getWorkspaceId()) && m.isExpert())
                .map(m -> Map.<String, Object>of("userId", m.getUserId(),
                        "displayName", displayName(m.getUserId())))
                .toList();
    }

    // ---------------------------------------------------------------- helpers

    private long[] split(long priceMinor, int commissionBp) {
        if (commissionBp < 0 || commissionBp > MAX_COMMISSION_BP) {
            throw new ConflictException("Commission out of range (0..5000 bp)");
        }
        long platform = priceMinor * commissionBp / 10_000;
        long expert = priceMinor - platform;
        if (expert + platform != priceMinor) {
            throw new ConflictException("Commission does not split the price exactly");
        }
        return new long[] {expert, platform};
    }

    private void reopenSlotIfBooked(Long slotId) {
        OfficeHourSlot slot = slots.findById(slotId).orElse(null);
        if (slot != null && slot.getStatus() == OfficeHourSlot.Status.BOOKED) {
            slot.setStatus(OfficeHourSlot.Status.OPEN);
            slots.save(slot);
        }
    }

    private OfficeHourSlot requireSlot(Long ws, Long slotId) {
        OfficeHourSlot slot = slots.findById(slotId)
                .orElseThrow(() -> new NotFoundException("No office-hour slot " + slotId));
        if (!Objects.equals(ws, slot.getWorkspaceId())) {
            throw new NotFoundException("No office-hour slot " + slotId);
        }
        return slot;
    }

    private OfficeHourBooking requireBooking(Long ws, Long bookingId) {
        OfficeHourBooking booking = bookings.findById(bookingId)
                .orElseThrow(() -> new NotFoundException("No booking " + bookingId));
        if (!Objects.equals(ws, booking.getWorkspaceId())) {
            throw new NotFoundException("No booking " + bookingId);
        }
        return booking;
    }

    private static Long requireActor() {
        Long userId = TenantContext.actorUserId();
        if (userId == null) {
            throw new UnauthorizedException("Not authenticated");
        }
        return userId;
    }

    private static String normalizeCurrency(String currency) {
        if (currency == null || currency.isBlank()) {
            return "INR";
        }
        String upper = currency.trim().toUpperCase();
        if (!upper.matches("^[A-Z]{3}$")) {
            throw new BadRequestException("currency must be a 3-letter code");
        }
        return upper;
    }

    private String displayName(Long userId) {
        return memberships.findAll().stream()
                .filter(m -> userId != null && userId.equals(m.getUserId())
                        && m.getUser() != null
                        && m.getUser().getDisplayName() != null
                        && !m.getUser().getDisplayName().isBlank())
                .map(m -> m.getUser().getDisplayName())
                .findFirst()
                .orElse(null);
    }

    private SlotView toSlotView(OfficeHourSlot slot, String expertName) {
        return new SlotView(slot.getId(), slot.getExpertUserId(), expertName,
                slot.getStartsAt(), slot.getDurationMinutes(), slot.getPriceMinor(),
                slot.getCurrency(), slot.getStatus().name());
    }

    private BookingView toBookingView(OfficeHourBooking booking) {
        OfficeHourSlot slot = slots.findById(booking.getSlotId()).orElse(null);
        return new BookingView(booking.getId(), booking.getSlotId(),
                booking.getExpertUserId(), booking.getMemberUserId(),
                booking.getStatus().name(), booking.getPriceMinor(),
                booking.getExpertAmountMinor(), booking.getPlatformAmountMinor(),
                booking.getCurrency(), booking.getMeetingLink(),
                booking.getProviderOrderId(), booking.getConfirmedAt(),
                booking.getCancelledAt(),
                slot == null ? null : slot.getStartsAt(),
                slot == null ? null : slot.getDurationMinutes(),
                displayName(booking.getExpertUserId()),
                booking.getCreatedAt());
    }

    private PayoutView toPayoutView(PayoutLedgerEntry entry) {
        return new PayoutView(entry.getId(), entry.getBookingId(), entry.getExpertUserId(),
                entry.getStatus().name(), entry.getAmountMinor(),
                entry.getPlatformAmountMinor(), entry.getCurrency(), entry.isReversal(),
                entry.getCreatedAt());
    }
}
