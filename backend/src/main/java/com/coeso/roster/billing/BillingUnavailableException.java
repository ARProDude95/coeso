package com.coeso.roster.billing;

/** Thrown when checkout is requested but the billing provider has no keys. */
public class BillingUnavailableException extends RuntimeException {

    public BillingUnavailableException(String message) {
        super(message);
    }
}
