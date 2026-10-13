package com.coeso.roster.billing;

/** Thrown when a billing webhook's signature is missing, malformed or wrong. */
public class BillingSignatureException extends RuntimeException {

    public BillingSignatureException(String message) {
        super(message);
    }
}
