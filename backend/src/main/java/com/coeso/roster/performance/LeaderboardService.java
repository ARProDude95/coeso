package com.coeso.roster.performance;

import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.MetricType;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Leaderboard [PRO] — top reps by period (week / month / quarter / custom) and
 * metric, summed from activity entries. Every member may call it: reps always
 * get their own value and rank, and other reps' names (and ids) are masked
 * unless the workspace's leaderboard_show_names setting is on — manager+
 * always see names.
 */
@Service
public class LeaderboardService {

    public record LeaderRow(
            int rank,
            Long repId,
            String repName,
            long value,
            boolean self) {
    }

    public record LeaderboardResponse(
            String period,
            Long metricTypeId,
            String metricName,
            String metricUnit,
            LocalDate from,
            LocalDate to,
            boolean showNames,
            Integer selfRank,
            List<LeaderRow> items) {
    }

    private final WorkspaceRepository workspaces;
    private final MembershipRepository memberships;
    private final com.coeso.roster.plan.PlanLimitService planLimits;

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    public LeaderboardService(WorkspaceRepository workspaces,
                              MembershipRepository memberships,
                              com.coeso.roster.plan.PlanLimitService planLimits) {
        this.workspaces = workspaces;
        this.memberships = memberships;
        this.planLimits = planLimits;
    }

    public LeaderboardResponse leaderboard(String period, String from, String to,
                                           Long metricTypeId) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "leaderboard");
        return build(workspaceId, period, from, to, metricTypeId);
    }

    /** First day of the quarter containing {@code day} — the longest period
     *  the leaderboard serves, also used as the match-score performance window. */
    private static LocalDate quarterStart(LocalDate day) {
        int startMonth = ((day.getMonthValue() - 1) / 3) * 3 + 1;
        return day.withMonth(startMonth).withDayOfMonth(1);
    }

    private LeaderboardResponse build(Long workspaceId, String period, String fromRaw,
                                      String toRaw, Long metricTypeId) {
        String normalizedPeriod = period == null || period.isBlank()
                ? "week" : period.trim().toLowerCase(Locale.ROOT);
        LocalDate today = LocalDate.now();
        LocalDate from;
        LocalDate to = today;
        switch (normalizedPeriod) {
            case "week" -> {
                LocalDate monday = today.with(DayOfWeek.MONDAY);
                if (monday.isAfter(today)) {
                    monday = monday.minusWeeks(1);
                }
                from = monday;
            }
            case "month" -> from = today.withDayOfMonth(1);
            case "quarter" -> from = quarterStart(today);
            case "custom" -> {
                if (fromRaw == null || fromRaw.isBlank() || toRaw == null || toRaw.isBlank()) {
                    throw new BadRequestException(
                            "custom periods need both from and to (ISO dates)");
                }
                from = LocalDate.parse(fromRaw);
                to = LocalDate.parse(toRaw);
                if (from.isAfter(to)) {
                    throw new BadRequestException("from must not be after to");
                }
            }
            default -> throw new BadRequestException(
                    "period must be week, month, quarter or custom");
        }

        MetricType metric = entityManager
                .createQuery("select m from MetricType m where m.id = :id", MetricType.class)
                .setParameter("id", metricTypeId)
                .getResultList().stream().findFirst()
                .orElseThrow(() -> new BadRequestException(
                        "metricTypeId must reference one of this workspace's metrics"));

        List<Object[]> rows = entityManager
                .createQuery("select a.repId, sum(a.valueMinor) from ActivityEntry a"
                        + " where a.metricTypeId = :metricId"
                        + " and a.occurredOn >= :from and a.occurredOn <= :to"
                        + " group by a.repId"
                        + " order by sum(a.valueMinor) desc, a.repId asc", Object[].class)
                .setParameter("metricId", metric.getId())
                .setParameter("from", from)
                .setParameter("to", to)
                .setMaxResults(100)
                .getResultList();

        Workspace workspace = workspaces.findById(workspaceId)
                .orElseThrow(() -> new IllegalStateException("workspace missing"));
        boolean showNamesSetting = workspace.isLeaderboardShowNames();
        WorkspaceRole role = TenantContext.role();
        boolean canSeeNames = role != null && role.atLeast(WorkspaceRole.MANAGER);
        Long selfRepId = memberships
                .findByUserIdAndWorkspaceId(TenantContext.actorUserId(), workspaceId)
                .map(com.coeso.roster.entity.Membership::getRepId)
                .orElse(null);

        Map<Long, String> repNames = new HashMap<>();
        List<Long> repIds = rows.stream().map(r -> (Long) r[0]).toList();
        if (!repIds.isEmpty()) {
            for (Object[] row : entityManager
                    .createQuery("select r.id, r.name from Rep r where r.id in :ids",
                            Object[].class)
                    .setParameter("ids", repIds)
                    .getResultList()) {
                repNames.put((Long) row[0], (String) row[1]);
            }
        }

        List<LeaderRow> items = new ArrayList<>();
        Integer selfRank = null;
        int rank = 0;
        for (Object[] row : rows) {
            rank++;
            Long repId = (Long) row[0];
            long value = ((Number) row[1]).longValue();
            boolean self = repId != null && repId.equals(selfRepId);
            if (self) {
                selfRank = rank;
            }
            // Privacy: a rep sees their own identity always; other reps are
            // masked unless the workspace setting says names are shared.
            boolean reveal = canSeeNames || showNamesSetting || self;
            items.add(new LeaderRow(rank,
                    reveal ? repId : null,
                    reveal ? repNames.get(repId) : null,
                    value,
                    self));
        }

        return new LeaderboardResponse(normalizedPeriod, metric.getId(), metric.getName(),
                metric.getUnit().name().toLowerCase(Locale.ROOT), from, to,
                canSeeNames || showNamesSetting, selfRank, items);
    }

    /**
     * The match score's performance factor, computed from the same activity
     * rows the leaderboard ranks on: current quarter to date, one value per
     * metric scaled to the workspace's top scorer on that metric, then
     * averaged across the metrics that hold data — 0–100 reads as "fraction
     * of the workspace's best". Reps with no rows in the window are omitted
     * from the map, so the scorer marks the factor not applicable instead of
     * inventing a zero; a workspace with no activity returns an empty map and
     * match scoring behaves exactly as it did before Phase 7 landed.
     *
     * <p>No pro-gate here on purpose: writing activity is already [PRO], so a
     * free workspace simply has no rows and no gated data leaks through. This
     * is an internal scoring input on a manager+ surface (suggested reps), so
     * the leaderboard's rep-name masking does not apply.
     */
    public Map<Long, Double> performanceIndex(Collection<Long> repIds) {
        if (repIds == null || repIds.isEmpty()) {
            return Map.of();
        }
        LocalDate today = LocalDate.now();
        List<Object[]> rows = entityManager
                .createQuery("select a.metricTypeId, a.repId, sum(a.valueMinor)"
                        + " from ActivityEntry a"
                        + " where a.occurredOn >= :from and a.occurredOn <= :to"
                        + " group by a.metricTypeId, a.repId", Object[].class)
                .setParameter("from", quarterStart(today))
                .setParameter("to", today)
                .getResultList();

        Map<Long, Map<Long, Long>> sums = new HashMap<>();
        Map<Long, Long> metricBest = new HashMap<>();
        Set<Long> withData = new HashSet<>();
        for (Object[] row : rows) {
            Long metricId = (Long) row[0];
            Long repId = (Long) row[1];
            long value = ((Number) row[2]).longValue();
            sums.computeIfAbsent(metricId, k -> new HashMap<>()).put(repId, value);
            metricBest.merge(metricId, value, Math::max);
            withData.add(repId);
        }
        List<Long> scoredMetrics = metricBest.entrySet().stream()
                .filter(e -> e.getValue() > 0)
                .map(Map.Entry::getKey)
                .toList();
        if (scoredMetrics.isEmpty()) {
            return Map.of(); // rows exist but every value is zero: no signal
        }

        Map<Long, Double> result = new HashMap<>();
        for (Long repId : repIds) {
            if (!withData.contains(repId)) {
                continue; // no rows in the window → factor not applicable
            }
            double fraction = 0;
            for (Long metricId : scoredMetrics) {
                long value = sums.get(metricId).getOrDefault(repId, 0L);
                fraction += 100.0 * value / metricBest.get(metricId);
            }
            result.put(repId, fraction / scoredMetrics.size());
        }
        return result;
    }
}