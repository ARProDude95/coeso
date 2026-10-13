package com.coeso.roster.common;

/** Thrown when a plan limit (max reps / max members) would be exceeded. */
public class PlanLimitException extends RuntimeException {

    private final String resource;
    private final long current;
    private final long limit;

    public PlanLimitException(String resource, long current, long limit, String message) {
        super(message);
        this.resource = resource;
        this.current = current;
        this.limit = limit;
    }

    public String getResource() {
        return resource;
    }

    public long getCurrent() {
        return current;
    }

    public long getLimit() {
        return limit;
    }
}
