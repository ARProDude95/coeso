package com.coeso.roster.common;

/**
 * Raised when a [PRO] feature is used on a plan below Pro. Mapped to a 402
 * PAYMENT_REQUIRED envelope (code PRO_FEATURE_REQUIRED) so the UI can show a
 * clear upgrade message — same family as PlanLimitException.
 */
public class ProFeatureRequiredException extends RuntimeException {

    private final String feature;

    public ProFeatureRequiredException(String feature, String message) {
        super(message);
        this.feature = feature;
    }

    public String getFeature() {
        return feature;
    }
}