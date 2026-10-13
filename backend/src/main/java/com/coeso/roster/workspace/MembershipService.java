package com.coeso.roster.workspace;

import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.entity.WorkspaceStatus;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.hibernate.Session;
import org.springframework.stereotype.Service;

/**
 * Resolves and lists workspace memberships.
 *
 * <p>{@link #resolve} is the bootstrap step: it translates the X-Workspace
 * header (numeric id or slug) into a workspace, enables the tenant filter for
 * the current transaction, and only then queries memberships — so even this
 * query runs with the filter active.
 */
@Service
public class MembershipService {

    public record WorkspaceSummary(Long id, String name, String slug,
                                   com.coeso.roster.common.WorkspaceRole role) {
    }

    private final MembershipRepository memberships;
    private final WorkspaceRepository workspaces;

    @PersistenceContext
    private EntityManager entityManager;

    public MembershipService(MembershipRepository memberships, WorkspaceRepository workspaces) {
        this.memberships = memberships;
        this.workspaces = workspaces;
    }

    /** Returns the caller's membership when the workspace exists and is active. */
    public Optional<Membership> resolve(String header, Long userId) {
        Workspace workspace = findByHeader(header);
        if (workspace == null || workspace.getStatus() != WorkspaceStatus.ACTIVE) {
            return Optional.empty();
        }
        Session session = entityManager.unwrap(Session.class);
        if (session.getEnabledFilter(TenantContext.FILTER_NAME) == null) {
            session.enableFilter(TenantContext.FILTER_NAME)
                    .setParameter("workspaceId", workspace.getId());
        }
        Optional<Membership> membership =
                memberships.findByUserIdAndWorkspaceId(userId, workspace.getId());
        membership.ifPresent(m ->
                TenantContext.set(workspace.getId(), m.getRole(), userId));
        return membership;
    }

    /**
     * All workspaces the user belongs to (workspace picker). This is the one
     * intentionally cross-workspace view: it is scoped by user_id instead of
     * workspace_id, so the tenant filter is disabled for this query only.
     */
    public List<WorkspaceSummary> listMine(Long userId) {
        Session session = entityManager.unwrap(Session.class);
        if (session.getEnabledFilter(TenantContext.FILTER_NAME) != null) {
            session.disableFilter(TenantContext.FILTER_NAME);
        }
        return memberships.findAllByUserId(userId).stream()
                .map(m -> workspaces.findById(m.getWorkspaceId())
                        .map(w -> new WorkspaceSummary(w.getId(), w.getName(), w.getSlug(), m.getRole()))
                        .orElse(null))
                .filter(Objects::nonNull)
                .toList();
    }

    private Workspace findByHeader(String header) {
        if (header.matches("\\d+")) {
            return workspaces.findById(Long.parseLong(header)).orElse(null);
        }
        return workspaces.findBySlug(header).orElse(null);
    }
}
