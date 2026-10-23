package com.coeso.roster.repo;

import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.ActivityEntry;
import com.coeso.roster.entity.BillingEvent;
import com.coeso.roster.entity.Client;
import com.coeso.roster.entity.CommissionRule;
import com.coeso.roster.entity.ExperienceLevel;
import com.coeso.roster.entity.LedgerEntry;
import com.coeso.roster.entity.MetricType;
import com.coeso.roster.entity.Payout;
import com.coeso.roster.entity.Invite;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.OfferStatus;
import com.coeso.roster.entity.PipelineStage;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.entity.PlacementRequest;
import com.coeso.roster.entity.Plan;
import com.coeso.roster.entity.Rep;
import com.coeso.roster.entity.RepStatus;
import com.coeso.roster.entity.Subscription;
import com.coeso.roster.entity.User;
import com.coeso.roster.entity.Vertical;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.entity.WorkspaceDiscord;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Repository interfaces. Tenant-owned repositories are only ever called from
 * service methods, where the workspace filter is already enabled; the few
 * bootstrap queries (membership resolution, slug lookup) constrain workspace_id
 * explicitly in their signatures.
 */
public final class Repositories {

    private Repositories() {
    }

    public interface PlanRepository extends JpaRepository<Plan, Long> {
        Optional<Plan> findByCode(String code);
    }

    public interface UserRepository extends JpaRepository<User, Long> {
        Optional<User> findByEmail(String email);

        /** Discord OAuth login: identity lookup by the linked Discord account. */
        Optional<User> findByDiscordId(String discordId);
    }

    /** Global table (workspaces has no workspace_id), safe to query unscoped. */
    public interface WorkspaceRepository extends JpaRepository<Workspace, Long> {
        Optional<Workspace> findBySlug(String slug);

        List<Workspace> findByStatus(com.coeso.roster.entity.WorkspaceStatus status);
    }

    public interface VerticalRepository extends JpaRepository<Vertical, Long> {
    }

    public interface RepStatusRepository extends JpaRepository<RepStatus, Long> {
    }

    public interface ExperienceLevelRepository extends JpaRepository<ExperienceLevel, Long> {
    }

    public interface RepRepository extends JpaRepository<Rep, Long> {
    }

    public interface ClientRepository extends JpaRepository<Client, Long> {
    }

    public interface OfferRepository extends JpaRepository<Offer, Long> {

        /** Open deals of one workspace — the weekly digest's pipeline line. */
        long countByWorkspaceIdAndStatus(Long workspaceId, OfferStatus status);
    }

    public interface PipelineStageRepository extends JpaRepository<PipelineStage, Long> {
    }

    public interface PlacementRepository extends JpaRepository<Placement, Long> {
    }

    public interface PlacementRequestRepository extends JpaRepository<PlacementRequest, Long> {
    }

    public interface MembershipRepository extends JpaRepository<Membership, Long> {

        /**
         * Bootstrap query for workspace resolution: workspace_id is part of the
         * signature, so the result is scoped even before the filter is enabled.
         */
        Optional<Membership> findByUserIdAndWorkspaceId(Long userId, Long workspaceId);

        /** All memberships of one user (the workspace picker's global view). */
        List<Membership> findAllByUserId(Long userId);

        long countByWorkspaceId(Long workspaceId);

        /** All memberships of one workspace — the engagement snapshot's member list. */
        List<Membership> findByWorkspaceId(Long workspaceId);

        /**
         * Members whose user account was created at or after {@code since} —
         * the weekly digest's "new members" line.
         */
        @Query("select m from Membership m join m.user u"
                + " where m.workspaceId = :workspaceId and u.createdAt >= :since")
        List<Membership> findByWorkspaceIdJoinedSince(
                @Param("workspaceId") Long workspaceId, @Param("since") LocalDateTime since);
    }

    public interface InviteRepository extends JpaRepository<Invite, Long> {

        /**
         * Bootstrap lookup by token hash for the accept endpoint: the acceptor
         * is not a member yet, so this runs WITHOUT the tenant filter (the hash
         * itself is unguessable and unique). The workspace then comes from the
         * invite row, never from the request.
         */
        Optional<Invite> findByTokenHash(String tokenHash);

        List<Invite> findByWorkspaceId(Long workspaceId);
    }

    public interface SubscriptionRepository extends JpaRepository<Subscription, Long> {
        Optional<Subscription> findByWorkspaceId(Long workspaceId);
    }

    public interface BillingEventRepository extends JpaRepository<BillingEvent, Long> {

        /**
         * Idempotency probe for webhook delivery. Unscoped by design: the
         * (provider, event_id) unique key is global, and webhooks arrive
         * without a tenant context.
         */
        boolean existsByProviderAndEventId(String provider, String eventId);
    }

    public interface WorkspaceDiscordRepository extends JpaRepository<WorkspaceDiscord, Long> {

        /** One connection per workspace (unique key on workspace_id). */
        Optional<WorkspaceDiscord> findByWorkspaceId(Long workspaceId);
    }

    public interface AuditLogRepository extends JpaRepository<AuditLog, Long> {

        /** Rows a member acted on after a point in time — the digest's activity window. */
        List<AuditLog> findByWorkspaceIdAndCreatedAtAfter(
                @Param("workspaceId") Long workspaceId, LocalDateTime after);
    }

    // --------------------------------------------------- Phase 7 repositories

    public interface MetricTypeRepository extends JpaRepository<MetricType, Long> {
    }

    public interface ActivityEntryRepository extends JpaRepository<ActivityEntry, Long> {
    }

    public interface CommissionRuleRepository extends JpaRepository<CommissionRule, Long> {
    }

    public interface LedgerEntryRepository extends JpaRepository<LedgerEntry, Long> {
    }

    public interface PayoutRepository extends JpaRepository<Payout, Long> {
    }
}
