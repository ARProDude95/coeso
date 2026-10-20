package com.coeso.roster.intros;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ForbiddenException;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.UnauthorizedException;
import com.coeso.roster.discord.DiscordNotifier;
import com.coeso.roster.entity.IntroRequest;
import com.coeso.roster.entity.MemberProfile;
import com.coeso.roster.entity.User;
import com.coeso.roster.repo.Repositories.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;

/**
 * Smart intros: matches members whose "looking for" tags overlap another's
 * "offering" tags within this workspace, shows up to 5 suggestions each with
 * a one-line reason, and gates contact behind an accepted intro request
 * (max 3 pending per member). "Request intro" notifies the other member via
 * the existing Discord notifier; contact (email) is revealed only on
 * acceptance.
 */
@Service
public class IntrosService {

    public record ProfileRequest(List<String> offeringTags, List<String> lookingForTags,
                                 String industry, String revenueStage) {
    }

    public record ProfileView(Long userId, String displayName, List<String> offeringTags,
                              List<String> lookingForTags, String industry,
                              String revenueStage) {
    }

    /** One suggestion row: partner plus the why. */
    public record Suggestion(Long userId, String displayName, String reason,
                             int percent, boolean pendingWithYou) {
    }

    public record RequestView(Long id, Long fromUserId, String fromName, Long toUserId,
                              String toName, String status, String reason,
                              String contactEmail, java.time.LocalDateTime createdAt) {
    }

    private static final int MAX_PENDING_REQUESTS = 3;
    private static final int MAX_SUGGESTIONS = 5;

    private final IntrosRepos.MemberProfileRepository profiles;
    private final IntrosRepos.IntroRequestRepository requests;
    private final UserRepository users;
    private final DiscordNotifier notifier;
    private final ObjectMapper objectMapper;
    private final AuditService audit;

    public IntrosService(IntrosRepos.MemberProfileRepository profiles,
                         IntrosRepos.IntroRequestRepository requests,
                         UserRepository users,
                         DiscordNotifier notifier,
                         ObjectMapper objectMapper,
                         AuditService audit) {
        this.profiles = profiles;
        this.requests = requests;
        this.users = users;
        this.notifier = notifier;
        this.objectMapper = objectMapper;
        this.audit = audit;
    }

    // -------------------------------------------------------------- profiles

    public ProfileView myProfile() {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        MemberProfile profile = profiles.findByWorkspaceIdAndUserId(ws, userId)
                .orElse(null);
        return profile == null
                ? new ProfileView(userId, displayName(userId), List.of(), List.of(), null, null)
                : toProfileView(profile);
    }

    public ProfileView upsertProfile(ProfileRequest request) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        List<String> offering = cleanTags(request.offeringTags());
        List<String> lookingFor = cleanTags(request.lookingForTags());
        if (offering.isEmpty() && lookingFor.isEmpty()) {
            throw new BadRequestException(
                    "At least one offering or looking-for tag is required");
        }
        String industry = request.industry() == null ? null
                : request.industry().trim().isEmpty() ? null
                        : request.industry().trim();
        if (industry != null && industry.length() > 80) {
            throw new BadRequestException("industry is too long (max 80 chars)");
        }
        String revenueStage = request.revenueStage() == null ? null
                : request.revenueStage().trim().isEmpty() ? null
                        : request.revenueStage().trim();
        if (revenueStage != null && revenueStage.length() > 40) {
            throw new BadRequestException("revenueStage is too long (max 40 chars)");
        }

        MemberProfile profile = profiles.findByWorkspaceIdAndUserId(ws, userId)
                .orElseGet(() -> {
                    MemberProfile fresh = new MemberProfile();
                    fresh.setWorkspaceId(ws);
                    fresh.setUserId(userId);
                    return fresh;
                });
        profile.setOfferingTags(toJson(offering));
        profile.setLookingForTags(toJson(lookingFor));
        profile.setIndustry(industry);
        profile.setRevenueStage(revenueStage);
        profiles.save(profile);
        audit.record("UPDATE", "member_profile", profile.getId(),
                Map.of("event", "intros_profile_saved",
                        "offering", offering.size(), "lookingFor", lookingFor.size()));
        return toProfileView(profile);
    }

    // ------------------------------------------------------------ suggestions

    /** Up to 5 suggested partners for the caller, best match first. */
    public List<Suggestion> suggestions() {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        MemberProfile mine = profiles.findByWorkspaceIdAndUserId(ws, userId).orElse(null);
        if (mine == null) {
            return List.of(); // no profile yet: the page prompts to fill it in
        }
        List<MemberProfile> candidates = profiles.findByWorkspaceId(ws).stream()
                .filter(p -> !p.getUserId().equals(userId))
                .toList();

        // A pending request already aimed at a candidate shows as such.
        List<Long> pendingTargets = requests.findByWorkspaceIdAndFromUserId(ws, userId)
                .stream()
                .filter(r -> r.getStatus() == IntroRequest.Status.PENDING)
                .map(IntroRequest::getToUserId)
                .toList();

        IntrosScorer.ProfileView mineView = view(mine);
        List<Suggestion> out = new ArrayList<>();
        for (MemberProfile candidate : candidates) {
            IntrosScorer.Result result = IntrosScorer.score(mineView, view(candidate));
            if (result == null) {
                continue;
            }
            out.add(new Suggestion(candidate.getUserId(),
                    displayName(candidate.getUserId()), result.reason(),
                    result.percent(), pendingTargets.contains(candidate.getUserId())));
        }
        return out.stream()
                .sorted(Comparator.comparingInt(Suggestion::percent).reversed())
                .limit(MAX_SUGGESTIONS)
                .toList();
    }

    // --------------------------------------------------------------- requests

    /** Asks for an intro. Max 3 pending per member; duplicates collapsed. */
    public RequestView requestIntro(Long targetUserId, String reason) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        if (Objects.equals(userId, targetUserId)) {
            throw new BadRequestException("You cannot request an intro to yourself");
        }
        if (profiles.findByWorkspaceIdAndUserId(ws, targetUserId).isEmpty()) {
            throw new NotFoundException("That member has no intros profile in this space");
        }
        if (reason != null && reason.length() > 255) {
            throw new BadRequestException("reason is too long (max 255 chars)");
        }

        boolean duplicate = requests.findByWorkspaceIdAndFromUserId(ws, userId).stream()
                .filter(r -> r.getStatus() == IntroRequest.Status.PENDING)
                .anyMatch(r -> r.getToUserId().equals(targetUserId));
        if (duplicate) {
            throw new ConflictException("An intro request to this member is already pending");
        }
        long pending = requests.countByWorkspaceIdAndFromUserIdAndStatus(
                ws, userId, IntroRequest.Status.PENDING);
        if (pending >= MAX_PENDING_REQUESTS) {
            throw new ConflictException("You already have " + MAX_PENDING_REQUESTS
                    + " pending intro requests; wait for a reply or withdraw one first");
        }

        IntroRequest request = new IntroRequest();
        request.setWorkspaceId(ws);
        request.setFromUserId(userId);
        request.setToUserId(targetUserId);
        request.setStatus(IntroRequest.Status.PENDING);
        request.setReason(reason == null || reason.isBlank() ? null : reason.trim());
        requests.save(request);
        audit.record("CREATE", "intro_request", request.getId(),
                Map.of("event", "intro_requested", "toUserId", targetUserId));
        notifier.introRequested(ws, displayOr(userId, "A member"),
                displayName(targetUserId));
        return toRequestView(request, ws);
    }

    /** Incoming requests for the caller (what to accept/decline). */
    public List<RequestView> incoming() {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        return requests.findByWorkspaceIdAndToUserId(ws, userId).stream()
                .sorted(Comparator.comparing(IntroRequest::getId).reversed())
                .map(r -> toRequestView(r, ws))
                .toList();
    }

    /** Outgoing requests for the caller. */
    public List<RequestView> outgoing() {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        return requests.findByWorkspaceIdAndFromUserId(ws, userId).stream()
                .sorted(Comparator.comparing(IntroRequest::getId).reversed())
                .map(r -> toRequestView(r, ws))
                .toList();
    }

    /** Target accepts: the contact email is now revealed to the requester. */
    public RequestView accept(Long requestId) {
        return decide(requestId, IntroRequest.Status.ACCEPTED);
    }

    /** Target declines: no contact is revealed; the request just settles. */
    public RequestView decline(Long requestId) {
        return decide(requestId, IntroRequest.Status.DECLINED);
    }

    private RequestView decide(Long requestId, IntroRequest.Status decision) {
        Long ws = TenantContext.requireWorkspaceId();
        Long userId = requireActor();
        IntroRequest request = requests.findById(requestId)
                .orElseThrow(() -> new NotFoundException("No intro request " + requestId));
        if (!Objects.equals(ws, request.getWorkspaceId())) {
            throw new NotFoundException("No intro request " + requestId);
        }
        if (!request.getToUserId().equals(userId)) {
            throw new ForbiddenException("Only the recipient can respond to this request");
        }
        if (request.getStatus() != IntroRequest.Status.PENDING) {
            throw new ConflictException("This request was already " + request.getStatus()
                    .name().toLowerCase());
        }
        request.setStatus(decision);
        if (decision == IntroRequest.Status.ACCEPTED) {
            request.setContactedAt(java.time.LocalDateTime.now());
        }
        requests.save(request);
        audit.record("UPDATE", "intro_request", request.getId(),
                Map.of("event", "intro_" + decision.name().toLowerCase()));
        if (decision == IntroRequest.Status.ACCEPTED) {
            notifier.introAccepted(ws, displayName(userId), displayName(request.getFromUserId()));
        }
        return toRequestView(request, ws);
    }

    // ---------------------------------------------------------------- helpers

    private static Long requireActor() {
        Long userId = TenantContext.actorUserId();
        if (userId == null) {
            throw new UnauthorizedException("Not authenticated");
        }
        return userId;
    }

    private static List<String> cleanTags(List<String> tags) {
        if (tags == null) {
            return List.of();
        }
        return tags.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(t -> !t.isEmpty())
                .map(t -> t.length() > 40 ? t.substring(0, 40) : t)
                .distinct()
                .limit(10)
                .toList();
    }

    private String toJson(List<String> tags) {
        try {
            return objectMapper.writeValueAsString(tags);
        } catch (Exception e) {
            return "[]";
        }
    }

    private IntrosScorer.ProfileView view(MemberProfile profile) {
        return new IntrosScorer.ProfileView(profile.getUserId(), profile.getOfferingTags(),
                profile.getLookingForTags(), profile.getIndustry());
    }

    private ProfileView toProfileView(MemberProfile profile) {
        return new ProfileView(profile.getUserId(), displayName(profile.getUserId()),
                readTags(profile.getOfferingTags()), readTags(profile.getLookingForTags()),
                profile.getIndustry(), profile.getRevenueStage());
    }

    private List<String> readTags(String json) {
        try {
            return objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (Exception e) {
            return List.of();
        }
    }

    private RequestView toRequestView(IntroRequest request, Long ws) {
        Long me = TenantContext.actorUserId();
        boolean revealContact = request.getStatus() == IntroRequest.Status.ACCEPTED
                && me != null && (request.getFromUserId().equals(me)
                        || request.getToUserId().equals(me));
        String contact = revealContact ? emailOf(request.getToUserId()) : null;
        return new RequestView(request.getId(), request.getFromUserId(),
                displayName(request.getFromUserId()), request.getToUserId(),
                displayName(request.getToUserId()), request.getStatus().name().toLowerCase(),
                request.getReason(), contact, request.getCreatedAt());
    }

    private String displayName(Long userId) {
        return users.findById(userId).map(User::getDisplayName).orElse(null);
    }

    private String displayOr(Long userId, String fallback) {
        String name = displayName(userId);
        return name == null || name.isBlank() ? fallback : name;
    }

    private String emailOf(Long userId) {
        return users.findById(userId).map(User::getEmail).orElse(null);
    }
}
