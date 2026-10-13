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

    public static WorkspaceRole parse(String raw) {
        return valueOf(raw.trim().toUpperCase());
    }
}
