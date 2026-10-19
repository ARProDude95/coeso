package com.coeso.roster.intros;

import com.coeso.roster.entity.IntroRequest;
import com.coeso.roster.entity.MemberProfile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;

public final class IntrosRepos {

    private IntrosRepos() {
    }

    public interface MemberProfileRepository extends JpaRepository<MemberProfile, Long> {

        java.util.Optional<MemberProfile> findByWorkspaceIdAndUserId(
                @Param("workspaceId") Long workspaceId, Long userId);

        java.util.List<MemberProfile> findByWorkspaceId(
                @Param("workspaceId") Long workspaceId);

        // The two's-pair queries the scorer page needs are computed in memory;
        // workspaces are small, so one indexed list scan suffices.
        java.util.List<MemberProfile> findByWorkspaceIdAndUserIdIn(
                @Param("workspaceId") Long workspaceId, java.util.Collection<Long> userIds);
    }

    public interface IntroRequestRepository extends JpaRepository<IntroRequest, Long> {

        java.util.List<IntroRequest> findByWorkspaceIdAndFromUserId(
                @Param("workspaceId") Long workspaceId, Long fromUserId);

        java.util.List<IntroRequest> findByWorkspaceIdAndToUserId(
                @Param("workspaceId") Long workspaceId, Long toUserId);

        long countByWorkspaceIdAndFromUserIdAndStatus(
                @Param("workspaceId") Long workspaceId, Long fromUserId,
                IntroRequest.Status status);
    }
}
