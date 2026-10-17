package com.coeso.roster.performance;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ForbiddenException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.commission.CommissionMath;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.ActivityEntry;
import com.coeso.roster.entity.CommissionRule;
import com.coeso.roster.entity.LedgerEntry;
import com.coeso.roster.entity.MetricType;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.repo.Repositories.MembershipRepository;
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
 * The append-only earnings ledger [PRO].
 *
 * <p><b>Append-only contract:</b> this service exposes no code path that edits
 * a row's amount/currency/source. Accruals are inserted when revenue is logged;
 * when the underlying entry changes, a new <em>reversing</em> row (negative
 * amount, {@code reverses_entry_id} set, copying the original's status so
 * approvals net out) is appended alongside the fresh accrual. Only status
 * transitions (accrued → approved → paid) and attaching a payout mutate rows;
 * paid rows can never be reversed — that's a 409.
 *
 * <p>Reads: manager+ see everything; reps see exactly their own earnings
 * (forcing the filter server-side — another rep's id is a 403, and rows they
 * don't own can never appear).
 */
@Service
public class LedgerService {

    public record EarningsQuery(Long repId, String status, LocalDate from, LocalDate to) {
    }

    public record EarningsEntry(
            Long id,
            Long repId,
            String repName,
            Long placementId,
            Long offerId,
            String offerTitle,
            Long activityEntryId,
            Long commissionRuleId,
            Long payoutId,
            Long reversesEntryId,
            String status,
            Long amountMinor,
            String currency,
            LocalDate enteredOn,
            LocalDateTime createdAt,
            boolean reversal) {
    }

    public record EarningsPage(long total, long netMinor, String currency,
                               List<EarningsEntry> items) {
    }

    private final ScopedQueries scoped;
    private final AuditService auditService;
    private final com.coeso.roster.plan.PlanLimitService planLimits;
    private final CommissionRulesService rules;
    private final MembershipRepository memberships;

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    public LedgerService(ScopedQueries scoped, AuditService auditService,
                         com.coeso.roster.plan.PlanLimitService planLimits,
                         CommissionRulesService rules, MembershipRepository memberships) {
        this.scoped = scoped;
        this.auditService = auditService;
        this.planLimits = planLimits;
        this.rules = rules;
        this.memberships = memberships;
    }

    // --------------------------------------------------------------- accrual

    /**
     * Brings the ledger in line with the current revenue entry: no row yet →
     * accrue; changed → reverse-and-re-accrue; unchanged → no-op. Called from
     * the activity service inside the same transaction, so a paid-earnings
     * conflict rolls the whole edit back.
     */
    public void reconcile(ActivityEntry entry, Placement placement, MetricType metric) {
        LedgerEntry current = currentAccrual(entry.getId());

        if (metric.getUnit() != MetricType.Unit.CURRENCY) {
            if (current != null) {
                reverse(current, entry);
            }
            return;
        }

        long computed;
        Long ruleId = null;
        String currency = null;
        var rule = rules.resolve(placement.getOfferId(), entry.getRepId());
        if (rule.isPresent()) {
            CommissionRule resolved = rule.get();
            ruleId = resolved.getId();
            currency = resolved.getCurrency();
            computed = computeFor(resolved, entry.getValueMinor());
        } else {
            computed = 0; // no terms configured → nothing owed
        }

        if (current == null) {
            if (computed > 0) {
                accrue(entry, placement, ruleId, computed, currency);
            }
            return;
        }

        boolean unchanged = current.getAmountMinor() == computed
                && java.util.Objects.equals(current.getCommissionRuleId(), ruleId)
                && (currency == null || currency.equals(current.getCurrency()))
                && current.getEnteredOn().equals(entry.getOccurredOn());
        if (unchanged) {
            return;
        }
        reverse(current, entry);
        if (computed > 0) {
            accrue(entry, placement, ruleId, computed, currency);
        }
    }

    /** Blocks deleting a revenue entry that already produced earnings. */
    public void assertNoEarnings(Long activityEntryId) {
        long rows = entityManager
                .createQuery("select count(l) from LedgerEntry l"
                        + " where l.activityEntryId = :id", Long.class)
                .setParameter("id", activityEntryId)
                .getSingleResult();
        if (rows > 0) {
            throw new ConflictException(
                    "This entry already produced earnings; edit it to issue a "
                            + "correction instead of deleting it");
        }
    }

    private long computeFor(CommissionRule rule, long revenueMinor) {
        return switch (rule.getKind()) {
            case PERCENT -> CommissionMath.computePercent(revenueMinor, rule.getRateBp());
            case FLAT -> CommissionMath.computeFlat(rule.getFlatMinor());
            case TIERED -> CommissionMath.computeTiered(revenueMinor, rules.readTiers(rule));
        };
    }

    private LedgerEntry currentAccrual(Long activityEntryId) {
        List<LedgerEntry> rows = entityManager
                .createQuery("select l from LedgerEntry l"
                        + " where l.activityEntryId = :id and l.reversesEntryId is null"
                        + " order by l.id desc", LedgerEntry.class)
                .setParameter("id", activityEntryId)
                .setMaxResults(1)
                .getResultList();
        return rows.isEmpty() ? null : rows.get(0);
    }

    private void accrue(ActivityEntry entry, Placement placement, Long ruleId,
                        long amount, String currency) {
        LedgerEntry row = new LedgerEntry();
        row.setWorkspaceId(TenantContext.requireWorkspaceId());
        row.setPlacementId(placement.getId());
        row.setRepId(entry.getRepId());
        row.setActivityEntryId(entry.getId());
        row.setCommissionRuleId(ruleId);
        row.setStatus(LedgerEntry.Status.ACCRUED);
        row.setAmountMinor(amount);
        row.setCurrency(currency == null ? "USD" : currency);
        row.setEnteredOn(entry.getOccurredOn());
        entityManager.persist(row);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_CREATE, "ledger_entry", row.getId(),
                Map.of("amountMinor", row.getAmountMinor(),
                        "currency", row.getCurrency(),
                        "repId", row.getRepId(),
                        "activityEntryId", entry.getId()));
    }

    private void reverse(LedgerEntry current, ActivityEntry entry) {
        if (current.getStatus() == LedgerEntry.Status.PAID) {
            throw new ConflictException(
                    "Earnings of " + current.getAmountMinor() + " " + current.getCurrency()
                            + " minor units were already paid — paid entries cannot be "
                            + "reversed; fix future logging instead");
        }
        LedgerEntry reversal = new LedgerEntry();
        reversal.setWorkspaceId(TenantContext.requireWorkspaceId());
        reversal.setPlacementId(current.getPlacementId());
        reversal.setRepId(current.getRepId());
        reversal.setActivityEntryId(current.getActivityEntryId());
        reversal.setCommissionRuleId(current.getCommissionRuleId());
        reversal.setReversesEntryId(current.getId());
        reversal.setStatus(current.getStatus()); // approvals net out
        reversal.setAmountMinor(-current.getAmountMinor());
        reversal.setCurrency(current.getCurrency());
        reversal.setEnteredOn(entry.getOccurredOn());
        entityManager.persist(reversal);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_UPDATE, "ledger_entry", current.getId(),
                Map.of("reversal", true,
                        "reversedAmountMinor", current.getAmountMinor(),
                        "reason", "activity entry corrected"));
    }

    // ------------------------------------------------------------------ read

    public EarningsPage earnings(EarningsQuery query) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "earnings ledger");

        StringBuilder where = new StringBuilder(" where l.workspaceId = :workspaceId");
        Map<String, Object> params = new HashMap<>();
        params.put("workspaceId", workspaceId);

        // Reps: only ever their own rows (server-side, never trusted input).
        Long effectiveRepId = query.repId();
        if (TenantContext.role() != null && !TenantContext.role().atLeast(
                com.coeso.roster.common.WorkspaceRole.MANAGER)) {
            Long ownRepId = callerRepId(workspaceId);
            if (ownRepId == null) {
                return new EarningsPage(0, 0, null, List.of());
            }
            if (effectiveRepId != null && !ownRepId.equals(effectiveRepId)) {
                throw new ForbiddenException("Reps may only view their own earnings");
            }
            effectiveRepId = ownRepId;
        }
        if (effectiveRepId != null) {
            where.append(" and l.repId = :repId");
            params.put("repId", effectiveRepId);
        }
        if (query.status() != null && !query.status().isBlank()) {
            LedgerEntry.Status status;
            try {
                status = LedgerEntry.Status.valueOf(
                        query.status().trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                throw new BadRequestException("status must be accrued, approved or paid");
            }
            where.append(" and l.status = :status");
            params.put("status", status);
        }
        if (query.from() != null) {
            where.append(" and l.enteredOn >= :from");
            params.put("from", query.from());
        }
        if (query.to() != null) {
            where.append(" and l.enteredOn <= :to");
            params.put("to", query.to());
        }

        long total = countWhere(where.toString(), params);
        Object net = netWhere(where.toString(), params);
        List<LedgerEntry> rows = listWhere(where.toString(), params);

        Map<Long, String> repNames = repNames(rows.stream()
                .map(LedgerEntry::getRepId).distinct().toList());
        Map<Long, PlacementInfo> placements = placementInfo(rows.stream()
                .map(LedgerEntry::getPlacementId).distinct().toList());

        List<EarningsEntry> items = new ArrayList<>();
        String currency = null;
        for (LedgerEntry row : rows) {
            currency = row.getCurrency();
            PlacementInfo info = placements.get(row.getPlacementId());
            items.add(new EarningsEntry(
                    row.getId(), row.getRepId(), repNames.get(row.getRepId()),
                    row.getPlacementId(),
                    info == null ? null : info.offerId,
                    info == null ? null : info.offerTitle,
                    row.getActivityEntryId(), row.getCommissionRuleId(),
                    row.getPayoutId(), row.getReversesEntryId(),
                    row.getStatus().name().toLowerCase(Locale.ROOT),
                    row.getAmountMinor(), row.getCurrency(), row.getEnteredOn(),
                    row.getCreatedAt(), row.isReversal()));
        }
        return new EarningsPage(total, ((Number) net).longValue(), currency, items);
    }

    // ------------------------------------------------------------------ write

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public EarningsEntry approve(Long id) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "earnings ledger");
        LedgerEntry entry = scoped.require(LedgerEntry.class, id, "Earnings entry");
        if (entry.getStatus() == LedgerEntry.Status.APPROVED) {
            throw new ConflictException("Entry is already approved");
        }
        if (entry.getStatus() == LedgerEntry.Status.PAID) {
            throw new ConflictException("Paid entries cannot be re-approved");
        }
        entry.setStatus(LedgerEntry.Status.APPROVED);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_UPDATE, "ledger_entry", entry.getId(),
                Map.of("status", "approved"));
        return earningsQueryEntry(entry);
    }

    private EarningsEntry earningsQueryEntry(LedgerEntry row) {
        Map<Long, String> names = repNames(List.of(row.getRepId()));
        PlacementInfo info = placementInfo(List.of(row.getPlacementId()))
                .get(row.getPlacementId());
        return new EarningsEntry(
                row.getId(), row.getRepId(), names.get(row.getRepId()),
                row.getPlacementId(), info == null ? null : info.offerId,
                info == null ? null : info.offerTitle,
                row.getActivityEntryId(), row.getCommissionRuleId(), row.getPayoutId(),
                row.getReversesEntryId(),
                row.getStatus().name().toLowerCase(Locale.ROOT),
                row.getAmountMinor(), row.getCurrency(), row.getEnteredOn(),
                row.getCreatedAt(), row.isReversal());
    }

    // --------------------------------------------------------------- helpers

    private long countWhere(String where, Map<String, Object> params) {
        var query = entityManager.createQuery(
                "select count(l) from LedgerEntry l" + where, Long.class);
        params.forEach(query::setParameter);
        return query.getSingleResult();
    }

    private long netWhere(String where, Map<String, Object> params) {
        var query = entityManager.createQuery(
                "select coalesce(sum(l.amountMinor), 0) from LedgerEntry l" + where,
                Long.class);
        params.forEach(query::setParameter);
        return query.getSingleResult();
    }

    private List<LedgerEntry> listWhere(String where, Map<String, Object> params) {
        var query = entityManager.createQuery(
                "select l from LedgerEntry l" + where
                        + " order by l.enteredOn desc, l.id desc", LedgerEntry.class);
        params.forEach(query::setParameter);
        return query.setMaxResults(500).getResultList();
    }

    /** The rep linked to the caller's membership (null when not linked). */
    public Long callerRepId(Long workspaceId) {
        Long userId = TenantContext.actorUserId();
        if (userId == null) {
            return null;
        }
        return memberships.findByUserIdAndWorkspaceId(userId, workspaceId)
                .map(com.coeso.roster.entity.Membership::getRepId)
                .orElse(null);
    }

    private record PlacementInfo(Long offerId, String offerTitle) {
    }

    private Map<Long, String> repNames(List<Long> repIds) {
        Map<Long, String> names = new HashMap<>();
        if (repIds.isEmpty()) {
            return names;
        }
        for (Object[] row : entityManager
                .createQuery("select r.id, r.name from Rep r where r.id in :ids", Object[].class)
                .setParameter("ids", repIds)
                .getResultList()) {
            names.put((Long) row[0], (String) row[1]);
        }
        return names;
    }

    private Map<Long, PlacementInfo> placementInfo(List<Long> placementIds) {
        Map<Long, PlacementInfo> info = new HashMap<>();
        if (placementIds.isEmpty()) {
            return info;
        }
        for (Object[] row : entityManager
                .createQuery("select p.id, p.offerId, p.offer.title from Placement p"
                        + " where p.id in :ids", Object[].class)
                .setParameter("ids", placementIds)
                .getResultList()) {
            info.put((Long) row[0],
                    new PlacementInfo((Long) row[1], (String) row[2]));
        }
        return info;
    }
}