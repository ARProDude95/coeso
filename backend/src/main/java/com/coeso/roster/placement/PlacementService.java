package com.coeso.roster.placement;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.OfferStatus;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.entity.PlacementStatus;
import com.coeso.roster.entity.Rep;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import com.coeso.roster.discord.DiscordNotifier;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Placement rules, all inside one transaction (the service-layer transaction is
 * provided by TenantAspect):
 *
 * <ol>
 *   <li>The offer row is locked with SELECT ... FOR UPDATE first.</li>
 *   <li>The offer must be open (stored status) and have a free seat.</li>
 *   <li>The rep must have no active placement (also enforced by the database
 *       unique key on (workspace_id, active_rep_id)).</li>
 *   <li>On success a placement row plus an audit row are written atomically.</li>
 * </ol>
 *
 * With READ COMMITTED isolation (set on the service transaction), two threads
 * racing for the last seat serialize on the row lock and the second one sees
 * the committed seat: exactly one succeeds.
 */
@Service
public class PlacementService {

    public record PlaceRequest(@NotNull Long offerId, @NotNull Long repId) {
    }

    public record EndRequest(String reason) {
    }

    public record PlacementResponse(
            Long id,
            Long offerId,
            String offerTitle,
            Long repId,
            String repName,
            String status,
            LocalDateTime placedAt,
            LocalDateTime endedAt,
            String endReason) {
    }

    private static final Logger log = LoggerFactory.getLogger(PlacementService.class);

    private final ScopedQueries scoped;
    private final AuditService auditService;
    private final DiscordNotifier discordNotifier;

    @PersistenceContext
    private EntityManager entityManager;

    public PlacementService(ScopedQueries scoped, AuditService auditService,
                            DiscordNotifier discordNotifier) {
        this.scoped = scoped;
        this.auditService = auditService;
        this.discordNotifier = discordNotifier;
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public PlacementResponse place(PlaceRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();

        // 1) Lock the offer row for this workspace (filter narrows the WHERE, so
        //    a foreign workspace's row can never be locked or touched).
        Offer offer = entityManager
                .createQuery("select o from Offer o"
                        + " where o.id = :id and o.workspaceId = :workspaceId", Offer.class)
                .setParameter("id", request.offerId())
                .setParameter("workspaceId", workspaceId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList()
                .stream().findFirst()
                .orElseThrow(() -> new NotFoundException("Offer " + request.offerId() + " not found"));

        if (offer.getStatus() != OfferStatus.OPEN) {
            throw new ConflictException("Offer is closed");
        }

        // 2) Free seat check (runs after the lock is held).
        long activePlacements = countActiveByOffer(offer.getId());
        if (activePlacements >= offer.getSeats()) {
            throw new ConflictException(
                    "Offer is full (" + activePlacements + "/" + offer.getSeats() + " seats filled)");
        }

        // 3) Rep must exist in this workspace and have no active placement.
        Rep rep = scoped.require(Rep.class, request.repId(), "Rep");
        if (rep.getDeletedAt() != null) {
            throw new NotFoundException("Rep " + request.repId() + " not found");
        }
        long existingActive = entityManager
                .createQuery("select count(p) from Placement p"
                        + " where p.workspaceId = :workspaceId and p.repId = :repId"
                        + " and p.status = :activeStatus", Long.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("repId", rep.getId())
                .setParameter("activeStatus", PlacementStatus.ACTIVE)
                .getSingleResult();
        if (existingActive > 0) {
            throw new ConflictException("Rep already has an active placement");
        }

        // 4) Insert placement + audit in this same transaction.
        Placement placement = new Placement();
        placement.setWorkspaceId(workspaceId);
        placement.setOfferId(offer.getId());
        placement.setOffer(offer);
        placement.setRepId(rep.getId());
        placement.setRep(rep);
        placement.setStatus(PlacementStatus.ACTIVE);
        placement.setPlacedAt(LocalDateTime.now());
        placement.setPlacedBy(TenantContext.actorUserId());
        entityManager.persist(placement);
        entityManager.flush();

        auditService.record(AuditLog.ACTION_PLACE, "placement", placement.getId(),
                Map.of("offerId", offer.getId(), "repId", rep.getId(),
                        "offerTitle", offer.getTitle(), "repName", rep.getName()));

        // Best-effort Discord notification: a broken bot must never fail the
        // placement (the audit row and placement already committed together).
        try {
            discordNotifier.repPlaced(workspaceId, rep.getName(), offer.getTitle());
        } catch (RuntimeException e) {
            log.warn("Discord placement notification failed: {}", e.toString());
        }

        return toResponse(placement, offer.getTitle(), rep.getName());
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public PlacementResponse end(Long id, EndRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Placement placement = scoped.require(Placement.class, id, "Placement");
        if (placement.getStatus() == PlacementStatus.ENDED) {
            throw new ConflictException("Placement is already ended");
        }
        placement.setStatus(PlacementStatus.ENDED);
        placement.setEndedAt(LocalDateTime.now());
        if (request != null && request.reason() != null && !request.reason().isBlank()) {
            placement.setEndReason(request.reason().trim());
        }
        entityManager.flush();

        auditService.record(AuditLog.ACTION_UNPLACE, "placement", placement.getId(),
                Map.of("offerId", placement.getOfferId(), "repId", placement.getRepId(),
                        "reason", placement.getEndReason() == null ? "" : placement.getEndReason()));
        return toResponse(placement,
                placement.getOffer() == null ? null : placement.getOffer().getTitle(),
                placement.getRep() == null ? null : placement.getRep().getName());
    }

    /** List by offer or by rep (at least one filter is required). */
    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public List<PlacementResponse> list(Long offerId, Long repId) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        if (offerId == null && repId == null) {
            throw new BadRequestException("offerId or repId query parameter is required");
        }
        StringBuilder where = new StringBuilder(" where p.workspaceId = :workspaceId");
        if (offerId != null) {
            where.append(" and p.offerId = :offerId");
        }
        if (repId != null) {
            where.append(" and p.repId = :repId");
        }
        var query = entityManager
                .createQuery("select p from Placement p" + where + " order by p.placedAt desc",
                        Placement.class)
                .setParameter("workspaceId", workspaceId);
        if (offerId != null) {
            query.setParameter("offerId", offerId);
        }
        if (repId != null) {
            query.setParameter("repId", repId);
        }
        List<PlacementResponse> responses = new ArrayList<>();
        for (Placement placement : query.getResultList()) {
            responses.add(toResponse(placement,
                    placement.getOffer() == null ? null : placement.getOffer().getTitle(),
                    placement.getRep() == null ? null : placement.getRep().getName()));
        }
        return responses;
    }

    private long countActiveByOffer(Long offerId) {
        return entityManager
                .createQuery("select count(p) from Placement p"
                        + " where p.offerId = :offerId and p.status = :activeStatus", Long.class)
                .setParameter("offerId", offerId)
                .setParameter("activeStatus", PlacementStatus.ACTIVE)
                .getSingleResult();
    }

    private static PlacementResponse toResponse(Placement placement, String offerTitle,
                                                String repName) {
        return new PlacementResponse(
                placement.getId(),
                placement.getOfferId(),
                offerTitle,
                placement.getRepId(),
                repName,
                placement.getStatus().name(),
                placement.getPlacedAt(),
                placement.getEndedAt(),
                placement.getEndReason());
    }
}
