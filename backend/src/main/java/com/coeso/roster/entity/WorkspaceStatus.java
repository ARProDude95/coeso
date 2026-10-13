package com.coeso.roster.entity;

/** Workspace lifecycle: soft-deleted workspaces stay as tombstones for the purge job. */
public enum WorkspaceStatus {
    ACTIVE,
    DELETED
}
