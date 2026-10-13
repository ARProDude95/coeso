package com.coeso.roster.entity;

/**
 * Holder for the shared Hibernate filter name so both the mapped superclass
 * annotation and the runtime enablement code reference one constant.
 */
public final class TenantContextFilter {

    public static final String NAME = "workspaceFilter";

    private TenantContextFilter() {
    }
}
