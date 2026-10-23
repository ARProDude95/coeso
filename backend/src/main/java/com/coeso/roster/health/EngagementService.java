package com.coeso.roster.health;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.discord.DiscordNotifier;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.EngagementSnapshot;
import com.coeso.roster.entity.IntroRequest;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.OfficeHourBooking;
import com.coeso.roster.entity.PodCheckin;
import com.coeso.roster.entity.PodMessage;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.entity.WorkspaceStatus;
import com.coeso.roster.intros.IntrosRepos.IntroRequestRepository;
import com.coeso.roster.officehours.OfficeHoursRepos.OfficeHourBookingRepository;
import com.coeso.roster.pods.PodsRepos.PodCheckinRepository;
import com.coeso.roster.pods.PodsRepos.PodMessageRepository;
import com.coeso.roster.repo.Repositories.AuditLogRepository;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.UserRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Engagement snapshots + churn-risk dashboard (feature 5, PROGRESS "Next
 * steps" #1). Every member gets one row per day in
 * {@code engagement_snapshots}: weighted activity over the trailing
 * {@code app.engagement.window-days} (default 30) plus days-inactive. Rows are
 * append-only per (workspace, member, day) — never updated or deleted — so the
 * churn detector always has a previous snapshot to compare against.
 *
 * <p>Risk signals on the owner dashboard, both configurable:
 * <ul>
 *   <li><b>DROP</b> — the member's latest score fell to
 *       {@code drop-percent}% (default 50) of the previous snapshot's score,
 *       and that previous score clears the {@code min-previous-score} noise
 *       floor (default 12).</li>
 *   <li><b>INACTIVE</b> — {@code days_inactive >= inactive-days}
 *       (default 14). days_inactive is exact when the member had activity
 *       inside the window; a member with no activity in the whole window is
 *       stored at the window length, which is always &gt;= the threshold.</li>
 * </ul>
 *
 * <p>Two call paths, same as {@link DigestService}: the request path
 * ({@link #snapshotNow()}, {@link #dashboard()}, {@link #nudge(Long)}) runs
 * inside the tenant filter with the workspace from {@link TenantContext}; the
 * scheduled job path ({@link #snapshotAllActiveWorkspaces()}) has no tenant
 * context, so <b>every query here constrains workspace_id explicitly</b>.
 */
@Service
public class EngagementService {

    private static final Logger log = LoggerFactory.getLogger(EngagementService.class);

    // Score weights — documented in V11's column comment and mirrored here.
    static final int W_AUDIT = 1;
    static final int W_CHECKIN = 4;
    static final int W_MESSAGE = 2;
    static final int W_INTRO = 3;
    static final int W_BOOKING = 3;

    // Metric slot indexes in the per-member int[].
    private static final int I_AUDIT = 0;
    private static final int I_CHECKIN = 1;
    private static final int I_MESSAGE = 2;
    private static final int I_INTRO = 3;
    private static final int I_BOOKING = 4;
    private static final int METRIC_COUNT = 5;

    /** One member's stored snapshot. */
    public record SnapshotView(Long userId, String displayName, LocalDate snapshotDate,
                               int score, int auditActions, int podCheckins, int podMessages,
                               int introActivity, int bookings, int daysInactive) {
    }

    /** A member the dashboard flags, with the signals that fired. */
    public record RiskMemberView(Long userId, String displayName, int score,
                                 Integer previousScore, int daysInactive, List<String> reasons) {
    }

    /** What GET /api/engagement/dashboard returns. */
    public record DashboardView(LocalDate snapshotDate, int membersConsidered,
                                List<RiskMemberView> atRisk) {
    }

    /** What POST /api/engagement/members/{id}/nudge returns. */
    public record NudgeView(Long userId, String displayName, String reason) {
    }

    private final WorkspaceRepository workspaces;
    private final MembershipRepository memberships;
    private final UserRepository users;
    private final AuditLogRepository auditLogs;
    private final PodCheckinRepository checkins;
    private final PodMessageRepository podMessages;
    private final IntroRequestRepository introRequests;
    private final OfficeHourBookingRepository bookings;
    private final HealthRepos.EngagementSnapshotRepository snapshots;
    private final AuditService audit;
    private final DiscordNotifier notifier;

    private final int windowDays;
    private final int inactiveDays;
    private final int dropPercent;
    private final int minPreviousScore;

    public EngagementService(WorkspaceRepository workspaces,
                             MembershipRepository memberships,
                             UserRepository users,
                             AuditLogRepository auditLogs,
                             PodCheckinRepository checkins,
                             PodMessageRepository podMessages,
                             IntroRequestRepository introRequests,
                             OfficeHourBookingRepository bookings,
                             HealthRepos.EngagementSnapshotRepository snapshots,
                             AuditService audit,
                             DiscordNotifier notifier,
                             @Value("${app.engagement.window-days:30}") int windowDays,
                             @Value("${app.engagement.inactive-days:14}") int inactiveDays,
                             @Value("${app.engagement.drop-percent:50}") int dropPercent,
                             @Value("${app.engagement.min-previous-score:12}") int minPreviousScore) {
        this.workspaces = workspaces;
        this.memberships = memberships;
        this.users = users;
        this.auditLogs = auditLogs;
        this.checkins = checkins;
        this.podMessages = podMessages;
        this.introRequests = introRequests;
        this.bookings = bookings;
        this.snapshots = snapshots;
        this.audit = audit;
        this.notifier = notifier;
        this.windowDays = windowDays;
        this.inactiveDays = inactiveDays;
        this.dropPercent = dropPercent;
        this.minPreviousScore = minPreviousScore;
    }

    // ------------------------------------------------------------- snapshots

    /**
     * Computes and stores today's snapshot for every active member of the
     * caller's workspace (owner+). Idempotent: members that already have a row
     * for today keep it — snapshots are append-only per day.
     */
    @PreAuthorize("@roles.hasAtLeast('OWNER')")
    public List<SnapshotView> snapshotNow() {
        return snapshotWorkspace(TenantContext.requireWorkspaceId(), LocalDate.now());
    }

    /**
     * The scheduled job's entry point: one snapshot per active member of every
     * active workspace. No tenant context, so all queries are explicitly
     * scoped; a failure in one workspace is logged and never stops the rest.
     *
     * @return how many active workspaces were snapshotted
     */
    public int snapshotAllActiveWorkspaces() {
        List<Workspace> active = workspaces.findByStatus(WorkspaceStatus.ACTIVE);
        int done = 0;
        for (Workspace workspace : active) {
            try {
                snapshotWorkspace(workspace.getId(), LocalDate.now());
                done++;
            } catch (RuntimeException e) {
                log.warn("Engagement snapshot failed for workspace {}: {}",
                        workspace.getId(), e.toString());
            }
        }
        return done;
    }

    /** Computes and stores one workspace's snapshots for one day. */
    private List<SnapshotView> snapshotWorkspace(Long workspaceId, LocalDate date) {
        LocalDateTime from = date.minusDays(windowDays).atStartOfDay();
        LocalDateTime endExclusive = date.plusDays(1).atStartOfDay();

        // Active members, in id order — the metric slots and the join anchor.
        Map<Long, int[]> metrics = new HashMap<>();
        Map<Long, LocalDateTime> joinedAt = new HashMap<>();
        for (Membership membership : memberships.findByWorkspaceId(workspaceId)) {
            metrics.putIfAbsent(membership.getUserId(), new int[METRIC_COUNT]);
            joinedAt.putIfAbsent(membership.getUserId(), membership.getCreatedAt());
        }
        Map<Long, LocalDateTime> lastActivity = new HashMap<>();

        for (AuditLog row : auditLogs.findByWorkspaceIdAndCreatedAtAfter(workspaceId, from)) {
            if (row.getActorUserId() == null || !inWindow(row.getCreatedAt(), from, endExclusive)) {
                continue;
            }
            int[] slot = metrics.get(row.getActorUserId());
            if (slot != null) {
                slot[I_AUDIT]++;
                touch(lastActivity, row.getActorUserId(), row.getCreatedAt());
            }
        }
        for (PodCheckin row : checkins.findByWorkspaceId(workspaceId)) {
            if (!inWindow(row.getCreatedAt(), from, endExclusive)) {
                continue;
            }
            int[] slot = metrics.get(row.getUserId());
            if (slot != null) {
                slot[I_CHECKIN]++;
                touch(lastActivity, row.getUserId(), row.getCreatedAt());
            }
        }
        for (PodMessage row : podMessages.findByWorkspaceId(workspaceId)) {
            if (!inWindow(row.getCreatedAt(), from, endExclusive)) {
                continue;
            }
            int[] slot = metrics.get(row.getUserId());
            if (slot != null) {
                slot[I_MESSAGE]++;
                touch(lastActivity, row.getUserId(), row.getCreatedAt());
            }
        }
        // Intro activity counts for both sides of the pair (self is refused
        // upstream, but the guard keeps the count honest anyway).
        for (IntroRequest row : introRequests.findByWorkspaceId(workspaceId)) {
            if (!inWindow(row.getCreatedAt(), from, endExclusive)) {
                continue;
            }
            int[] fromSlot = metrics.get(row.getFromUserId());
            if (fromSlot != null) {
                fromSlot[I_INTRO]++;
                touch(lastActivity, row.getFromUserId(), row.getCreatedAt());
            }
            if (!Objects.equals(row.getFromUserId(), row.getToUserId())) {
                int[] toSlot = metrics.get(row.getToUserId());
                if (toSlot != null) {
                    toSlot[I_INTRO]++;
                    touch(lastActivity, row.getToUserId(), row.getCreatedAt());
                }
            }
        }
        // Bookings count for the member and the expert.
        for (OfficeHourBooking row : bookings.findByWorkspaceId(workspaceId)) {
            if (!inWindow(row.getCreatedAt(), from, endExclusive)) {
                continue;
            }
            int[] member = metrics.get(row.getMemberUserId());
            if (member != null) {
                member[I_BOOKING]++;
                touch(lastActivity, row.getMemberUserId(), row.getCreatedAt());
            }
            if (!Objects.equals(row.getMemberUserId(), row.getExpertUserId())) {
                int[] expert = metrics.get(row.getExpertUserId());
                if (expert != null) {
                    expert[I_BOOKING]++;
                    touch(lastActivity, row.getExpertUserId(), row.getCreatedAt());
                }
            }
        }

        for (Long userId : metrics.keySet().stream().sorted().toList()) {
            if (snapshots.findFirstByWorkspaceIdAndUserIdAndSnapshotDate(
                    workspaceId, userId, date).isPresent()) {
                continue; // today's row is canonical: append-only per day
            }
            int[] slot = metrics.get(userId);
            EngagementSnapshot row = new EngagementSnapshot();
            row.setWorkspaceId(workspaceId);
            row.setUserId(userId);
            row.setSnapshotDate(date);
            row.setAuditActions(slot[I_AUDIT]);
            row.setPodCheckins(slot[I_CHECKIN]);
            row.setPodMessages(slot[I_MESSAGE]);
            row.setIntroActivity(slot[I_INTRO]);
            row.setBookings(slot[I_BOOKING]);
            row.setScore(slot[I_AUDIT] * W_AUDIT + slot[I_CHECKIN] * W_CHECKIN
                    + slot[I_MESSAGE] * W_MESSAGE + slot[I_INTRO] * W_INTRO
                    + slot[I_BOOKING] * W_BOOKING);
            row.setDaysInactive(daysInactive(userId, joinedAt, lastActivity, from, date));
            try {
                snapshots.saveAndFlush(row);
            } catch (DataIntegrityViolationException race) {
                // Another writer won the (workspace, member, day) unique key —
                // theirs is canonical, same as the digest build.
            }
        }

        return snapshots.findByWorkspaceIdAndSnapshotDate(workspaceId, date).stream()
                .sorted(Comparator.comparing(EngagementSnapshot::getUserId))
                .map(this::view)
                .toList();
    }

    /**
     * Days since the member's last tracked activity: exact when it falls in
     * the window; with no in-window activity, days since they joined (recent
     * joiners are not "inactive"), or the window length for members who have
     * been around longer — always at or above the INACTIVE threshold.
     */
    private int daysInactive(Long userId, Map<Long, LocalDateTime> joinedAt,
                             Map<Long, LocalDateTime> lastActivity,
                             LocalDateTime from, LocalDate date) {
        LocalDateTime last = lastActivity.get(userId);
        if (last == null) {
            LocalDateTime joined = joinedAt.get(userId);
            last = joined != null && joined.isAfter(from) ? joined : null;
            if (last == null) {
                return windowDays;
            }
        }
        return Math.max(0, (int) ChronoUnit.DAYS.between(last.toLocalDate(), date));
    }

    private static boolean inWindow(LocalDateTime createdAt, LocalDateTime from,
                                    LocalDateTime endExclusive) {
        return createdAt != null && !createdAt.isBefore(from) && createdAt.isBefore(endExclusive);
    }

    private static void touch(Map<Long, LocalDateTime> lastActivity, Long userId,
                              LocalDateTime at) {
        lastActivity.merge(userId, at, (a, b) -> a.isAfter(b) ? a : b);
    }

    // ------------------------------------------------------------- dashboard

    /**
     * The owner's churn dashboard over the latest stored snapshot day: members
     * whose score dropped sharply against their previous snapshot and/or who
     * have been inactive too long. Empty (not an error) before the first
     * snapshot; deterministic ordering (score asc, then member id).
     */
    @PreAuthorize("@roles.hasAtLeast('OWNER')")
    public DashboardView dashboard() {
        Long ws = TenantContext.requireWorkspaceId();
        LocalDate latest = snapshots.findFirstByWorkspaceIdOrderBySnapshotDateDesc(ws)
                .map(EngagementSnapshot::getSnapshotDate)
                .orElse(null);
        if (latest == null) {
            return new DashboardView(null, 0, List.of());
        }
        List<EngagementSnapshot> rows = snapshots.findByWorkspaceIdAndSnapshotDate(ws, latest);
        List<RiskMemberView> atRisk = new ArrayList<>();
        for (EngagementSnapshot row : rows) {
            List<String> reasons = new ArrayList<>();
            Optional<EngagementSnapshot> previous = snapshots
                    .findFirstByWorkspaceIdAndUserIdAndSnapshotDateBeforeOrderBySnapshotDateDesc(
                            ws, row.getUserId(), latest);
            boolean drop = previous.isPresent()
                    && previous.get().getScore() >= minPreviousScore
                    && row.getScore() * 100 <= previous.get().getScore() * (100 - dropPercent);
            if (drop) {
                reasons.add("DROP");
            }
            if (row.getDaysInactive() >= inactiveDays) {
                reasons.add("INACTIVE");
            }
            if (!reasons.isEmpty()) {
                atRisk.add(new RiskMemberView(row.getUserId(), displayName(row.getUserId()),
                        row.getScore(),
                        previous.map(EngagementSnapshot::getScore).orElse(null),
                        row.getDaysInactive(), List.copyOf(reasons)));
            }
        }
        atRisk.sort(Comparator.comparingInt(RiskMemberView::score)
                .thenComparing(RiskMemberView::userId));
        return new DashboardView(latest, rows.size(), List.copyOf(atRisk));
    }

    // ---------------------------------------------------------------- nudge

    /**
     * Sends a templated engagement nudge to one active member through the
     * {@link DiscordNotifier} seam (never fails the request — the notifier
     * contract swallows delivery errors) and records an audit row. The reason
     * text comes from the member's own latest snapshot when a signal fired.
     */
    @PreAuthorize("@roles.hasAtLeast('OWNER')")
    public NudgeView nudge(Long userId) {
        Long ws = TenantContext.requireWorkspaceId();
        boolean active = memberships.findByWorkspaceId(ws).stream()
                .anyMatch(m -> Objects.equals(m.getUserId(), userId));
        if (!active) {
            throw new NotFoundException("User " + userId
                    + " is not an active member of this workspace");
        }
        String name = displayName(userId);
        String reason = nudgeReason(ws, userId);
        notifier.engagementNudge(ws, name, reason);
        audit.record("CREATE", "engagement_nudge", userId, Map.of("reason", reason));
        return new NudgeView(userId, name, reason);
    }

    /** The signal that fired for this member, phrased for the message. */
    private String nudgeReason(Long ws, Long userId) {
        Optional<EngagementSnapshot> latest = snapshots
                .findFirstByWorkspaceIdAndUserIdOrderBySnapshotDateDesc(ws, userId);
        if (latest.isEmpty()) {
            return "engagement check-in";
        }
        EngagementSnapshot row = latest.get();
        if (row.getDaysInactive() >= inactiveDays) {
            return "no tracked activity for " + row.getDaysInactive() + " days";
        }
        Optional<EngagementSnapshot> previous = snapshots
                .findFirstByWorkspaceIdAndUserIdAndSnapshotDateBeforeOrderBySnapshotDateDesc(
                        ws, userId, row.getSnapshotDate());
        if (previous.isPresent() && previous.get().getScore() >= minPreviousScore
                && row.getScore() * 100 <= previous.get().getScore() * (100 - dropPercent)) {
            return "engagement dropped from " + previous.get().getScore()
                    + " to " + row.getScore();
        }
        return "engagement check-in";
    }

    // ----------------------------------------------------------------- misc

    /** Display name of a member, falling back to the email's local part. */
    private String displayName(Long userId) {
        return users.findById(userId)
                .map(u -> u.getDisplayName() == null || u.getDisplayName().isBlank()
                        ? u.getEmail().replaceAll("@.*", "")
                        : u.getDisplayName())
                .orElse("Unknown member");
    }

    private SnapshotView view(EngagementSnapshot row) {
        return new SnapshotView(row.getUserId(), displayName(row.getUserId()),
                row.getSnapshotDate(), row.getScore(), row.getAuditActions(),
                row.getPodCheckins(), row.getPodMessages(), row.getIntroActivity(),
                row.getBookings(), row.getDaysInactive());
    }
}
