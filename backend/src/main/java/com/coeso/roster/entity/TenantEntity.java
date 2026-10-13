package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import org.hibernate.annotations.FilterDef;
import org.hibernate.annotations.ParamDef;

/**
 * Base for every tenant-owned table: carries workspace_id. Each concrete entity
 * additionally declares the workspace Hibernate filter via {@code @Filter}
 * (conditions differ per table only if needed; the shared name lives in
 * {@link TenantContextFilter#NAME}). The filter <em>definition</em> (name +
 * parameter) is registered exactly once, here on the mapped superclass, which
 * Hibernate collects through every entity hierarchy.
 */
@MappedSuperclass
@FilterDef(
        name = TenantContextFilter.NAME,
        parameters = @ParamDef(name = "workspaceId", type = Long.class))
public abstract class TenantEntity {

    @Column(name = "workspace_id", nullable = false)
    private Long workspaceId;

    public Long getWorkspaceId() {
        return workspaceId;
    }

    public void setWorkspaceId(Long workspaceId) {
        this.workspaceId = workspaceId;
    }
}
