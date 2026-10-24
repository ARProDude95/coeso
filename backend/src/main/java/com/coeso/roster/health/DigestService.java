package com.coeso.roster.health;

import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.discord.DiscordNotifier;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.DigestLog;
import com.coeso.roster.entity.IntroRequest;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.OfferStatus;
import com.coeso.roster.entity.PodCheckin;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.entity.WorkspaceStatus;
import com.coeso.roster.intros.IntrosRepos.IntroRequestRepository;
import com.coeso.roster.officehours.OfficeHoursRepos.OfficeHourBookingRepository;
import com.coeso.roster.plan.PlanLimitService;
import com.coeso.roster.pods.PodsRepos.PodCheckinRepository;
import com.coeso.roster.repo.Repositories.AuditLogRepository;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.OfferRepository;
import com.coeso.roster.repo.Repositories.UserRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Weekly digest (feature 5, PROGRESS "Next steps" #2): every week each active
 * workspace gets one plain-text summary of what happened — activity, new
 * members, top contributors, pipeline — rendered through the
 * {@link Summarizer} seam (templated default; an LLM can replace it without
 * touching this class), stored in {@code digest_logs} (one row per workspace
 * and ISO week, so the job is idempotent), and delivered through the existing
 * {@link DiscordNotifier} seam. Email delivery is queued behind the same
 * seam once SMTP exists — there is no paid API dependency anywhere in here.
 *
 * <p>Two call paths: the request path ({@link #latest()} / {@link #buildNow()})
 * runs inside the tenant filter and takes the workspace from
 * {@link TenantContext}; the scheduled job path
 * ({@link #buildAllForActiveWorkspaces()}) has no tenant context at all, so
 * <b>every query in this service constrains workspace_id explicitly</b> and is
 * correct on both sides.
 */
@Service
public class DigestService {

    private static final Logger log = LoggerFactory.getLogger(DigestService.class);

    /** Label carried by the 402 PRO_FEATURE_REQUIRED envelope (phase 12). */
    static final String FEATURE = "weekly digest";

    /** Bookings counted in the "last 7d" pipeline line. */
    private static final int BOOKING_WINDOW_DAYS = 7;

    private final WorkspaceRepository workspaces;
    private final AuditLogRepository auditLogs;
    private final MembershipRepository memberships;
    private final OfferRepository offers;
    private final PodCheckinRepository checkins;
    private final IntroRequestRepository introRequests;
    private final OfficeHourBookingRepository bookings;
    private final UserRepository users;
    private final HealthRepos.DigestLogRepository digestLogs;
    private final PlanLimitService planLimits;
    private final Summarizer summarizer;
    private final DiscordNotifier notifier;

    public DigestService(WorkspaceRepository workspaces,
                         AuditLogRepository auditLogs,
                         MembershipRepository memberships,
                         OfferRepository offers,
                         PodCheckinRepository checkins,
                         IntroRequestRepository introRequests,
                         OfficeHourBookingRepository bookings,
                         UserRepository users,
                         HealthRepos.DigestLogRepository digestLogs,
                         PlanLimitService planLimits,
                         Summarizer summarizer,
                         DiscordNotifier notifier) {
        this.workspaces = workspaces;
        this.auditLogs = auditLogs;
        this.memberships = memberships;
        this.offers = offers;
        this.checkins = checkins;
        this.introRequests = introRequests;
        this.bookings = bookings;
        this.users = users;
        this.digestLogs = digestLogs;
        this.planLimits = planLimits;
        this.summarizer = summarizer;
        this.notifier = notifier;
    }

    /** What GET /api/digest returns. */
    public record DigestView(Long id, LocalDate weekStart, String body, LocalDateTime generatedAt) {
    }

    /** The caller's workspace's most recent stored digest (any week). */
    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public DigestView latest() {
        Long ws = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(ws, FEATURE);
        DigestLog row = digestLogs.findFirstByWorkspaceIdOrderByWeekStartDesc(ws)
                .orElseThrow(() -> new NotFoundException(
                        "No digest has been generated for this workspace yet — "
                                + "build one with POST /api/digest/build"));
        return view(row);
    }

    /**
     * Builds the current week's digest for the caller's workspace if it does
     * not exist yet, and returns it — idempotent by (workspace, ISO week).
     */
    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public DigestView buildNow() {
        Long ws = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(ws, FEATURE);
        return view(buildForWorkspace(ws));
    }

    /**
     * The scheduled job's entry point: one digest per active workspace for the
     * current ISO week. Runs outside any request, so there is no tenant
     * context; a failure in one workspace is logged and never stops the rest.
     *
     * @return how many workspaces now have this week's digest (including ones
     *         that already had it — the call itself is idempotent)
     */
    public int buildAllForActiveWorkspaces() {
        List<Workspace> active = workspaces.findByStatus(WorkspaceStatus.ACTIVE);
        int done = 0;
        int skipped = 0;
        for (Workspace workspace : active) {
            // [PRO] only: a workspace below Pro gets no digest and no Discord
            // delivery — the gate is the plan, not the workspace's age.
            if (!planLimits.supportsPro(workspace.getId())) {
                skipped++;
                continue;
            }
            try {
                buildForWorkspace(workspace.getId());
                done++;
            } catch (RuntimeException e) {
                log.warn("Weekly digest failed for workspace {}: {}",
                        workspace.getId(), e.toString());
            }
        }
        if (skipped > 0) {
            log.info("Weekly digest skipped {} workspace(s) without a [PRO] plan", skipped);
        }
        return done;
    }

    // ------------------------------------------------------------- building

    /** Returns the existing row when this week's digest is already stored. */
    private DigestLog buildForWorkspace(Long workspaceId) {
        LocalDate weekStart = currentWeekStart();
        Optional<DigestLog> existing = digestLogs.findFirstByWorkspaceIdAndWeekStart(
                workspaceId, weekStart);
        if (existing.isPresent()) {
            return existing.get();
        }
        String body = summarizer.summarize(facts(workspaceId, weekStart));
        DigestLog row = new DigestLog();
        row.setWorkspaceId(workspaceId);
        row.setWeekStart(weekStart);
        row.setBody(body);
        DigestLog saved;
        try {
            saved = digestLogs.saveAndFlush(row);
        } catch (DataIntegrityViolationException race) {
            // Another build won the (workspace, week) unique key — theirs is
            // canonical; hand that back instead of failing the job.
            return digestLogs.findFirstByWorkspaceIdAndWeekStart(workspaceId, weekStart)
                    .orElseThrow(() -> race);
        }
        // Never throws (interface contract): delivery failure must not undo a
        // stored digest. The row in digest_logs is the durable record.
        notifier.weeklyDigest(workspaceId, body);
        // TODO: queue the same body for email delivery once SMTP exists —
        // plain text in, plain text out, no paid API in between.
        return saved;
    }

    /** Facts of one workspace week — every query scoped by workspace_id. */
    private Summarizer.Facts facts(Long workspaceId, LocalDate weekStart) {
        LocalDateTime sinceWeek = weekStart.atStartOfDay();
        Workspace workspace = workspaces.findById(workspaceId)
                .orElseThrow(() -> new NotFoundException("Workspace " + workspaceId));

        // Tracked actions this week, grouped per member: they double as the
        // "top contributors" ranking and the active-member count.
        Map<Long, Integer> actionsByMember = new HashMap<>();
        for (AuditLog row : auditLogs.findByWorkspaceIdAndCreatedAtAfter(workspaceId, sinceWeek)) {
            if (row.getActorUserId() != null) {
                actionsByMember.merge(row.getActorUserId(), 1, Integer::sum);
            }
        }

        // Check-ins filed for this week's ISO Monday (or a later week).
        Set<Long> checkedIn = new HashSet<>();
        int checkinsThisWeek = 0;
        for (PodCheckin checkin : checkins.findByWorkspaceId(workspaceId)) {
            if (!checkin.getWeekStart().isBefore(weekStart)) {
                checkinsThisWeek++;
                checkedIn.add(checkin.getUserId());
            }
        }

        Set<Long> active = new HashSet<>(actionsByMember.keySet());
        active.addAll(checkedIn);

        List<Summarizer.Contributor> topContributors = actionsByMember.entrySet().stream()
                .sorted(Map.Entry.<Long, Integer>comparingByValue().reversed()
                        .thenComparing(e -> displayName(e.getKey())))
                .map(e -> new Summarizer.Contributor(displayName(e.getKey()), e.getValue()))
                .collect(Collectors.toList());

        List<Membership> joined = memberships.findByWorkspaceIdJoinedSince(workspaceId, sinceWeek);
        List<String> newNames = joined.stream()
                .map(m -> displayName(m.getUserId()))
                .collect(Collectors.toList());

        LocalDateTime bookingsSince = LocalDateTime.now().minusDays(BOOKING_WINDOW_DAYS);
        int bookingsLast7d = (int) bookings.findByWorkspaceId(workspaceId).stream()
                .filter(b -> !b.getCreatedAt().isBefore(bookingsSince))
                .count();

        return new Summarizer.Facts(
                workspace.getName(),
                weekStart,
                active.size(),
                checkinsThisWeek,
                newNames.size(),
                newNames,
                topContributors,
                (int) offers.countByWorkspaceIdAndStatus(workspaceId, OfferStatus.OPEN),
                bookingsLast7d,
                (int) introRequests.countByWorkspaceIdAndStatus(
                        workspaceId, IntroRequest.Status.PENDING));
    }

    /** Display name of a member, falling back to the email's local part. */
    private String displayName(Long userId) {
        return users.findById(userId)
                .map(u -> u.getDisplayName() == null || u.getDisplayName().isBlank()
                        ? u.getEmail().replaceAll("@.*", "")
                        : u.getDisplayName())
                .orElse("Unknown member");
    }

    private static LocalDate currentWeekStart() {
        return LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    private static DigestView view(DigestLog row) {
        return new DigestView(row.getId(), row.getWeekStart(), row.getBody(), row.getCreatedAt());
    }
}
