package com.coeso.roster.stats;

import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.OfferStatus;
import com.coeso.roster.entity.PlacementStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Roster header statistics, all derived (never stored): total reps, bench
 * (reps without an active placement), placed reps, open offers (stored status
 * open AND active placements below seats).
 */
@Service
public class StatsService {

    public record StatsResponse(long totalReps, long benchCount, long placedCount, long openOffers) {
    }

    @PersistenceContext
    private EntityManager entityManager;

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public StatsResponse stats() {
        Long workspaceId = TenantContext.requireWorkspaceId();

        long total = entityManager
                .createQuery("select count(r) from Rep r"
                        + " where r.workspaceId = :workspaceId and r.deletedAt is null", Long.class)
                .setParameter("workspaceId", workspaceId)
                .getSingleResult();

        long placed = entityManager
                .createQuery("select count(r) from Rep r"
                        + " where r.workspaceId = :workspaceId and r.deletedAt is null"
                        + " and exists (select p from Placement p"
                        + " where p.repId = r.id and p.status = :activeStatus)", Long.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("activeStatus", PlacementStatus.ACTIVE)
                .getSingleResult();

        long openOffers = entityManager
                .createQuery("select count(o) from Offer o"
                        + " where o.workspaceId = :workspaceId and o.status = :openStatus"
                        + " and (select count(p) from Placement p"
                        + "      where p.offerId = o.id and p.status = :activeStatus) < o.seats",
                        Long.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("openStatus", OfferStatus.OPEN)
                .setParameter("activeStatus", PlacementStatus.ACTIVE)
                .getSingleResult();

        long bench = total - placed;
        return new StatsResponse(total, bench, placed, openOffers);
    }
}
