package com.coeso.roster.workspace;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.auth.CurrentUser;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.Invite;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.User;
import com.coeso.roster.plan.PlanLimitService;
import com.coeso.roster.repo.Repositories.InviteRepository;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.UserRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Workspace invites. Only the SHA-256 hash of the token is persisted; the raw
 * token exists solely in the one-time link handed back at creation time (no
 * email provider yet, so the admin copies it). Accepting is a single-use,
 * expiring, revocable operation that creates the membership.
 *
 * <p>{@link #preview} and {@link #accept} deliberately run WITHOUT the tenant
 * filter: the acceptor is not a member yet. The workspace is taken from the
 * invite row that the (unguessable) token hash resolves to — never from the
 * request.
 */
@Service
public class InviteService {

    public record InviteRequest(String email, WorkspaceRole role, Integer days) {
    }

    public record InviteResponse(Long id, String email, String role, String status,
                                 LocalDateTime expiresAt, LocalDateTime acceptedAt,
                                 LocalDateTime revokedAt) {
    }

    public record CreatedInvite(Long id, String email, String role, String token,
                                String link, LocalDateTime expiresAt) {
    }

    public record InvitePreview(String workspaceName, String email, String role,
                                String status, LocalDateTime expiresAt) {
    }

    public record AcceptResult(Long workspaceId, String workspaceName, String role) {
    }

    private static final int DEFAULT_TTL_DAYS = 14;
    private static final int MAX_TTL_DAYS = 60;

    private final InviteRepository invites;
    private final MembershipRepository memberships;
    private final UserRepository users;
    private final WorkspaceRepository workspaces;
    private final PlanLimitService planLimits;
    private final AuditService auditService;
    private final String appBaseUrl;

    public InviteService(InviteRepository invites, MembershipRepository memberships,
                         UserRepository users, WorkspaceRepository workspaces,
                         PlanLimitService planLimits, AuditService auditService,
                         @Value("${app.base-url:http://localhost:5173}") String appBaseUrl) {
        this.invites = invites;
        this.memberships = memberships;
        this.users = users;
        this.workspaces = workspaces;
        this.planLimits = planLimits;
        this.auditService = auditService;
        this.appBaseUrl = appBaseUrl;
    }

    // ----------------------------------------------------------------- create

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public CreatedInvite create(InviteRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        if (request.email() == null || request.email().isBlank()) {
            throw new BadRequestException("Invite email is required");
        }
        String email = request.email().trim().toLowerCase();
        if (request.role() == null) {
            throw new BadRequestException("Invite role is required");
        }
        if (request.role() == WorkspaceRole.OWNER) {
            // Ownership is transferred explicitly, never via an invite link.
            throw new BadRequestException("Invites cannot grant the owner role");
        }
        int days = request.days() == null ? DEFAULT_TTL_DAYS : request.days();
        if (days < 1 || days > MAX_TTL_DAYS) {
            throw new BadRequestException("Invite must expire between 1 and " + MAX_TTL_DAYS
                    + " days from now");
        }

        // A pending, unexpired invite for the same email is refreshed rather
        // than duplicated; the old token becomes invalid because the row is
        // replaced (one row per (workspace, email) pending invite).
        invites.findByWorkspaceId(workspaceId).stream()
                .filter(i -> i.getEmail().equals(email) && isPending(i))
                .forEach(i -> invites.delete(i));

        String token = UUID.randomUUID().toString().replace("-", "")
                + UUID.randomUUID().toString().replace("-", "");
        Invite invite = new Invite();
        invite.setWorkspaceId(workspaceId);
        invite.setEmail(email);
        invite.setRole(request.role());
        invite.setTokenHash(sha256(token));
        invite.setExpiresAt(LocalDateTime.now().plusDays(days));
        invite.setCreatedBy(TenantContext.actorUserId());
        invites.save(invite);

        String link = appBaseUrl + "/invite/" + token;
        auditService.record(AuditLog.ACTION_CREATE, "invite", invite.getId(),
                java.util.Map.of("email", email, "role", request.role().name()));
        return new CreatedInvite(invite.getId(), email, request.role().name(), token, link,
                invite.getExpiresAt());
    }

    // ------------------------------------------------------------------- list

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public List<InviteResponse> list() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        return invites.findByWorkspaceId(workspaceId).stream()
                .sorted((a, b) -> b.getId().compareTo(a.getId()))
                .map(i -> new InviteResponse(i.getId(), i.getEmail(), i.getRole().name(),
                        stateOf(i), i.getExpiresAt(), i.getAcceptedAt(), i.getRevokedAt()))
                .toList();
    }

    // ----------------------------------------------------------------- revoke

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public void revoke(Long id) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Invite invite = requireInWorkspace(id, workspaceId);
        if (!isPending(invite)) {
            throw new ConflictException("Invite is already " + stateOf(invite).toLowerCase());
        }
        invite.setRevokedAt(LocalDateTime.now());
        invites.save(invite);
        auditService.record(AuditLog.ACTION_UPDATE, "invite", invite.getId(),
                java.util.Map.of("email", invite.getEmail(), "status", "REVOKED"));
    }

    // ---------------------------------------------------------------- preview

    /** Unauthenticated-by-membership: shows what the link is for. */
    public InvitePreview preview(String token) {
        Invite invite = requireToken(token);
        return new InvitePreview(workspaceNameOf(invite.getWorkspaceId()), invite.getEmail(),
                invite.getRole().name(), stateOf(invite), invite.getExpiresAt());
    }

    // ------------------------------------------------------------------ accept

    /**
     * Accepts an invite as the authenticated caller. Membership-limit aware;
     * single use; runs without the tenant filter because the acceptor is not a
     * member yet (the workspace comes from the invite row).
     */
    public AcceptResult accept(String token) {
        Long userId = CurrentUser.id();
        Invite invite = requireToken(token);

        String state = stateOf(invite);
        if (!"PENDING".equals(state)) {
            throw new ConflictException("This invite is " + state.toLowerCase());
        }

        String userEmail = users.findById(userId)
                .map(User::getEmail)
                .orElse("")
                .toLowerCase();
        if (!userEmail.equals(invite.getEmail())) {
            throw new BadRequestException(
                    "This invite was issued to " + invite.getEmail()
                            + "; sign in with that account to accept it");
        }

        // Enforce max_members before creating the membership.
        long currentMembers = memberships.countByWorkspaceId(invite.getWorkspaceId());
        planLimits.assertCanAddMember(invite.getWorkspaceId(), currentMembers);

        if (memberships.findByUserIdAndWorkspaceId(userId, invite.getWorkspaceId()).isPresent()) {
            // Already a member: mark consumed so the link cannot be reused, but
            // do not create a duplicate membership.
            invite.setAcceptedAt(LocalDateTime.now());
            invite.setAcceptedBy(userId);
            invites.save(invite);
            return new AcceptResult(invite.getWorkspaceId(),
                    workspaceNameOf(invite.getWorkspaceId()), invite.getRole().name());
        }

        Membership membership = new Membership();
        membership.setWorkspaceId(invite.getWorkspaceId());
        membership.setUserId(userId);
        membership.setRole(invite.getRole());
        memberships.save(membership);

        invite.setAcceptedAt(LocalDateTime.now());
        invite.setAcceptedBy(userId);
        invites.save(invite);

        // Audit inside the caller's context is impossible here (no workspace
        // context yet), so record with the invite's workspace explicitly.
        TenantContext.set(invite.getWorkspaceId(), invite.getRole(), userId);
        try {
            auditService.record(AuditLog.ACTION_CREATE, "membership", membership.getId(),
                    java.util.Map.of("userId", userId, "role", invite.getRole().name(),
                            "via", "invite", "inviteId", invite.getId()));
        } finally {
            TenantContext.clear();
        }

        return new AcceptResult(invite.getWorkspaceId(),
                workspaceNameOf(invite.getWorkspaceId()), invite.getRole().name());
    }

    // ---------------------------------------------------------------- helpers

    private Invite requireToken(String token) {
        if (token == null || token.isBlank()) {
            throw new BadRequestException("Invite token is required");
        }
        return invites.findByTokenHash(sha256(token.trim()))
                .orElseThrow(() -> new NotFoundException("Invite not found or no longer valid"));
    }

    private Invite requireInWorkspace(Long id, Long workspaceId) {
        return invites.findByWorkspaceId(workspaceId).stream()
                .filter(i -> i.getId().equals(id))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Invite " + id + " not found"));
    }

    private static boolean isPending(Invite invite) {
        return invite.getAcceptedAt() == null
                && invite.getRevokedAt() == null
                && invite.getExpiresAt().isAfter(LocalDateTime.now());
    }

    private static String stateOf(Invite invite) {
        if (invite.getAcceptedAt() != null) {
            return "ACCEPTED";
        }
        if (invite.getRevokedAt() != null) {
            return "REVOKED";
        }
        if (!invite.getExpiresAt().isAfter(LocalDateTime.now())) {
            return "EXPIRED";
        }
        return "PENDING";
    }

    private String workspaceNameOf(Long workspaceId) {
        return workspaces.findById(workspaceId)
                .map(com.coeso.roster.entity.Workspace::getName)
                .orElse("(deleted workspace)");
    }

    static String sha256(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
