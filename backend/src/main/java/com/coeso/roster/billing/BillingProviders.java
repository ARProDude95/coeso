package com.coeso.roster.billing;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Selects the active billing provider from {@code app.billing.provider}
 * ("stripe" or "razorpay"). Both implementations are beans; this switch is the
 * only place that knows which one is live, so swapping providers is pure
 * configuration.
 */
@Component
public class BillingProviders {

    private final StripeBillingProvider stripe;
    private final RazorpayBillingProvider razorpay;
    private final String configured;

    public BillingProviders(StripeBillingProvider stripe, RazorpayBillingProvider razorpay,
                            @Value("${app.billing.provider:stripe}") String configured) {
        this.stripe = stripe;
        this.razorpay = razorpay;
        this.configured = configured;
    }

    public BillingProvider active() {
        return switch (configured.trim().toLowerCase(java.util.Locale.ROOT)) {
            case "stripe" -> stripe;
            case "razorpay" -> razorpay;
            default -> throw new IllegalStateException(
                    "app.billing.provider must be 'stripe' or 'razorpay', was '"
                            + configured + "'");
        };
    }

    public StripeBillingProvider stripe() {
        return stripe;
    }
}
