package com.coeso.roster.workspace;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.auth.CurrentUser;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.Plan;
import com.coeso.roster.entity.Subscription;
import com.coeso.roster.entity.SubscriptionStatus;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.entity.WorkspaceStatus;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.PlanRepository;
import com.coeso.roster.repo.Repositories.SubscriptionRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Workspace lifecycle. Creating a workspace makes the caller the owner, seeds
 * the default lookups (Java replacement for the stored procedure) and starts a
 * trialing subscription on the free plan. Workspaces are soft-deleted
 * (status = DELETED); the purge job removes children later.
 */
@Service
public class WorkspaceService {

    public record CreateWorkspaceRequest(String name, String slug) {
    }

    public record WorkspaceResponse(Long id, String name, String slug, WorkspaceRole role) {
    }

    /** White-label settings: rendered as a CSS variable + header logo. */
    public record BrandingRequest(String logoUrl, String accentColor, String customDomain) {
    }

    public record BrandingResponse(String logoUrl, String accentColor, String customDomain) {
    }

    /** Phase 7 workspace knobs (leaderboard privacy). */
    public record SettingsRequest(Boolean leaderboardShowNames) {
    }

    public record SettingsResponse(boolean leaderboardShowNames) {
    }

    private static final int TRIAL_DAYS = 14;

    private final WorkspaceRepository workspaces;
    private final PlanRepository plans;
    private final MembershipRepository memberships;
    private final SubscriptionRepository subscriptions;
    private final DefaultSeedService defaultSeedService;
    private final MembershipService membershipService;
    private final AuditService auditService;

    public WorkspaceService(WorkspaceRepository workspaces, PlanRepository plans,
                            MembershipRepository memberships, SubscriptionRepository subscriptions,
                            DefaultSeedService defaultSeedService,
                            MembershipService membershipService, AuditService auditService) {
        this.workspaces = workspaces;
        this.plans = plans;
        this.memberships = memberships;
        this.subscriptions = subscriptions;
        this.defaultSeedService = defaultSeedService;
        this.membershipService = membershipService;
        this.auditService = auditService;
    }

    public WorkspaceResponse create(CreateWorkspaceRequest request) {
        Long userId = CurrentUser.id();
        String name = request.name() == null ? "" : request.name().trim();
        if (name.isEmpty()) {
            throw new BadRequestException("Workspace name is required");
        }
        String slug = (request.slug() == null || request.slug().isBlank())
                ? Slugs.slugify(name)
                : request.slug().trim().toLowerCase();
        if (slug.isEmpty()) {
            throw new BadRequestException("Could not derive a slug from the name; provide a slug");
        }
        Slugs.validate(slug);
        if (workspaces.findBySlug(slug).isPresent()) {
            throw new ConflictException("Workspace slug '" + slug + "' is already taken");
        }

        Plan freePlan = plans.findByCode("free")
                .orElseThrow(() -> new IllegalStateException("Free plan is missing from seed data"));

        Workspace workspace = new Workspace();
        workspace.setName(name);
        workspace.setSlug(slug);
        workspace.setPlan(freePlan);
        workspace.setStatus(WorkspaceStatus.ACTIVE);
        workspaces.save(workspace);

        // Activate the tenant context before any further work so the default
        // seed and the audit row run with the filter enabled.
        TenantContext.set(workspace.getId(), WorkspaceRole.OWNER, userId);

        Membership owner = new Membership();
        owner.setWorkspaceId(workspace.getId());
        owner.setUserId(userId);
        owner.setRole(WorkspaceRole.OWNER);
        memberships.save(owner);

        defaultSeedService.seed(workspace.getId());

        Subscription subscription = new Subscription();
        subscription.setWorkspaceId(workspace.getId());
        subscription.setPlanId(freePlan.getId());
        subscription.setStatus(SubscriptionStatus.TRIALING);
        subscription.setTrialEndsAt(LocalDateTime.now().plusDays(TRIAL_DAYS));
        subscriptions.save(subscription);

        auditService.record(AuditLog.ACTION_CREATE, "workspace", workspace.getId(),
                Map.of("slug", slug, "name", name, "plan", freePlan.getCode()));

        return new WorkspaceResponse(workspace.getId(), workspace.getName(), workspace.getSlug(),
                WorkspaceRole.OWNER);
    }

    public List<MembershipService.WorkspaceSummary> list() {
        return membershipService.listMine(CurrentUser.id());
    }

    // -------------------------------------------------------------- branding

    /** Read is open to every member (the shell renders the accent color). */
    public BrandingResponse branding() {
        Workspace workspace = workspaces.findById(TenantContext.requireWorkspaceId())
                .orElseThrow(() -> new NotFoundException("Workspace not found"));
        return new BrandingResponse(workspace.getLogoUrl(), workspace.getAccentColor(),
                workspace.getCustomDomain());
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public BrandingResponse updateBranding(BrandingRequest request) {
        Workspace workspace = workspaces.findById(TenantContext.requireWorkspaceId())
                .orElseThrow(() -> new NotFoundException("Workspace not found"));
        String logoUrl = blankToNull(request.logoUrl());
        String accentColor = blankToNull(request.accentColor());
        String customDomain = blankToNull(request.customDomain());
        if (logoUrl != null && logoUrl.length() > 500) {
            throw new BadRequestException("logoUrl must be at most 500 characters");
        }
        if (accentColor != null && !accentColor.matches("#[0-9a-fA-F]{6}")) {
            throw new BadRequestException("accentColor must be a hex color like #cda35a");
        }
        if (customDomain != null && !customDomain.matches("[a-z0-9.-]{4,255}")) {
            throw new BadRequestException("customDomain must be a hostname like roster.example.com");
        }
        workspace.setLogoUrl(logoUrl);
        workspace.setAccentColor(accentColor == null ? null : accentColor.toLowerCase());
        workspace.setCustomDomain(customDomain);
        workspaces.save(workspace);
        auditService.record(AuditLog.ACTION_UPDATE, "workspace", workspace.getId(),
                Map.of("branding", true,
                        "logoUrl", logoUrl == null ? "" : logoUrl,
                        "accentColor", accentColor == null ? "" : accentColor,
                        "customDomain", customDomain == null ? "" : customDomain));
        return new BrandingResponse(workspace.getLogoUrl(), workspace.getAccentColor(),
                workspace.getCustomDomain());
    }

    private static String blankToNull(String raw) {
        return raw == null || raw.isBlank() ? null : raw.trim();
    }

    // ------------------------------------------------------------- settings

    /** Read is open to every member (the leaderboard renders for reps too). */
    public SettingsResponse settings() {
        Workspace workspace = workspaces.findById(TenantContext.requireWorkspaceId())
                .orElseThrow(() -> new NotFoundException("Workspace not found"));
        return new SettingsResponse(workspace.isLeaderboardShowNames());
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public SettingsResponse updateSettings(SettingsRequest request) {
        Workspace workspace = workspaces.findById(TenantContext.requireWorkspaceId())
                .orElseThrow(() -> new NotFoundException("Workspace not found"));
        boolean showNames = Boolean.TRUE.equals(request.leaderboardShowNames());
        workspace.setLeaderboardShowNames(showNames);
        workspaces.save(workspace);
        auditService.record(AuditLog.ACTION_UPDATE, "workspace", workspace.getId(),
                Map.of("settings", "leaderboard", "leaderboardShowNames", showNames));
        return new SettingsResponse(showNames);
    }

    @PreAuthorize("@roles.hasAtLeast('OWNER')")
    public void delete(Long id) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        if (!workspaceId.equals(id)) {
            throw new NotFoundException("Workspace " + id + " not found");
        }
        Workspace workspace = workspaces.findById(workspaceId)
                .orElseThrow(() -> new NotFoundException("Workspace " + id + " not found"));
        if (workspace.getStatus() == WorkspaceStatus.DELETED) {
            throw new ConflictException("Workspace is already deleted");
        }
        workspace.setStatus(WorkspaceStatus.DELETED);
        workspaces.save(workspace);
        auditService.record(AuditLog.ACTION_DELETE, "workspace", workspace.getId(),
                Map.of("slug", workspace.getSlug()));
    }
}
