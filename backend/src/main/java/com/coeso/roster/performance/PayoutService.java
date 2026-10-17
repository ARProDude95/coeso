package com.coeso.roster.performance;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.LedgerEntry;
import com.coeso.roster.entity.Payout;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Payouts [PRO] — manager+ records that a batch of <em>approved</em> ledger
 * entries was paid (no real money moves): one payout per rep, paid date and
 * reference note, entries flip to 'paid' and link the payout. CSV export for
 * the payment run.
 */
@Service
public class PayoutService {

    public record PayoutRequest(
            @NotEmpty List<Long> entryIds,
            @NotNull LocalDate paidOn,
            String referenceNote) {
    }

    public record PayoutResponse(
            Long id,
            Long repId,
            String repName,
            Long amountMinor,
            String currency,
            int entryCount,
            LocalDate paidOn,
            String referenceNote,
            Long createdBy,
            LocalDateTime createdAt) {
    }

    private final ScopedQueries scoped;
    private final AuditService auditService;
    private final com.coeso.roster.plan.PlanLimitService planLimits;

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    public PayoutService(ScopedQueries scoped, AuditService auditService,
                         com.coeso.roster.plan.PlanLimitService planLimits) {
        this.scoped = scoped;
        this.auditService = auditService;
        this.planLimits = planLimits;
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public PayoutResponse create(@Valid PayoutRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "payouts");

        Set<Long> ids = new LinkedHashSet<>(request.entryIds());
        if (ids.size() != request.entryIds().size()) {
            throw new BadRequestException("entryIds contains duplicates");
        }
        List<LedgerEntry> entries = new ArrayList<>();
        for (Long id : ids) {
            entries.add(scoped.require(LedgerEntry.class, id, "Earnings entry"));
        }

        Long repId = entries.get(0).getRepId();
        String currency = entries.get(0).getCurrency();
        long total = 0;
        for (LedgerEntry entry : entries) {
            if (!entry.getRepId().equals(repId)) {
                throw new ConflictException(
                        "A payout batches one rep's entries — split this batch by rep");
            }
            if (!entry.getCurrency().equals(currency)) {
                throw new BadRequestException(
                        "A payout cannot mix currencies (" + currency + " and "
                                + entry.getCurrency() + ")");
            }
            if (entry.getPayoutId() != null) {
                throw new ConflictException(
                        "Entry " + entry.getId() + " was already paid out");
            }
            if (entry.getStatus() != LedgerEntry.Status.APPROVED) {
                throw new ConflictException(
                        "Entry " + entry.getId() + " is " + entry.getStatus().name().toLowerCase()
                                + "; only approved entries can be paid out");
            }
            total += entry.getAmountMinor();
        }

        Payout payout = new Payout();
        payout.setWorkspaceId(workspaceId);
        payout.setRepId(repId);
        payout.setAmountMinor(total);
        payout.setCurrency(currency);
        payout.setEntryCount(entries.size());
        payout.setPaidOn(request.paidOn());
        payout.setReferenceNote(request.referenceNote());
        payout.setCreatedBy(TenantContext.actorUserId());
        entityManager.persist(payout);
        entityManager.flush();

        for (LedgerEntry entry : entries) {
            entry.setPayoutId(payout.getId());
            entry.setStatus(LedgerEntry.Status.PAID);
            auditService.record(AuditLog.ACTION_UPDATE, "ledger_entry", entry.getId(),
                    Map.of("status", "paid", "payoutId", payout.getId()));
        }
        entityManager.flush();

        auditService.record(AuditLog.ACTION_CREATE, "payout", payout.getId(),
                Map.of("repId", repId,
                        "amountMinor", total,
                        "currency", currency,
                        "entryCount", entries.size(),
                        "paidOn", payout.getPaidOn().toString()));
        return toResponse(payout, null);
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public List<PayoutResponse> list() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "payouts");
        List<Payout> payouts = entityManager
                .createQuery("select p from Payout p"
                        + " order by p.paidOn desc, p.id desc", Payout.class)
                .getResultList();
        Map<Long, String> repNames = new HashMap<>();
        if (!payouts.isEmpty()) {
            List<Long> repIds = payouts.stream().map(Payout::getRepId).distinct().toList();
            for (Object[] row : entityManager
                    .createQuery("select r.id, r.name from Rep r where r.id in :ids",
                            Object[].class)
                    .setParameter("ids", repIds)
                    .getResultList()) {
                repNames.put((Long) row[0], (String) row[1]);
            }
        }
        List<PayoutResponse> responses = new ArrayList<>();
        for (Payout payout : payouts) {
            responses.add(toResponse(payout, repNames.get(payout.getRepId())));
        }
        return responses;
    }

    /** CSV in integer minor units — same round-trip spirit as the roster export. */
    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public String exportCsv() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "payouts");
        List<PayoutResponse> payouts = list();
        StringBuilder csv = new StringBuilder(
                "id,rep,paid_on,entries,amount_minor,currency,reference\n");
        for (PayoutResponse payout : payouts) {
            csv.append(cell(String.valueOf(payout.id()))).append(',')
                    .append(cell(payout.repName())).append(',')
                    .append(cell(payout.paidOn().toString())).append(',')
                    .append(payout.entryCount()).append(',')
                    .append(payout.amountMinor()).append(',')
                    .append(cell(payout.currency())).append(',')
                    .append(cell(payout.referenceNote()))
                    .append("\r\n");
        }
        return csv.toString();
    }

    private static PayoutResponse toResponse(Payout payout, String repName) {
        return new PayoutResponse(
                payout.getId(), payout.getRepId(), repName,
                payout.getAmountMinor(), payout.getCurrency(), payout.getEntryCount(),
                payout.getPaidOn(), payout.getReferenceNote(), payout.getCreatedBy(),
                payout.getCreatedAt());
    }

    /** RFC-4180 cell (same rule as the roster export). */
    private static String cell(String value) {
        if (value == null) {
            return "";
        }
        boolean quote = value.contains(",") || value.contains("\"")
                || value.contains("\n") || value.contains("\r");
        String escaped = value.replace("\"", "\"\"");
        return quote ? "\"" + escaped + "\"" : escaped;
    }
}