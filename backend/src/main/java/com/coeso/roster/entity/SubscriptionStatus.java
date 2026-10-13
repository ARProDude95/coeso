package com.coeso.roster.entity;

/** Subscription lifecycle driven by billing webhooks (phase 4). */
public enum SubscriptionStatus {
    TRIALING,
    ACTIVE,
    PAST_DUE,
    CANCELED
}
