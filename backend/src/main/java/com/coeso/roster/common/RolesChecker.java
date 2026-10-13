package com.coeso.roster.common;

import org.springframework.stereotype.Component;

/**
 * SpEL-accessible role guard used by {@code @PreAuthorize("@roles.hasAtLeast('MANAGER')")}
 * on service methods. Roles are per-workspace and dynamic, so they come from the
 * request-scoped TenantContext (populated from the caller's membership), not from
 * the JWT.
 *
 * <p>Throws instead of returning false so callers get precise status codes:
 * 400 when no workspace header was resolved, 403 when the role is too low.
 */
@Component("roles")
public class RolesChecker {

    public boolean hasAtLeast(String minimumRole) {
        WorkspaceRole current = TenantContext.role();
        if (current == null) {
            throw new BadRequestException(
                    "X-Workspace header is required and you must be a member of the workspace");
        }
        if (!current.atLeast(WorkspaceRole.parse(minimumRole))) {
            throw new ForbiddenException(
                    "Role '" + current.name().toLowerCase() + "' may not perform this operation; "
                            + "minimum role is '" + minimumRole.toLowerCase() + "'");
        }
        return true;
    }
}
