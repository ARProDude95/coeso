package com.coeso.roster.officehours;

import com.coeso.roster.billing.BillingProvider.VerifiedEvent;
import com.coeso.roster.billing.RazorpayBillingProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Razorpay payment webhook for office-hour bookings. Like the billing
 * webhooks, this route is outside the JWT and tenant chain and is trusted
 * solely by the provider's signature over the raw body. The workspace and
 * booking ids come from the verified payload's order notes — never from
 * headers — and every applied transition is idempotent via the booking's
 * status machine (only the first matching transition applies).
 *
 * <p>Applied events (200 acknowledged): payment.captured (pending →
 * confirmed), payment.failed (pending → cancelled, slot reopens),
 * payment.refunded (confirmed / refund_pending → refunded, ledger reversed).
 * Unknown event types are acknowledged but ignored so Razorpay stops retrying.
 */
@RestController
@RequestMapping("/api/payments/webhooks")
public class PaymentsWebhookController {

    private final RazorpayBillingProvider razorpay;
    private final ObjectMapper objectMapper;
    private final OfficeHoursService officeHours;

    public PaymentsWebhookController(RazorpayBillingProvider razorpay,
                                     ObjectMapper objectMapper,
                                     OfficeHoursService officeHours) {
        this.razorpay = razorpay;
        this.objectMapper = objectMapper;
        this.officeHours = officeHours;
    }

    @PostMapping("/razorpay")
    public ResponseEntity<Map<String, String>> razorpayWebhook(
            @RequestBody String payload,
            @RequestHeader(value = "X-Razorpay-Signature", required = false) String signature) {

        // Verifies and decodes once (401 for a bad signature via the shared
        // exception handler); booking_id and payment id are then read from
        // the same verified body.
        VerifiedEvent event = razorpay.verifyAndDecode(payload, signature);

        Long workspaceId = event.workspaceId();
        Long bookingId = null;
        String paymentId = null;
        try {
            JsonNode body = objectMapper.readTree(payload);
            JsonNode payment = body.path("payload").path("payment").path("entity");
            if (payment.isObject()) {
                paymentId = payment.path("id").asText(null);
                JsonNode notes = payment.path("notes");
                if (notes.hasNonNull("booking_id")) {
                    bookingId = parseLongOrNull(notes.get("booking_id").asText());
                }
            }
        } catch (Exception unreadable) {
            // The body already passed HMAC verification, so treat this as a
            // malformed event: acknowledged, nothing applied.
            return ResponseEntity.ok(Map.of("outcome", "malformed"));
        }

        String outcome = officeHours.applyPaymentWebhook(event.type(), workspaceId,
                bookingId, paymentId);
        return ResponseEntity.ok(Map.of("outcome", outcome, "eventId", event.eventId()));
    }

    private static Long parseLongOrNull(String raw) {
        try {
            return Long.parseLong(raw);
        } catch (Exception e) {
            return null;
        }
    }
}
