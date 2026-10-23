package com.coeso.roster.common;

/**
 * Workspace roles, ordered by capability: owner > admin > manager > rep.
 * A role passes a requirement if its rank is >= the required rank.
 */
public enum WorkspaceRole {
    REP(1),
    MANAGER(2),
    ADMIN(3),
    OWNER(4);

    private final int rank;

    WorkspaceRole(int rank) {
        this.rank = rank;
    }

    public boolean atLeast(WorkspaceRole minimum) {
        return this.rank >= minimum.rank;
    }

    /**
     * Parses a role string coming from a client (invite bodies, future role
     * edits): trimmable and case-insensitive (Locale.ROOT, so "admin" parses
     * on a Turkish default locale too). Null, blank or an unknown name is a
     * client error — a {@link BadRequestException} the global handler maps to
     * 400 — instead of the NullPointerException / IllegalArgumentException that
     * used to escape as a 500.
     */
    public static WorkspaceRole parse(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new BadRequestException(
                    "role is required — expected one of owner, admin, manager, rep");
        }
        try {
            return valueOf(raw.trim().toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Unknown role '" + raw
                    + "' — expected one of owner, admin, manager, rep");
        }
    }
}
