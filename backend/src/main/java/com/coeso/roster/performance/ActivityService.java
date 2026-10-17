package com.coeso.roster.performance;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ForbiddenException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.ActivityEntry;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.LedgerEntry;
import com.coeso.roster.entity.MetricType;
import com.coeso.roster.entity.Placement;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Performance logging [PRO]: activity entries per placement with per-workspace
 * metric types (counts and money-minor values).
 *
 * <p>Permission model (beyond the method-security bars):
 * <ul>
 *   <li>metric writes: admin+; metric reads: every member;</li>
 *   <li>creating entries: manager+ for any placement, reps only for their own
 *       linked rep's placements;</li>
 *   <li>editing: managers always; reps only their own entries within 7 days
 *       of the entry's date (documented interpretation of the rule);</li>
 *   <li>deleting: manager+ only, and never when earnings were already accrued
 *       (edit instead — that issues a reversing ledger row).</li>
 * </ul>
 */
@Service
public class ActivityService {

    /** Reps may edit their own entries for this many days after the entry date. */
    public static final int REP_EDIT_WINDOW_DAYS = 7;

    public record MetricResponse(Long id, String name, String unit) {
    }

    public record MetricRequest(@NotNull String name, @NotNull String unit) {
    }

    public record ActivityRequest(
            @NotNull Long placementId,
            @NotNull Long metricTypeId,
            @NotNull LocalDate occurredOn,
            @NotNull Long valueMinor,
            String notes) {
    }

    public record ActivityUpdateRequest(
            Long metricTypeId,
            LocalDate occurredOn,
            Long valueMinor,
            String notes) {
    }

    public record ActivityResponse(
            Long id,
            Long placementId,
            Long repId,
            String repName,
            Long offerId,
            String offerTitle,
            Long metricTypeId,
            String metricName,
            String metricUnit,
            LocalDate occurredOn,
            Long valueMinor,
            String notes,
            Long loggedBy,
            LocalDateTime createdAt,
            LocalDateTime updatedAt,
            boolean canEdit) {
    }

    private final ScopedQueries scoped;
    private final AuditService auditService;
    private final com.coeso.roster.plan.PlanLimitService planLimits;
    private final LedgerService ledgerService;
    private final com.coeso.roster.repo.Repositories.MembershipRepository memberships;

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    public ActivityService(ScopedQueries scoped, AuditService auditService,
                           com.coeso.roster.plan.PlanLimitService planLimits,
                           LedgerService ledgerService,
                           com.coeso.roster.repo.Repositories.MembershipRepository memberships) {
        this.scoped = scoped;
        this.auditService = auditService;
        this.planLimits = planLimits;
        this.ledgerService = ledgerService;
        this.memberships = memberships;
    }

    // ----------------------------------------------------------- metric types

    public List<MetricResponse> listMetricTypes() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "performance metrics");
        return entityManager
                .createQuery("select m from MetricType m order by m.id asc", MetricType.class)
                .getResultList()
                .stream()
                .map(m -> new MetricResponse(m.getId(), m.getName(),
                        m.getUnit().name().toLowerCase(Locale.ROOT)))
                .toList();
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public MetricResponse createMetricType(@Valid MetricRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "performance metrics");
        MetricType metric = new MetricType();
        metric.setWorkspaceId(workspaceId);
        metric.setName(requireName(request.name()));
        metric.setUnit(parseUnit(request.unit()));
        entityManager.persist(metric);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_CREATE, "metric_type", metric.getId(),
                Map.of("name", metric.getName(), "unit", metric.getUnit().name()));
        return new MetricResponse(metric.getId(), metric.getName(),
                metric.getUnit().name().toLowerCase(Locale.ROOT));
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public MetricResponse updateMetricType(Long id, @Valid MetricRequest request) {
        TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(TenantContext.workspaceId(), "performance metrics");
        MetricType metric = scoped.require(MetricType.class, id, "Metric type");
        metric.setName(requireName(request.name()));
        metric.setUnit(parseUnit(request.unit()));
        entityManager.flush();
        auditService.record(AuditLog.ACTION_UPDATE, "metric_type", id,
                Map.of("name", metric.getName(), "unit", metric.getUnit().name()));
        return new MetricResponse(metric.getId(), metric.getName(),
                metric.getUnit().name().toLowerCase(Locale.ROOT));
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public void deleteMetricType(Long id) {
        TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(TenantContext.workspaceId(), "performance metrics");
        MetricType metric = scoped.require(MetricType.class, id, "Metric type");
        long uses = entityManager
                .createQuery("select count(a) from ActivityEntry a"
                        + " where a.metricTypeId = :id", Long.class)
                .setParameter("id", id)
                .getSingleResult();
        if (uses > 0) {
            throw new ConflictException("Metric is used by " + uses + " entr(ies); reassign them first");
        }
        entityManager.remove(metric);
        auditService.record(AuditLog.ACTION_DELETE, "metric_type", id,
                Map.of("name", metric.getName()));
    }

    // ----------------------------------------------------------- log metadata

    /** Which placements a caller may log against (their picker's data). */
    public record LogPlacement(Long placementId, Long offerId, String offerTitle,
                               Long repId, String repName) {
    }

    public List<LogPlacement> logMeta() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "performance logging");

        String where;
        Long ownRepId = null;
        if (isManagerPlus()) {
            where = ""; // any placement
        } else {
            ownRepId = callerRepId(workspaceId);
            if (ownRepId == null) {
                return List.of();
                }
            where = " where p.repId = :repId";
        }
        var query = entityManager.createQuery(
                "select p.id, p.offerId, p.offer.title, p.repId, p.rep.name"
                        + " from Placement p" + where
                        + " order by p.placedAt desc", Object[].class);
        if (ownRepId != null) {
            query.setParameter("repId", ownRepId);
        }
        List<LogPlacement> placements = new ArrayList<>();
        for (Object[] row : query.setMaxResults(200).getResultList()) {
            placements.add(new LogPlacement((Long) row[0], (Long) row[1], (String) row[2],
                    (Long) row[3], (String) row[4]));
        }
        return placements;
    }

    // ---------------------------------------------------------------- entries

    public ActivityResponse create(@Valid ActivityRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "performance logging");

        Placement placement = scoped.require(Placement.class, request.placementId(),
                "Placement");
        MetricType metric = scoped.require(MetricType.class, request.metricTypeId(),
                "Metric type");
        assertCanLogFor(placement);
        if (request.valueMinor() < 0) {
            throw new BadRequestException("valueMinor must be >= 0");
        }

        ActivityEntry entry = new ActivityEntry();
        entry.setWorkspaceId(workspaceId);
        entry.setPlacementId(placement.getId());
        entry.setRepId(placement.getRepId()); // single source of truth
        entry.setMetricTypeId(metric.getId());
        entry.setOccurredOn(request.occurredOn());
        entry.setValueMinor(request.valueMinor());
        entry.setNotes(request.notes());
        entry.setLoggedBy(TenantContext.actorUserId());
        entityManager.persist(entry);
        entityManager.flush();

        auditService.record(AuditLog.ACTION_CREATE, "activity_entry", entry.getId(),
                Map.of("repId", entry.getRepId(),
                        "metric", metric.getName(),
                        "valueMinor", entry.getValueMinor(),
                        "occurredOn", entry.getOccurredOn().toString()));
        ledgerService.reconcile(entry, placement, metric);

        return toResponse(entry, metric, placement, true);
    }

    public ActivityResponse update(Long id, @Valid ActivityUpdateRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "performance logging");

        ActivityEntry entry = scoped.require(ActivityEntry.class, id, "Activity entry");
        Placement placement = scoped.require(Placement.class, entry.getPlacementId(),
                "Placement");
        assertCanEdit(entry);

        if (request.metricTypeId() != null) {
            MetricType metric = scoped.require(MetricType.class, request.metricTypeId(),
                    "Metric type");
            entry.setMetricTypeId(metric.getId());
        }
        if (request.occurredOn() != null) {
            entry.setOccurredOn(request.occurredOn());
        }
        if (request.valueMinor() != null) {
            if (request.valueMinor() < 0) {
                throw new BadRequestException("valueMinor must be >= 0");
            }
            entry.setValueMinor(request.valueMinor());
        }
        if (request.notes() != null) {
            entry.setNotes(request.notes());
        }
        entityManager.flush();

        MetricType currentMetric = scoped.require(MetricType.class, entry.getMetricTypeId(),
                "Metric type");
        // May raise 409 (already paid) — rolls the whole edit back.
        ledgerService.reconcile(entry, placement, currentMetric);
        auditService.record(AuditLog.ACTION_UPDATE, "activity_entry", entry.getId(),
                Map.of("repId", entry.getRepId(), "valueMinor", entry.getValueMinor(),
                        "occurredOn", entry.getOccurredOn().toString()));
        return toResponse(entry, currentMetric, placement, canEdit(entry));
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public void delete(Long id) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "performance logging");
        ActivityEntry entry = scoped.require(ActivityEntry.class, id, "Activity entry");
        ledgerService.assertNoEarnings(entry.getId());
        entityManager.remove(entry);
        auditService.record(AuditLog.ACTION_DELETE, "activity_entry", id,
                Map.of("repId", entry.getRepId()));
    }

    /**
     * Listing is open to every member; reps are clamped server-side to their
     * own linked rep (asking for another rep's id is a 403).
     */
    public ActivityPage list(Long placementId, Long repId, Long metricTypeId,
                             LocalDate from, LocalDate to, Integer page, Integer size) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "performance logging");

        boolean managerPlus = isManagerPlus();
        StringBuilder where = new StringBuilder(
                " where a.workspaceId = :workspaceId");
        Map<String, Object> params = new HashMap<>();
        params.put("workspaceId", workspaceId);

        if (!managerPlus) {
            Long ownRepId = callerRepId(workspaceId);
            if (ownRepId == null) {
                return new ActivityPage(0, 20, 0, List.of());
            }
            if (repId != null && !ownRepId.equals(repId)) {
                throw new ForbiddenException(
                        "Reps may only view their own activity");
            }
            repId = ownRepId;
        }
        if (placementId != null) {
            where.append(" and a.placementId = :placementId");
            params.put("placementId", placementId);
        }
        if (repId != null) {
            where.append(" and a.repId = :repId");
            params.put("repId", repId);
        }
        if (metricTypeId != null) {
            where.append(" and a.metricTypeId = :metricTypeId");
            params.put("metricTypeId", metricTypeId);
        }
        if (from != null) {
            where.append(" and a.occurredOn >= :from");
            params.put("from", from);
        }
        if (to != null) {
            where.append(" and a.occurredOn <= :to");
            params.put("to", to);
        }

        long total = countEntries(where.toString(), params);
        int pageNumber = page == null || page < 0 ? 0 : page;
        int pageSize = size == null || size <= 0 ? 20 : Math.min(size, 100);
        var query = entityManager.createQuery(
                "select a from ActivityEntry a" + where
                        + " order by a.occurredOn desc, a.id desc", ActivityEntry.class);
        params.forEach(query::setParameter);
        List<ActivityEntry> rows = query
                .setFirstResult(pageNumber * pageSize)
                .setMaxResults(pageSize)
                .getResultList();

        Long ownRepId = managerPlus ? null : callerRepId(workspaceId);
        List<ActivityResponse> items = new ArrayList<>();
        if (!rows.isEmpty()) {
            Map<Long, MetricType> metrics = metricsById(rows.stream()
                    .map(ActivityEntry::getMetricTypeId).distinct().toList());
            Map<Long, Placement> placements = placementsById(rows.stream()
                    .map(ActivityEntry::getPlacementId).distinct().toList());
            Map<Long, String> repNames = repNames(rows.stream()
                    .map(ActivityEntry::getRepId).distinct().toList());
            for (ActivityEntry entry : rows) {
                // Manager+ may always edit; reps only their own rows inside
                // the 7-day window.
                boolean editAllowed = managerPlus ||
                        (entry.getRepId() != null && entry.getRepId().equals(ownRepId)
                                && withinEditWindow(entry));
                items.add(toResponse(entry, metrics.get(entry.getMetricTypeId()),
                        placements.get(entry.getPlacementId()), editAllowed,
                        repNames.get(entry.getRepId())));
            }
        }
        return new ActivityPage(pageNumber, pageSize, total, items);
    }

    public record ActivityPage(int page, int size, long total, List<ActivityResponse> items) {
    }

    // --------------------------------------------------------------- helpers

    /** A rep may log only for their own linked rep's placements. */
    private void assertCanLogFor(Placement placement) {
        if (isManagerPlus()) {
            return;
        }
        Long ownRepId = callerRepId(TenantContext.requireWorkspaceId());
        if (ownRepId == null || !ownRepId.equals(placement.getRepId())) {
            throw new ForbiddenException(
                    "Reps may only log activity for their own placements");
        }
    }

    private void assertCanEdit(ActivityEntry entry) {
        if (isManagerPlus()) {
            return;
        }
        Long ownRepId = callerRepId(TenantContext.requireWorkspaceId());
        if (ownRepId == null || !ownRepId.equals(entry.getRepId())) {
            throw new ForbiddenException("Reps may only edit their own entries");
        }
        if (!withinEditWindow(entry)) {
            throw new ForbiddenException(
                    "Reps can edit their own entries within " + REP_EDIT_WINDOW_DAYS
                            + " days of the entry date");
        }
    }

    private boolean canEdit(ActivityEntry entry) {
        if (isManagerPlus()) {
            return true;
        }
        Long ownRepId = callerRepId(TenantContext.requireWorkspaceId());
        return ownRepId != null && ownRepId.equals(entry.getRepId())
                && withinEditWindow(entry);
    }

    /** Reps' 7-day edit window: entry date within the last 7 days (not older). */
    static boolean withinEditWindow(ActivityEntry entry) {
        return !entry.getOccurredOn().isBefore(LocalDate.now().minusDays(REP_EDIT_WINDOW_DAYS));
    }

    private static boolean isManagerPlus() {
        WorkspaceRole role = TenantContext.role();
        return role != null && role.atLeast(WorkspaceRole.MANAGER);
    }

    private Long callerRepId(Long workspaceId) {
        Long userId = TenantContext.actorUserId();
        if (userId == null) {
            return null;
        }
        return memberships.findByUserIdAndWorkspaceId(userId, workspaceId)
                .map(com.coeso.roster.entity.Membership::getRepId)
                .orElse(null);
    }

    private static String requireName(String raw) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty()) {
            throw new BadRequestException("Metric name is required");
        }
        if (name.length() > 60) {
            throw new BadRequestException("Metric name must be at most 60 characters");
        }
        return name;
    }

    private static MetricType.Unit parseUnit(String raw) {
        try {
            return MetricType.Unit.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (Exception e) {
            throw new BadRequestException("unit must be 'count' or 'currency'");
        }
    }

    private long countEntries(String where, Map<String, Object> params) {
        var query = entityManager.createQuery(
                "select count(a) from ActivityEntry a" + where, Long.class);
        params.forEach(query::setParameter);
        return query.getSingleResult();
    }

    private Map<Long, MetricType> metricsById(List<Long> ids) {
        Map<Long, MetricType> map = new HashMap<>();
        if (ids.isEmpty()) {
            return map;
        }
        for (MetricType metric : entityManager
                .createQuery("select m from MetricType m where m.id in :ids",
                        MetricType.class)
                .setParameter("ids", ids)
                .getResultList()) {
            map.put(metric.getId(), metric);
        }
        return map;
    }

    private Map<Long, Placement> placementsById(List<Long> ids) {
        Map<Long, Placement> map = new HashMap<>();
        if (ids.isEmpty()) {
            return map;
        }
        for (Placement placement : entityManager
                .createQuery("select p from Placement p where p.id in :ids", Placement.class)
                .setParameter("ids", ids)
                .getResultList()) {
            map.put(placement.getId(), placement);
        }
        return map;
    }

    private Map<Long, String> repNames(List<Long> ids) {
        Map<Long, String> map = new HashMap<>();
        if (ids.isEmpty()) {
            return map;
        }
        for (Object[] row : entityManager
                .createQuery("select r.id, r.name from Rep r where r.id in :ids",
                        Object[].class)
                .setParameter("ids", ids)
                .getResultList()) {
            map.put((Long) row[0], (String) row[1]);
        }
        return map;
    }

    private ActivityResponse toResponse(ActivityEntry entry, MetricType metric,
                                        Placement placement, boolean canEdit) {
        Map<Long, String> names = repNames(List.of(entry.getRepId()));
        return toResponse(entry, metric, placement, canEdit,
                names.get(entry.getRepId()));
    }

    private ActivityResponse toResponse(ActivityEntry entry, MetricType metric,
                                        Placement placement, boolean canEdit,
                                        String repName) {
        return new ActivityResponse(
                entry.getId(),
                entry.getPlacementId(),
                entry.getRepId(),
                repName,
                placement == null ? null : placement.getOfferId(),
                placement == null ? null : placement.getOffer().getTitle(),
                entry.getMetricTypeId(),
                metric == null ? null : metric.getName(),
                metric == null ? null : metric.getUnit().name().toLowerCase(Locale.ROOT),
                entry.getOccurredOn(),
                entry.getValueMinor(),
                entry.getNotes(),
                entry.getLoggedBy(),
                entry.getCreatedAt(),
                entry.getUpdatedAt(),
                canEdit);
    }
}