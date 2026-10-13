package com.coeso.roster.common;

import com.coeso.roster.entity.TenantContextFilter;

/**
 * Request-scoped tenant context. The workspace id comes from the authenticated
 * user's membership (resolved by the servlet tenant filter) and is NEVER taken
 * from a request body or query parameter.
 *
 * <p>The context also carries the acting user id, so audit rows written inside
 * the same transaction never have to reach back into Spring Security.
 */
public final class TenantContext {

    /** Name of the Hibernate @Filter applied to every tenant-owned entity. */
    public static final String FILTER_NAME = TenantContextFilter.NAME;

    private static final ThreadLocal<Context> CURRENT = new ThreadLocal<>();

    private TenantContext() {
    }

    public record Context(Long workspaceId, WorkspaceRole role, Long actorUserId) {
    }

    public static void set(Long workspaceId, WorkspaceRole role, Long actorUserId) {
        CURRENT.set(new Context(workspaceId, role, actorUserId));
    }

    public static void clear() {
        CURRENT.remove();
    }

    public static Context current() {
        return CURRENT.get();
    }

    public static Long workspaceId() {
        Context c = CURRENT.get();
        return c == null ? null : c.workspaceId();
    }

    public static WorkspaceRole role() {
        Context c = CURRENT.get();
        return c == null ? null : c.role();
    }

    public static Long actorUserId() {
        Context c = CURRENT.get();
        return c == null ? null : c.actorUserId();
    }

    /** Workspace id for workspace-scoped operations; 400 when absent. */
    public static Long requireWorkspaceId() {
        Long ws = workspaceId();
        if (ws == null) {
            throw new BadRequestException("X-Workspace header is required for this endpoint");
        }
        return ws;
    }
}
