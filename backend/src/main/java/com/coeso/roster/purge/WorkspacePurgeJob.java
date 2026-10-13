package com.coeso.roster.purge;

import com.coeso.roster.entity.Workspace;
import com.coeso.roster.entity.WorkspaceStatus;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Rule: workspaces are soft-deleted (status = deleted); this job removes their
 * children in dependency order and leaves the workspace row as a tombstone.
 *
 * <p>Runs on a schedule and once at startup. It is a system-wide operation, so
 * it does not use the tenant filter; every statement is explicitly scoped by
 * workspace_id.
 */
@Component
public class WorkspacePurgeJob {

    private static final Logger log = LoggerFactory.getLogger(WorkspacePurgeJob.class);

    /** Child tables in FK-safe deletion order (parents of a row come later). */
    private static final List<String> CHILD_TABLES = List.of(
            "placement_requests",
            "placements",
            "offers",
            "clients",
            "invites",
            "subscriptions",
            "billing_events",
            "workspace_discord",
            "audit_log",
            "memberships",
            "reps",
            "verticals",
            "rep_statuses",
            "experience_levels");

    private final WorkspaceRepository workspaces;
    private final TransactionTemplate transactionTemplate;

    public WorkspacePurgeJob(WorkspaceRepository workspaces,
                             PlatformTransactionManager transactionManager) {
        this.workspaces = workspaces;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @Scheduled(initialDelayString = "${app.purge.initial-delay-ms:15000}",
            fixedDelayString = "${app.purge.interval-ms:3600000}")
    public void scheduledPurge() {
        int purged = purgeDeletedWorkspaces();
        if (purged > 0) {
            log.info("Purged children of {} deleted workspace(s)", purged);
        }
    }

    /** Returns how many deleted workspaces were purged. */
    public int purgeDeletedWorkspaces() {
        List<Workspace> deleted = workspaces.findByStatus(WorkspaceStatus.DELETED);
        if (deleted.isEmpty()) {
            return 0;
        }
        for (Workspace workspace : deleted) {
            Long workspaceId = workspace.getId();
            transactionTemplate.executeWithoutResult(status -> {
                for (String table : CHILD_TABLES) {
                    // String-built table names come from the fixed whitelist above,
                    // never from user input.
                    int rows = entityManager()
                            .createNativeQuery("delete from " + table + " where workspace_id = ?1")
                            .setParameter(1, workspaceId)
                            .executeUpdate();
                    if (rows > 0) {
                        log.debug("Purged {} row(s) from {} for workspace {}", rows, table, workspaceId);
                    }
                }
            });
        }
        return deleted.size();
    }

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    private jakarta.persistence.EntityManager entityManager() {
        return entityManager;
    }
}
