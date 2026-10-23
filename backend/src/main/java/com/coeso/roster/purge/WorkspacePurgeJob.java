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

    /**
     * Child tables in FK-safe deletion order (every child is deleted before
     * any table it references through an FK). Covers every tenant table from
     * V1 to V11: a workspace_id column exists only on these tables plus
     * {@code workspaces} itself, which is kept as a tombstone — and
     * {@code WorkspacePurgeTest} asserts exactly that against
     * information_schema, so a future migration that adds a child table fails
     * the suite until it is listed here.
     *
     * <p>The original V1-only list made every purge of a workspace with rows
     * in a later table fail with {@code Cannot delete or update a parent row}
     * (observed live on 2026-10-20: {@code offer_required_skills} (V4)
     * blocking {@code offers}), leaving the children un-purged forever.
     */
    public static final List<String> CHILD_TABLES = List.of(
            // V5 ledger chain first: ledger_entries references activity_entries,
            // commission_rules and payouts as well as placements/reps, so it
            // goes before all of them; those in turn before placements / offers.
            "ledger_entries",
            "commission_rules",
            "payouts",
            "activity_entries",
            // V1 offer/pipeline side
            "placement_requests",
            "placements",
            // V4 children of offers / reps / skill_tags
            "offer_required_skills",
            "rep_skills",
            "rep_languages",
            "rep_preferred_verticals",
            "rep_photos",
            "memberships", // memberships.rep_id -> reps
            // V7 office hours: payout ledger -> booking -> slot
            "payout_ledger_entries",
            "office_hour_bookings",
            "offers", // -> clients, verticals, experience_levels, pipeline_stages
            "office_hour_slots",
            "pipeline_stages",
            "clients",
            // V1 workspace-level children
            "invites",
            "subscriptions",
            "billing_events",
            "workspace_discord",
            "audit_log",
            // V9/V10 pod children before pods
            "pod_members",
            "pod_checkins",
            "pod_messages",
            "pods",
            // V4 tags after rep_skills / offer_required_skills reference them
            "skill_tags",
            // reps after everything that references them; lookups after reps
            "reps",
            "verticals",
            "rep_statuses",
            "experience_levels",
            // V5/V8/V11 workspace-level children
            "metric_types",
            "member_profiles",
            "intro_requests",
            "engagement_snapshots",
            "digest_logs");

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
