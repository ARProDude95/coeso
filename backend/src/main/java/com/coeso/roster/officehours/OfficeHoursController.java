package com.coeso.roster.officehours;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Paid office hours endpoints. Everything is workspace-scoped (the tenant
 * filter + TenantContext) and role-checked; the payments verification lives
 * in {@link PaymentsWebhookController}, outside the JWT chain like the
 * billing webhooks.
 */
@RestController
@RequestMapping("/api/office-hours")
public class OfficeHoursController {

    private final OfficeHoursService service;

    public OfficeHoursController(OfficeHoursService service) {
        this.service = service;
    }

    /** Storefront: open, future slots. Any member. */
    @GetMapping("/slots")
    public List<OfficeHoursService.SlotView> openSlots() {
        return service.openSlots();
    }

    /** The caller's own published slots (experts only). */
    @GetMapping("/slots/mine")
    public List<OfficeHoursService.SlotView> mySlots() {
        return service.mySlots();
    }

    /** Publishes a slot. Any expert member; not tied to a plan. */
    @PostMapping("/slots")
    public ResponseEntity<OfficeHoursService.SlotView> createSlot(
            @RequestBody OfficeHoursService.SlotRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createSlot(request));
    }

    /** Cancels one of the caller's unbooked slots. */
    @PostMapping("/slots/{id}/cancel")
    public OfficeHoursService.SlotView cancelSlot(@PathVariable Long id) {
        return service.cancelSlot(id);
    }

    /** Books a slot for the caller: creates the pending booking + order id. */
    @PostMapping("/slots/{id}/book")
    public Map<String, Object> book(@PathVariable Long id) {
        return service.book(id);
    }

    /** Upcoming bookings for the caller on both sides of the table. */
    @GetMapping("/bookings")
    public Map<String, Object> myBookings() {
        return service.myBookings();
    }

    /** Expert or member cancels a booking (refund pending when paid). */
    @PostMapping("/bookings/{id}/cancel")
    public OfficeHoursService.BookingView cancelBooking(@PathVariable Long id) {
        return service.cancelBooking(id);
    }

    /** Pasteable meeting link (expert only). */
    @PutMapping("/bookings/{id}/meeting-link")
    public OfficeHoursService.BookingView setMeetingLink(@PathVariable Long id,
                                                         @RequestBody Map<String, String> body) {
        return service.setMeetingLink(id, body.get("meetingLink"));
    }

    /** Payout ledger: whole ledger for owners/admins, own rows for experts. */
    @GetMapping("/payouts")
    public List<OfficeHoursService.PayoutView> payouts() {
        return service.payouts();
    }

    /** Marks a pending payout paid (owner/admin). */
    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    @PostMapping("/payouts/{id}/paid")
    public OfficeHoursService.PayoutView markPayoutPaid(@PathVariable Long id) {
        return service.markPayoutPaid(id);
    }

    /** Current commission setting in basis points (0..5000, default 1000). */
    @GetMapping("/commission")
    public Map<String, Integer> commission() {
        return Map.of("commissionBp", service.commission());
    }

    /** Sets the per-space commission (owner only). */
    @PreAuthorize("@roles.hasAtLeast('OWNER')")
    @PutMapping("/commission")
    public Map<String, Integer> setCommission(@RequestBody Map<String, Object> body) {
        Object raw = body.get("commissionBp");
        Integer value = raw instanceof Number number ? number.intValue()
                : raw instanceof String text ? Integer.parseInt(text) : null;
        return Map.of("commissionBp", service.setCommission(value));
    }

    /** Flags a member as expert (owner/admin). */
    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    @PutMapping("/members/{userId}/expert")
    public Map<String, Object> setExpert(@PathVariable Long userId,
                                         @RequestBody Map<String, Object> body) {
        Object raw = body.get("expert");
        boolean expert = Boolean.TRUE.equals(raw) || "true".equals(raw);
        return Map.of("userId", userId, "expert", service.setExpert(userId, expert));
    }

    /** Expert roster (owner/admin via service; experts see the flag too). */
    @GetMapping("/experts")
    public List<Map<String, Object>> experts() {
        return service.experts();
    }
}
