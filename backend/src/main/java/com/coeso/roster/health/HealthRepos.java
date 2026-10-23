package com.coeso.roster.health;

import com.coeso.roster.entity.DigestLog;
import com.coeso.roster.entity.EngagementSnapshot;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;

public final class HealthRepos {

    private HealthRepos() {
    }

    public interface EngagementSnapshotRepository extends JpaRepository<EngagementSnapshot, Long> {

        List<EngagementSnapshot> findByWorkspaceIdAndSnapshotDate(
                @Param("workspaceId") Long workspaceId, LocalDate snapshotDate);

        Optional<EngagementSnapshot> findFirstByWorkspaceIdAndUserIdAndSnapshotDate(
                @Param("workspaceId") Long workspaceId, Long userId, LocalDate snapshotDate);

        Optional<EngagementSnapshot> findFirstByWorkspaceIdOrderBySnapshotDateDesc(
                @Param("workspaceId") Long workspaceId);

        Optional<EngagementSnapshot> findFirstByWorkspaceIdAndUserIdOrderBySnapshotDateDesc(
                @Param("workspaceId") Long workspaceId, Long userId);

        /** The snapshot before a given day — the churn detector's baseline. */
        Optional<EngagementSnapshot> findFirstByWorkspaceIdAndUserIdAndSnapshotDateBeforeOrderBySnapshotDateDesc(
                @Param("workspaceId") Long workspaceId, Long userId, LocalDate snapshotDate);
    }

    public interface DigestLogRepository extends JpaRepository<DigestLog, Long> {

        Optional<DigestLog> findFirstByWorkspaceIdAndWeekStart(
                @Param("workspaceId") Long workspaceId, LocalDate weekStart);

        /** Row count for one (workspace, week) — idempotency assertions. */
        long countByWorkspaceIdAndWeekStart(
                @Param("workspaceId") Long workspaceId, LocalDate weekStart);

        Optional<DigestLog> findFirstByWorkspaceIdOrderByWeekStartDesc(
                @Param("workspaceId") Long workspaceId);
    }
}
