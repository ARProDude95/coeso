package com.coeso.roster.pods;

import com.coeso.roster.entity.Pod;
import com.coeso.roster.entity.PodCheckin;
import com.coeso.roster.entity.PodMember;
import com.coeso.roster.entity.PodMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;

public final class PodsRepos {

    private PodsRepos() {
    }

    public interface PodRepository extends JpaRepository<Pod, Long> {

        java.util.List<Pod> findByWorkspaceIdAndStatus(
                @Param("workspaceId") Long workspaceId, Pod.Status status);
    }

    public interface PodMemberRepository extends JpaRepository<PodMember, Long> {

        java.util.List<PodMember> findByWorkspaceId(
                @Param("workspaceId") Long workspaceId);

        java.util.List<PodMember> findByWorkspaceIdAndPodId(
                @Param("workspaceId") Long workspaceId, Long podId);

        java.util.List<PodMember> findByWorkspaceIdAndUserId(
                @Param("workspaceId") Long workspaceId, Long userId);

        java.util.Optional<PodMember> findFirstByWorkspaceIdAndPodIdAndUserId(
                @Param("workspaceId") Long workspaceId, Long podId, Long userId);
    }

    public interface PodCheckinRepository extends JpaRepository<PodCheckin, Long> {

        java.util.List<PodCheckin> findByWorkspaceIdAndPodIdOrderByWeekStartDescIdDesc(
                @Param("workspaceId") Long workspaceId, Long podId);

        java.util.List<PodCheckin> findByWorkspaceId(
                @Param("workspaceId") Long workspaceId);

        java.util.Optional<PodCheckin> findFirstByWorkspaceIdAndPodIdAndUserIdAndWeekStart(
                @Param("workspaceId") Long workspaceId, Long podId, Long userId,
                java.time.LocalDate weekStart);

        // Streak: the most recent week the member checked in on.
        java.util.Optional<PodCheckin> findFirstByWorkspaceIdAndPodIdAndUserIdOrderByWeekStartDesc(
                @Param("workspaceId") Long workspaceId, Long podId, Long userId);
    }

    public interface PodMessageRepository extends JpaRepository<PodMessage, Long> {

        java.util.List<PodMessage> findByWorkspaceIdAndPodIdOrderByCreatedAtAscIdAsc(
                @Param("workspaceId") Long workspaceId, Long podId);

        /** Workspace-wide rows — the engagement window's message counts. */
        java.util.List<PodMessage> findByWorkspaceId(
                @Param("workspaceId") Long workspaceId);
    }
}
