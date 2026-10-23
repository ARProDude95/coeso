package com.coeso.roster.pods;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ForbiddenException;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.UnauthorizedException;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.MemberProfile;
import com.coeso.roster.entity.Pod;
import com.coeso.roster.entity.PodCheckin;
import com.coeso.roster.entity.PodMember;
import com.coeso.roster.entity.PodMessage;
import com.coeso.roster.entity.User;
import com.coeso.roster.intros.IntrosRepos.MemberProfileRepository;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.UserRepository;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Mastermind pods: an owner/admin generates a preview grouping of the
 * workspace's active members into pods of 2-8 balanced by industry *and*
 * revenue stage (stable, deterministic: members sorted industry- then
 * stage-adjacent, whole cohorts packed into pods; a cohort splits only when
 * it exceeds a pod), can adjust it manually, then publishes — publishing
 * archives the previous generation and writes the new pods in one shot.
 * Each pod is private to its members (and admins) and hosts weekly
 * check-ins with an attendance streak.
 */
@Service
public class PodsService {

    public record PodDraft(String industry, List<Long> userIds) {
    }

    public record DraftView(String industry, List<Long> userIds, List<String> names,
                            List<String> revenueStages) {
    }

    public record PodView(Long id, String name, String industry, List<MemberLine> members) {
    }

    public record MemberLine(Long userId, String displayName, Integer streak,
                             String revenueStage) {
    }

    public record CheckinRequest(LocalDate weekStart, String wins, String blockers,
                                 String ask) {
    }

    public record CheckinView(Long id, Long podId, Long userId, String displayName,
                              LocalDate weekStart, String wins, String blockers,
                              String ask) {
    }

    /** One post in the pod's private thread. */
    public record MessageRequest(String body) {
    }

    public record MessageView(Long id, Long podId, Long userId, String displayName,
                              String body, LocalDateTime createdAt) {
    }

    private static final int MAX_POD_NAME_LENGTH = 80;
    private static final int MAX_TEXT_LENGTH = 1000;
    private static final int MAX_THREAD_MESSAGES = 200;
    /** Hard cap per pod (spec target is 5-8; 2 is the publish minimum). */
    private static final int MAX_POD_SIZE = 8;

    /**
     * Joins the two grouping dimensions (industry, revenue stage) into one
     * sort key: a control-char separator keeps the key sorting industry-major
     * ("Fintech\u0001Seed" sorts with the rest of "Fintech") while still
     * letting same-industry members cluster by stage.
     */
    static final char GROUP_SEP = '\u0001';

    private final PodsRepos.PodRepository pods;
    private final PodsRepos.PodMemberRepository podMembers;
    private final PodsRepos.PodCheckinRepository checkins;
    private final PodsRepos.PodMessageRepository podMessages;
    private final MemberProfileRepository memberProfiles;
    private final UserRepository users;
    private final MembershipRepository memberships;
    private final AuditService audit;

    public PodsService(PodsRepos.PodRepository pods,
                       PodsRepos.PodMemberRepository podMembers,
                       PodsRepos.PodCheckinRepository checkins,
                       PodsRepos.PodMessageRepository podMessages,
                       MemberProfileRepository memberProfiles,
                       UserRepository users,
                       MembershipRepository memberships,
                       AuditService audit) {
        this.pods = pods;
        this.podMembers = podMembers;
        this.checkins = checkins;
        this.podMessages = podMessages;
        this.memberProfiles = memberProfiles;
        this.users = users;
        this.memberships = memberships;
        this.audit = audit;
    }

    // ------------------------------------------------------------ generation

    /**
     * Preview: active members grouped by industry and revenue stage, balanced
     * so that revenue-stage cohorts stay together within a pod. Deterministic
     * — the same membership produces the same grouping, so "publish" without
     * overrides writes exactly what the preview showed.
     */
    public List<DraftView> generatePreview() {
        Long ws = TenantContext.requireWorkspaceId();
        List<Long> active = activeMemberIds(ws);
        List<PodDraft> drafts = greedyGroup(active, groupKeyByUser(ws));
        Map<Long, String> stages = revenueStagesFor(ws, active);
        return drafts.stream().map(d -> new DraftView(d.industry(), d.userIds(),
                d.userIds().stream().map(this::displayName).toList(),
                d.userIds().stream().map(stages::get).toList())).toList();
    }

    /**
     * Publishes pods (owner/admin). Body may carry manually adjusted drafts
     * (same shape as the preview); without overrides the preview grouping is
     * republished. Existing active pods are archived first. Every listed user
     * must be an active member of the workspace and not already in the batch.
     */
    public List<PodView> publish(List<PodDraft> overrideDrafts, String namePrefix) {
        Long ws = TenantContext.requireWorkspaceId();
        List<PodDraft> drafts = overrideDrafts == null || overrideDrafts.isEmpty()
                ? greedyGroup(activeMemberIds(ws), groupKeyByUser(ws))
                : overrideDrafts;

        // Validate the batch: members known & unique & in this workspace.
        // Membership is checked against active membership, not the industry
        // map — members who never set a profile are still valid pod members.
        Set<Long> active = new LinkedHashSet<>(activeMemberIds(ws));
        Set<Long> seen = new LinkedHashSet<>();
        for (PodDraft draft : drafts) {
            if (draft.userIds() == null || draft.userIds().size() < 2) {
                throw new BadRequestException("Each pod needs at least 2 members");
            }
            if (draft.industry() != null && draft.industry().length() > 80) {
                throw new BadRequestException("Pod industry is too long (max 80)");
            }
            for (Long userId : draft.userIds()) {
                if (userId == null) {
                    throw new BadRequestException("userIds must not contain nulls");
                }
                if (!active.contains(userId)) {
                    throw new NotFoundException("User " + userId
                            + " is not an active member of this workspace");
                }
                if (!seen.add(userId)) {
                    throw new ConflictException("User " + userId
                            + " appears in more than one pod");
                }
            }
        }
        if (drafts.isEmpty()) {
            throw new ConflictException("Nothing to publish: no pods in this generation");
        }
        String prefix = namePrefix == null || namePrefix.isBlank()
                ? "Pod" : namePrefix.trim();
        if (prefix.length() > MAX_POD_NAME_LENGTH - 10) {
            throw new BadRequestException("namePrefix is too long");
        }

        // Archive the previous generation so the roster reads one snapshot.
        pods.findByWorkspaceIdAndStatus(ws, Pod.Status.ACTIVE).forEach(pod -> {
            pod.setStatus(Pod.Status.ARCHIVED);
            pods.save(pod);
        });

        List<PodView> created = new ArrayList<>();
        int nth = 1;
        for (PodDraft draft : drafts) {
            Pod pod = new Pod();
            pod.setWorkspaceId(ws);
            pod.setName(prefix + " " + nth++);
            pod.setIndustry(draft.industry() == null || draft.industry().isBlank()
                    ? null : draft.industry().trim());
            pod.setStatus(Pod.Status.ACTIVE);
            pods.save(pod);
            for (Long userId : draft.userIds()) {
                PodMember pm = new PodMember();
                pm.setWorkspaceId(ws);
                pm.setPodId(pod.getId());
                pm.setUserId(userId);
                podMembers.save(pm);
            }
            created.add(toPodView(pod, null));
        }
        audit.record("CREATE", "pods", created.get(0).id(),
                Map.of("event", "pods_published", "count", drafts.size(),
                        "members", seen.size()));
        return created;
    }

    // ---------------------------------------------------------------- lookups

    /** Pods the caller can see: admins all active pods, members their own. */
    public List<PodView> myPods() {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        List<Pod> visible;
        if (privileged()) {
            visible = pods.findByWorkspaceIdAndStatus(ws, Pod.Status.ACTIVE);
        } else {
            visible = podMembers.findByWorkspaceIdAndUserId(ws, userId).stream()
                    .map(PodMember::getPodId)
                    .map(pods::findById)
                    .flatMap(java.util.Optional::stream)
                    .filter(p -> p.getStatus() == Pod.Status.ACTIVE)
                    .toList();
        }
        return visible.stream().map(p -> toPodView(p, streaksFor(p, ws))).toList();
    }

    /** One pod's detail (members with streaks); pod members plus admins. */
    public PodView pod(Long podId) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        Pod pod = requireVisiblePod(ws, podId, userId);
        return toPodView(pod, streaksFor(pod, ws));
    }

    // --------------------------------------------------------------- checkins

    /** Files this week's check-in for the caller in one of their pods. One per week. */
    public CheckinView checkin(Long podId, CheckinRequest request) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        Pod pod = pods.findById(podId)
                .orElseThrow(() -> new NotFoundException("No pod " + podId));
        if (!Objects.equals(ws, pod.getWorkspaceId()) || pod.getStatus() != Pod.Status.ACTIVE) {
            throw new NotFoundException("No pod " + podId);
        }
        if (podMembers.findFirstByWorkspaceIdAndPodIdAndUserId(ws, podId, userId).isEmpty()) {
            throw new ForbiddenException("Only pod members can check in");
        }
        if (request.wins() == null || request.wins().isBlank()) {
            throw new BadRequestException("wins is required");
        }
        if (request.blockers() == null || request.blockers().isBlank()) {
            throw new BadRequestException("blockers is required");
        }
        for (String field : new String[] {request.wins(), request.blockers(),
                request.ask() == null ? "" : request.ask()}) {
            if (field.length() > MAX_TEXT_LENGTH) {
                throw new BadRequestException(
                        "check-in fields max " + MAX_TEXT_LENGTH + " chars");
            }
        }
        LocalDate weekStart = request.weekStart() == null
                ? LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                : request.weekStart().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        if (checkins.findFirstByWorkspaceIdAndPodIdAndUserIdAndWeekStart(
                ws, podId, userId, weekStart).isPresent()) {
            throw new ConflictException("This week's check-in already exists");
        }
        PodCheckin checkin = new PodCheckin();
        checkin.setWorkspaceId(ws);
        checkin.setPodId(podId);
        checkin.setUserId(userId);
        checkin.setWeekStart(weekStart);
        checkin.setWins(request.wins().trim());
        checkin.setBlockers(request.blockers().trim());
        checkin.setAsk(request.ask() == null || request.ask().isBlank()
                ? null : request.ask().trim());
        checkins.save(checkin);
        audit.record("CREATE", "pod_checkin", checkin.getId(),
                Map.of("podId", podId, "weekStart", weekStart.toString(),
                        "memberWeeks", checkins.findByWorkspaceIdAndPodIdOrderByWeekStartDescIdDesc(
                                ws, podId).stream()
                                .filter(c -> c.getUserId().equals(userId)).count()));
        return toCheckinView(checkin);
    }

    /** The pod's recent check-ins (pod members and admins), newest week first. */
    public List<CheckinView> recentCheckins(Long podId) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        requireVisiblePod(ws, podId, userId);
        return checkins.findByWorkspaceIdAndPodIdOrderByWeekStartDescIdDesc(ws, podId)
                .stream().limit(20).map(this::toCheckinView).toList();
    }

    // ---------------------------------------------------------------- thread

    /** The pod's private thread, oldest first (members + admins), capped. */
    public List<MessageView> messages(Long podId) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        requireVisiblePod(ws, podId, userId);
        return podMessages.findByWorkspaceIdAndPodIdOrderByCreatedAtAscIdAsc(ws, podId)
                .stream().limit(MAX_THREAD_MESSAGES).map(this::toMessageView).toList();
    }

    /** Posts to the pod's private thread (members + admins). */
    public MessageView postMessage(Long podId, MessageRequest request) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        requireVisiblePod(ws, podId, userId);
        if (request == null || request.body() == null || request.body().isBlank()) {
            throw new BadRequestException("body is required");
        }
        String body = request.body().trim();
        if (body.length() > MAX_TEXT_LENGTH) {
            throw new BadRequestException("body max " + MAX_TEXT_LENGTH + " chars");
        }
        PodMessage message = new PodMessage();
        message.setWorkspaceId(ws);
        message.setPodId(podId);
        message.setUserId(userId);
        message.setBody(body);
        podMessages.save(message);
        audit.record("CREATE", "pod_message", message.getId(),
                Map.of("podId", podId, "length", body.length()));
        return toMessageView(message);
    }

    // ---------------------------------------------------------------- helpers

    private Pod requireVisiblePod(Long ws, Long podId, Long userId) {
        Pod pod = pods.findById(podId)
                .orElseThrow(() -> new NotFoundException("No pod " + podId));
        if (!Objects.equals(ws, pod.getWorkspaceId())) {
            throw new NotFoundException("No pod " + podId);
        }
        if (!privileged() && podMembers
                .findFirstByWorkspaceIdAndPodIdAndUserId(ws, podId, userId).isEmpty()) {
            throw new ForbiddenException("This pod is private to its members");
        }
        return pod;
    }

    /**
     * Greedy grouping that balances by revenue stage as well as industry:
     * members are sorted industry-major, then by revenue stage within the
     * industry (unknowns last), cut into whole cohorts of one group key
     * ("industry\u0001stage"), and the cohorts are packed into pods of 2-8.
     * A cohort is only ever split when it alone exceeds {@link #MAX_POD_SIZE},
     * and then into near-equal parts using the same n/6 rounding the old
     * chunker used — so same-industry, same-stage members sit together
     * instead of being sliced at arbitrary cursor positions. A pod is never
     * closed at a single member (publish refuses pods below 2), even if that
     * means overshooting the soft cap by one small cohort.
     *
     * <p>Deterministic given the same membership: fixed sort, fixed cohort
     * order, fixed first-fit order — so "publish" without overrides writes
     * exactly what the preview showed.
     */
    static List<PodDraft> greedyGroup(List<Long> activeMembers,
                                      Map<Long, String> groupKeyByUser) {
        List<Long> sorted = new ArrayList<>(activeMembers);
        sorted.sort(Comparator
                .comparing((Long id) -> groupKeyByUser.getOrDefault(id, "general"))
                .thenComparing(id -> id));
        if (sorted.size() < 2) {
            return List.of(); // the caller refuses earlier for tiny pools
        }

        // Whole cohorts: maximal runs sharing one group key.
        List<List<Long>> cohorts = new ArrayList<>();
        List<Long> run = new ArrayList<>();
        String runKey = null;
        for (Long id : sorted) {
            String key = groupKeyByUser.getOrDefault(id, "general");
            if (runKey != null && !key.equals(runKey)) {
                cohorts.add(run);
                run = new ArrayList<>();
            }
            runKey = key;
            run.add(id);
        }
        if (!run.isEmpty()) {
            cohorts.add(run);
        }

        // Split only oversized cohorts, into near-equal parts (n/6 rounding).
        List<List<Long>> pieces = new ArrayList<>();
        for (List<Long> cohort : cohorts) {
            if (cohort.size() <= MAX_POD_SIZE) {
                pieces.add(cohort);
                continue;
            }
            int parts = Math.max(2, (int) Math.round(cohort.size() / 6.0));
            int base = cohort.size() / parts;
            int remainder = cohort.size() % parts;
            int at = 0;
            for (int p = 0; p < parts; p++) {
                int size = base + (p < remainder ? 1 : 0);
                pieces.add(new ArrayList<>(cohort.subList(at, at + size)));
                at += size;
            }
        }

        // First-fit packing of whole pieces, in order.
        List<List<Long>> pods = new ArrayList<>();
        List<Long> pod = new ArrayList<>();
        for (List<Long> piece : pieces) {
            if (pod.isEmpty() || pod.size() + piece.size() <= MAX_POD_SIZE) {
                pod.addAll(piece);
            } else if (pod.size() < 2) {
                // Never emit a 1-member pod: overshoot the soft cap instead.
                pod.addAll(piece);
            } else {
                pods.add(pod);
                pod = new ArrayList<>(piece);
            }
        }
        if (!pod.isEmpty()) {
            if (!pods.isEmpty() && pod.size() < 2) {
                // Trailing single member joins the previous pod.
                pods.get(pods.size() - 1).addAll(pod);
            } else {
                pods.add(pod);
            }
        }

        List<PodDraft> drafts = new ArrayList<>();
        for (List<Long> members : pods) {
            drafts.add(new PodDraft(labelFor(members, groupKeyByUser), members));
        }
        return drafts;
    }

    /** Dominant group key wins the label; ties break on key asc. */
    private static String labelFor(List<Long> members,
                                   Map<Long, String> groupKeyByUser) {
        Map<String, Long> counts = members.stream()
                .map(id -> groupKeyByUser.getOrDefault(id, "general"))
                .collect(Collectors.groupingBy(s -> s, Collectors.counting()));
        String top = counts.entrySet().stream()
                .max(Comparator.comparing((Map.Entry<String, Long> e) -> e.getValue())
                        .thenComparing(Map.Entry::getKey))
                .map(Map.Entry::getKey)
                .orElse("general");
        return displayLabel(top) + (counts.size() > 1 ? " (mixed)" : "");
    }

    private List<Long> activeMemberIds(Long ws) {
        return memberships.findAll().stream()
                .filter(m -> Objects.equals(ws, m.getWorkspaceId()))
                .map(m -> m.getUserId())
                .sorted()
                .toList();
    }

    private Map<Long, String> groupKeyByUser(Long ws) {
        Map<Long, String> map = new TreeMap<>();
        for (MemberProfile profile : memberProfiles.findByWorkspaceIdAndUserIdIn(ws,
                activeMemberIds(ws))) {
            String industry = profile.getIndustry() == null || profile.getIndustry().isBlank()
                    ? "general" : profile.getIndustry().trim();
            String stage = profile.getRevenueStage() == null
                    || profile.getRevenueStage().isBlank()
                            ? null : profile.getRevenueStage().trim();
            if (profile.getIndustry() == null && stage == null) {
                continue; // neither dimension set: keep the "general" default
            }
            map.put(profile.getUserId(), stage == null ? industry : industry + GROUP_SEP + stage);
        }
        return map;
    }

    /** Revenue stage per member (trimmed, blank/absent → null) for composition. */
    private Map<Long, String> revenueStagesFor(Long ws, List<Long> userIds) {
        Map<Long, String> map = new TreeMap<>();
        for (MemberProfile profile : memberProfiles.findByWorkspaceIdAndUserIdIn(ws,
                userIds)) {
            String stage = profile.getRevenueStage();
            if (stage != null && !stage.isBlank()) {
                map.put(profile.getUserId(), stage.trim());
            }
        }
        return map;
    }

    /** "Fintech\u0001Seed" → "Fintech · Seed"; bare keys pass through. */
    static String displayLabel(String groupKey) {
        if (groupKey.indexOf(GROUP_SEP) < 0) {
            return groupKey;
        }
        String[] parts = groupKey.split(String.valueOf(GROUP_SEP));
        StringBuilder out = new StringBuilder();
        for (String part : parts) {
            if (part.isBlank()) {
                continue;
            }
            if (out.length() > 0) {
                out.append(" · ");
            }
            out.append(part.trim());
        }
        return out.length() == 0 ? "general" : out.toString();
    }

    private boolean privileged() {
        WorkspaceRole role = TenantContext.role();
        return role == WorkspaceRole.OWNER || role == WorkspaceRole.ADMIN;
    }

    /** Per-member attendance streak: consecutive check-in weeks counting down. */
    private Map<Long, Integer> streaksFor(Pod pod, Long ws) {
        List<PodCheckin> rows = checkins.findByWorkspaceIdAndPodIdOrderByWeekStartDescIdDesc(
                ws, pod.getId());
        Map<Long, List<LocalDate>> weeksByUser = new TreeMap<>();
        for (PodCheckin row : rows) {
            weeksByUser.computeIfAbsent(row.getUserId(), k -> new ArrayList<>())
                    .add(row.getWeekStart());
        }
        Map<Long, Integer> byUser = new LinkedHashMap<>();
        weeksByUser.forEach((uid, weeks) -> byUser.put(uid, streak(weeks)));
        return byUser;
    }

    /** Consecutive Mondays ending at the member's most recent check-in. */
    static int streak(List<LocalDate> weeks) {
        if (weeks.isEmpty()) {
            return 0;
        }
        List<LocalDate> sorted = weeks.stream().distinct()
                .sorted(Comparator.reverseOrder()).toList();
        int streak = 1;
        LocalDate cursor = sorted.get(0);
        for (int i = 1; i < sorted.size(); i++) {
            LocalDate nextWeek = sorted.get(i);
            if (nextWeek.equals(cursor.minusWeeks(1))) {
                streak += 1;
                cursor = nextWeek;
            } else {
                break;
            }
        }
        return streak;
    }

    private static Long requireActor() {
        Long userId = TenantContext.actorUserId();
        if (userId == null) {
            throw new UnauthorizedException("Not authenticated");
        }
        return userId;
    }

    private String displayName(Long userId) {
        return users.findById(userId).map(User::getDisplayName).orElse(null);
    }

    private PodView toPodView(Pod pod, Map<Long, Integer> streaks) {
        List<PodMember> rows = podMembers.findByWorkspaceIdAndPodId(
                pod.getWorkspaceId(), pod.getId());
        Map<Long, String> stages = revenueStagesFor(pod.getWorkspaceId(),
                rows.stream().map(PodMember::getUserId).toList());
        List<MemberLine> members = rows.stream()
                .map(pm -> new MemberLine(pm.getUserId(),
                        displayName(pm.getUserId()),
                        streaks == null ? Integer.valueOf(0)
                                : streaks.getOrDefault(pm.getUserId(), 0),
                        stages.get(pm.getUserId())))
                .toList();
        return new PodView(pod.getId(), pod.getName(), pod.getIndustry(), members);
    }

    private CheckinView toCheckinView(PodCheckin checkin) {
        return new CheckinView(checkin.getId(), checkin.getPodId(), checkin.getUserId(),
                displayName(checkin.getUserId()), checkin.getWeekStart(),
                checkin.getWins(), checkin.getBlockers(), checkin.getAsk());
    }

    private MessageView toMessageView(PodMessage message) {
        return new MessageView(message.getId(), message.getPodId(), message.getUserId(),
                displayName(message.getUserId()), message.getBody(), message.getCreatedAt());
    }
}
