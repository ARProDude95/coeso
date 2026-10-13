package com.coeso.roster.billing;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.BillingEvent;
import com.coeso.roster.entity.Plan;
import com.coeso.roster.entity.Subscription;
import com.coeso.roster.entity.SubscriptionStatus;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.repo.Repositories.BillingEventRepository;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.PlanRepository;
import com.coeso.roster.repo.Repositories.RepRepository;
import com.coeso.roster.repo.Repositories.SubscriptionRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.time.LocalDateTime;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Billing: plan browsing, owner-only checkout and plan changes, and webhook
 * processing.
 *
 * <p>Two hard guarantees:
 * <ul>
 *   <li><b>Webhooks are verified before they are parsed.</b> The provider
 *       implementation checks the HMAC signature over the raw body and throws
 *       before any JSON interpretation; the controller maps that to 401.</li>
 *   <li><b>Webhooks are idempotent.</b> Every verified event is inserted into
 *       {@code billing_events} first; the database's
 *       {@code uq_billing_events_provider_event} unique key makes a duplicate
 *       insert fail, and the duplicate is skipped without re-applying state.
 *       Two concurrent deliveries of the same event therefore apply once.</li>
 * </ul>
 *
 * <p>Downgrades (a plan whose limits are lower than current usage) are blocked
 * with a 409 that names the offending resource; upgrades always pass.
 */
@Service
public class BillingService {

    private static final Logger log = LoggerFactory.getLogger(BillingService.class);

    public record PlanView(String code, String name, Integer maxReps, Integer maxMembers,
                           boolean current) {
    }

    public record SubscriptionView(String planCode, String planName, String status,
                                   LocalDateTime trialEndsAt, LocalDateTime currentPeriodEnd,
                                   String provider) {
    }

    public record CheckoutView(String provider, String url) {
    }

    public record WebhookResult(String outcome, String eventId) {
    }

    private final PlanRepository plans;
    private final SubscriptionRepository subscriptions;
    private final WorkspaceRepository workspaces;
    private final MembershipRepository memberships;
    private final RepRepository reps;
    private final BillingEventRepository billingEvents;
    private final ObjectProvider<BillingProviders> providerSelection;
    private final AuditService audit;

    public BillingService(PlanRepository plans, SubscriptionRepository subscriptions,
                          WorkspaceRepository workspaces, MembershipRepository memberships,
                          RepRepository reps, BillingEventRepository billingEvents,
                          ObjectProvider<BillingProviders> providerSelection,
                          AuditService audit) {
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.workspaces = workspaces;
        this.memberships = memberships;
        this.reps = reps;
        this.billingEvents = billingEvents;
        this.providerSelection = providerSelection;
        this.audit = audit;
    }

    // ------------------------------------------------------------------- plans

    /** Pricing page data: every plan, with the caller's current one marked. */
    public List<PlanView> listPlans() {
        Long currentPlanId = subscriptions
                .findByWorkspaceId(TenantContext.requireWorkspaceId())
                .map(Subscription::getPlanId)
                .orElse(null);
        return plans.findAll().stream()
                .sorted((a, b) -> Integer.compare(order(a.getCode()), order(b.getCode())))
                .map(p -> new PlanView(p.getCode(), p.getName(), p.getMaxReps(),
                        p.getMaxMembers(), p.getId().equals(currentPlanId)))
                .toList();
    }

    public SubscriptionView currentSubscription() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Subscription subscription = subscriptions.findByWorkspaceId(workspaceId)
                .orElseThrow(() -> new NotFoundException("No subscription for this workspace"));
        return new SubscriptionView(subscription.getPlan().getCode(),
                subscription.getPlan().getName(), subscription.getStatus().name(),
                subscription.getTrialEndsAt(), subscription.getCurrentPeriodEnd(),
                subscription.getProvider());
    }

    // ---------------------------------------------------------------- checkout

    /**
     * Starts hosted checkout for a plan (owner only). The subscription row is
     * updated to the chosen plan immediately; its status only becomes ACTIVE
     * when the verified webhook confirms payment — the client never reports
     * success.
     */
    @PreAuthorize("@roles.hasAtLeast('OWNER')")
    public CheckoutView checkout(String planCode) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Plan plan = requirePlan(planCode);
        Subscription subscription = requireSubscription(workspaceId);

        // A no-op "upgrade" to the plan already active has nothing to charge.
        if (subscription.getPlanId().equals(plan.getId())
                && subscription.getStatus() == SubscriptionStatus.ACTIVE) {
            throw new BadRequestException("Workspace is already on the " + plan.getCode()
                    + " plan");
        }
        assertNotDowngrade(workspaceId, plan);

        BillingProviders providers = providerSelection.getObject();
        BillingProvider provider = providers.active();
        if (!provider.isConfigured()) {
            throw new BillingUnavailableException(
                    "Billing provider '" + provider.name() + "' is not configured on this "
                            + "server; set its API keys (see .env.example) or use the plan "
                            + "switch for plans within your limits");
        }
        BillingProvider.CheckoutSession session;
        try {
            session = provider.createCheckout(
                    new BillingProvider.CheckoutCommand(workspaceId, plan.getCode(),
                            successUrl(planCode), cancelUrl()));
        } catch (UnsupportedOperationException notImplemented) {
            throw new BillingUnavailableException(notImplemented.getMessage());
        }

        subscription.setPlanId(plan.getId());
        // plan is an insertable=false association: set it too, or the
        // in-memory entity keeps serving the old plan within this request.
        subscription.setPlan(plan);
        subscription.setProvider(provider.name());
        if (session.providerCustomerId() != null) {
            subscription.setProviderCustomerId(session.providerCustomerId());
        }
        if (session.providerSubscriptionId() != null) {
            subscription.setProviderSubscriptionId(session.providerSubscriptionId());
        }
        subscriptions.save(subscription);
        audit.record("UPDATE", "subscription", subscription.getId(),
                java.util.Map.of("event", "checkout_started", "plan", plan.getCode(),
                        "provider", provider.name()));

        return new CheckoutView(provider.name(), session.url());
    }

    // -------------------------------------------------------------- plan change

    /**
     * Switches plans without payment (owner only) — used for downgrades that
     * are still within limits (e.g. pro → starter with 30 reps) and for the
     * free plan. Blocked when current usage exceeds the target plan.
     */
    @PreAuthorize("@roles.hasAtLeast('OWNER')")
    public SubscriptionView changePlan(String planCode) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Plan plan = requirePlan(planCode);
        Subscription subscription = requireSubscription(workspaceId);

        assertNotDowngrade(workspaceId, plan);

        Long previousPlanId = subscription.getPlanId();
        subscription.setPlanId(plan.getId());
        subscription.setPlan(plan);
        subscriptions.save(subscription);
        audit.record("UPDATE", "subscription", subscription.getId(),
                java.util.Map.of("event", "plan_changed", "plan", plan.getCode(),
                        "previousPlanId", String.valueOf(previousPlanId)));
        return currentSubscription();
    }

    // ----------------------------------------------------------------- webhook

    /**
     * Processes a webhook that the provider has already signature-verified.
     * Idempotent by (provider, event_id); safe to retry and safe under
     * concurrent delivery.
     */
    public WebhookResult processVerifiedEvent(BillingProvider.VerifiedEvent event,
                                              String rawPayload) {
        if (event.eventId() == null || event.eventId().isBlank()) {
            throw new BadRequestException("Billing event has no id");
        }
        String providerName = providerSelection.getObject().active().name();

        // 1) Record the event first. The unique key (provider, event_id) is the
        //    idempotency lock: a duplicate delivery fails this insert and is
        //    skipped before any state is touched.
        if (billingEvents.existsByProviderAndEventId(providerName, event.eventId())) {
            return new WebhookResult("duplicate", event.eventId());
        }
        Long workspaceId = event.workspaceId();
        if (workspaceId == null || workspaces.findById(workspaceId).isEmpty()) {
            // Nothing we can act on; record nothing (billing_events.workspace_id
            // is a NOT NULL FK) and acknowledge so the provider stops retrying.
            log.warn("Ignoring billing event {} without a known workspace",
                    event.eventId());
            return new WebhookResult("ignored", event.eventId());
        }
        BillingEvent record = new BillingEvent();
        record.setWorkspaceId(workspaceId);
        record.setProvider(providerName);
        record.setEventId(event.eventId());
        record.setType(event.type());
        record.setPayload(truncate(rawPayload, 60000));
        try {
            billingEvents.saveAndFlush(record);
        } catch (org.springframework.dao.DataIntegrityViolationException duplicate) {
            // Lost the race against a concurrent delivery of the same event.
            // The transaction is rollback-only now, so we cannot return a
            // success body from it; surface a clean 409 instead. Nothing was
            // applied twice and the provider's retry hits the exists-check
            // above and is acknowledged as a duplicate.
            throw new ConflictException(
                    "Duplicate billing event '" + event.eventId()
                            + "' (concurrent delivery)");
        }

        // 2) Apply state only for the first delivery.
        SubscriptionStatus status = mapStatus(event.state());
        if (status == null) {
            return new WebhookResult("recorded", event.eventId());
        }
        Subscription subscription = subscriptions.findByWorkspaceId(workspaceId).orElse(null);
        if (subscription == null) {
            return new WebhookResult("recorded", event.eventId());
        }
        subscription.setStatus(status);
        if (event.planCode() != null) {
            plans.findByCode(event.planCode())
                    .ifPresent(plan -> {
                        subscription.setPlanId(plan.getId());
                        subscription.setPlan(plan);
                    });
        }
        if (event.periodEndEpochSeconds() != null) {
            subscription.setCurrentPeriodEnd(
                    LocalDateTime.ofEpochSecond(event.periodEndEpochSeconds(), 0,
                            java.time.ZoneOffset.UTC));
        }
        subscriptions.save(subscription);
        // Webhook threads carry no user context: the audit row records the
        // provider as the actor (actor_user_id stays NULL).
        audit.recordUnattributed(workspaceId, "UPDATE", "subscription", subscription.getId(),
                java.util.Map.of("event", event.type() == null ? "webhook" : event.type(),
                        "status", status.name(), "providerEventId", event.eventId()));
        return new WebhookResult("applied", event.eventId());
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Blocks a plan whose limits are below current usage. Upgrades and moves
     * within the same ceiling always pass. Read straight from repositories:
     * {@code PlanLimitService} is transaction-wrapped by {@code TenantAspect},
     * so calling it here and catching would poison this transaction (the
     * rollback-only trap).
     */
    private void assertNotDowngrade(Long workspaceId, Plan target) {
        if (target.getMaxReps() != null) {
            long currentReps = reps.findAll().stream()
                    .filter(r -> r.getWorkspaceId().equals(workspaceId)
                            && r.getDeletedAt() == null)
                    .count();
            if (currentReps > target.getMaxReps()) {
                throw new ConflictException("Cannot switch to the " + target.getCode()
                        + " plan: it allows " + target.getMaxReps() + " reps but the "
                        + "workspace currently has " + currentReps
                        + ". Remove reps first or pick a larger plan.");
            }
        }
        if (target.getMaxMembers() != null) {
            long currentMembers = memberships.countByWorkspaceId(workspaceId);
            if (currentMembers > target.getMaxMembers()) {
                throw new ConflictException("Cannot switch to the " + target.getCode()
                        + " plan: it allows " + target.getMaxMembers() + " members but the "
                        + "workspace currently has " + currentMembers
                        + ". Remove members first or pick a larger plan.");
            }
        }
    }

    private Plan requirePlan(String planCode) {
        if (planCode == null || planCode.isBlank()) {
            throw new BadRequestException("planCode is required");
        }
        return plans.findByCode(planCode.trim().toLowerCase())
                .orElseThrow(() -> new NotFoundException("Unknown plan '" + planCode + "'"));
    }

    private Subscription requireSubscription(Long workspaceId) {
        return subscriptions.findByWorkspaceId(workspaceId)
                .orElseThrow(() -> new NotFoundException("No subscription for this workspace"));
    }

    private static SubscriptionStatus mapStatus(BillingProvider.SubscriptionState state) {
        return switch (state) {
            case TRIALING -> SubscriptionStatus.TRIALING;
            case ACTIVE -> SubscriptionStatus.ACTIVE;
            case PAST_DUE -> SubscriptionStatus.PAST_DUE;
            case CANCELED -> SubscriptionStatus.CANCELED;
            // Incomplete / unpaid / expired states are pre-payment noise for a
            // subscription flow that starts at checkout; recorded, not mapped.
            case INCOMPLETE, UNPAID, INCOMPLETE_EXPIRED, UNKNOWN -> null;
        };
    }

    private static String successUrl(String planCode) {
        return baseUrl() + "/settings?billing=success&plan=" + planCode;
    }

    private static String cancelUrl() {
        return baseUrl() + "/settings?billing=cancelled";
    }

    private static String baseUrl() {
        String configured = System.getProperty("app.baseUrl",
                System.getenv().getOrDefault("APP_BASE_URL", "http://localhost:5173"));
        return configured;
    }

    private static int order(String code) {
        return switch (code) {
            case "free" -> 0;
            case "starter" -> 1;
            case "pro" -> 2;
            case "unlimited" -> 3;
            default -> 9;
        };
    }

    private static String truncate(String raw, int max) {
        if (raw == null) {
            return null;
        }
        return raw.length() <= max ? raw : raw.substring(0, max);
    }

    /** Workspace lookup helper for tests and the webhook path. */
    Workspace workspaceById(Long id) {
        return workspaces.findById(id).orElse(null);
    }
}
