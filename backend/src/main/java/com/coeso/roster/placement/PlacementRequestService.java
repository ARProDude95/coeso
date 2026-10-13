package com.coeso.roster.placement;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.auth.CurrentUser;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ForbiddenException;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.OfferStatus;
import com.coeso.roster.entity.PlacementRequest;
import com.coeso.roster.entity.PlacementRequestStatus;
import com.coeso.roster.discord.DiscordNotifier;
import com.coeso.roster.entity.Rep;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Placement requests: a rep asks to join an offer; a manager approves or
 * declines.
 *
 * <p>Approval goes through {@link PlacementService#place}, i.e. the exact same
 * transactional code path as a direct placement — the offer row is locked,
 * open/seat/one-active-placement rules are re-checked, and the audit row is
 * written atomically. A request that can no longer be honoured (offer closed,
 * full, or the rep got placed elsewhere meanwhile) fails approval with the same
 * conflict, and the request stays pending for a retry after the situation is
 * resolved.
 */
@Service
public class PlacementRequestService {

    public record RequestBody(Long offerId, Long repId, String note) {
    }

    public record DecisionBody(String note) {
    }

    public record RequestResponse(Long id, Long offerId, String offerTitle, Long repId,
                                  String repName, String status, String note,
                                  LocalDateTime createdAt, LocalDateTime decidedAt) {
    }

    private static final Logger log = LoggerFactory.getLogger(PlacementRequestService.class);

    private final ScopedQueries scoped;
    private final PlacementService placementService;
    private final AuditService auditService;
    private final DiscordNotifier discordNotifier;

    @PersistenceContext
    private EntityManager entityManager;

    public PlacementRequestService(ScopedQueries scoped, PlacementService placementService,
                                   AuditService auditService, DiscordNotifier discordNotifier) {
        this.scoped = scoped;
        this.placementService = placementService;
        this.auditService = auditService;
        this.discordNotifier = discordNotifier;
    }

    // ------------------------------------------------------------------ create

    /**
     * Creates a request. A rep-role user may only request for the rep profile
     * linked to their membership; managers may request on behalf of any rep.
     */
    @PreAuthorize("@roles.hasAtLeast('REP')")
    public RequestResponse request(RequestBody body) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        if (body.offerId() == null) {
            throw new BadRequestException("offerId is required");
        }

        Offer offer = scoped.require(Offer.class, body.offerId(), "Offer");
        if (offer.getStatus() != OfferStatus.OPEN) {
            throw new ConflictException("Offer is closed");
        }

        Long repId = resolveRepIdFor(body.repId());
        Rep rep = scoped.require(Rep.class, repId, "Rep");
        if (rep.getDeletedAt() != null) {
            throw new NotFoundException("Rep " + repId + " not found");
        }

        // The rep must not already be placed, and must not have a pending
        // request for the same offer.
        long activePlacements = entityManager
                .createQuery("select count(p) from Placement p"
                        + " where p.workspaceId = :ws and p.repId = :repId"
                        + " and p.status = com.coeso.roster.entity.PlacementStatus.ACTIVE",
                        Long.class)
                .setParameter("ws", workspaceId)
                .setParameter("repId", repId)
                .getSingleResult();
        if (activePlacements > 0) {
            throw new ConflictException("Rep already has an active placement");
        }
        long pending = entityManager
                .createQuery("select count(r) from PlacementRequest r"
                        + " where r.workspaceId = :ws and r.repId = :repId"
                        + " and r.offerId = :offerId"
                        + " and r.status = com.coeso.roster.entity.PlacementRequestStatus.PENDING",
                        Long.class)
                .setParameter("ws", workspaceId)
                .setParameter("repId", repId)
                .setParameter("offerId", offer.getId())
                .getSingleResult();
        if (pending > 0) {
            throw new ConflictException("A pending request for this rep and offer already exists");
        }

        PlacementRequest request = new PlacementRequest();
        request.setWorkspaceId(workspaceId);
        request.setOfferId(offer.getId());
        request.setOffer(offer);
        request.setRepId(rep.getId());
        request.setRep(rep);
        request.setRequestedBy(CurrentUser.id());
        request.setStatus(PlacementRequestStatus.PENDING);
        if (body.note() != null && !body.note().isBlank()) {
            request.setNote(body.note().trim());
        }
        entityManager.persist(request);
        entityManager.flush();

        auditService.record(AuditLog.ACTION_CREATE, "placement_request", request.getId(),
                Map.of("offerId", offer.getId(), "repId", rep.getId(),
                        "offerTitle", offer.getTitle()));

        // Best-effort Discord notification; failures never fail the request.
        try {
            discordNotifier.placementRequest(workspaceId, rep.getName(), offer.getTitle());
        } catch (RuntimeException e) {
            log.warn("Discord placement-request notification failed: {}", e.toString());
        }
        return toResponse(request);
    }

    // -------------------------------------------------------------------- list

    /** Pending queue for managers; a rep sees only their own requests. */
    @PreAuthorize("@roles.hasAtLeast('REP')")
    public List<RequestResponse> list(String status) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        PlacementRequestStatus parsed = parseStatus(status);

        StringBuilder where = new StringBuilder(" where r.workspaceId = :ws");
        if (TenantContext.role() == WorkspaceRole.REP) {
            Long repId = requireOwnRepId();
            where.append(" and r.repId = :repId");
            var query = entityManager.createQuery(
                    "select r from PlacementRequest r" + where + " order by r.id desc",
                    PlacementRequest.class);
            query.setParameter("ws", workspaceId).setParameter("repId", repId);
            return query.getResultList().stream().map(this::toResponse).toList();
        }

        if (parsed != null) {
            where.append(" and r.status = :status");
        }
        var query = entityManager.createQuery(
                "select r from PlacementRequest r" + where + " order by r.id desc",
                PlacementRequest.class);
        query.setParameter("ws", workspaceId);
        if (parsed != null) {
            query.setParameter("status", parsed);
        }
        return query.getResultList().stream().map(this::toResponse).toList();
    }

    // ----------------------------------------------------------------- approve

    /** Approves by placing through the standard transactional path. */
    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public RequestResponse approve(Long id, DecisionBody body) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        PlacementRequest request = requirePending(id, workspaceId);

        placementService.place(new PlacementService.PlaceRequest(
                request.getOfferId(), request.getRepId()));

        request.setStatus(PlacementRequestStatus.APPROVED);
        request.setDecidedBy(TenantContext.actorUserId());
        request.setDecidedAt(LocalDateTime.now());
        if (body != null && body.note() != null && !body.note().isBlank()) {
            request.setNote(body.note().trim());
        }
        entityManager.flush();

        auditService.record(AuditLog.ACTION_UPDATE, "placement_request", request.getId(),
                Map.of("decision", "APPROVED", "offerId", request.getOfferId(),
                        "repId", request.getRepId()));
        return toResponse(request);
    }

    // ------------------------------------------------------------------ decline

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public RequestResponse decline(Long id, DecisionBody body) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        PlacementRequest request = requirePending(id, workspaceId);

        request.setStatus(PlacementRequestStatus.DECLINED);
        request.setDecidedBy(TenantContext.actorUserId());
        request.setDecidedAt(LocalDateTime.now());
        if (body != null && body.note() != null && !body.note().isBlank()) {
            request.setNote(body.note().trim());
        }
        entityManager.flush();

        auditService.record(AuditLog.ACTION_UPDATE, "placement_request", request.getId(),
                Map.of("decision", "DECLINED", "offerId", request.getOfferId(),
                        "repId", request.getRepId()));
        return toResponse(request);
    }

    // ---------------------------------------------------------------- helpers

    /**
     * A rep-role user may only act for the rep linked to their own membership;
     * managers may act for any rep in the workspace.
     */
    private Long resolveRepIdFor(Long requestedRepId) {
        if (TenantContext.role() == WorkspaceRole.REP) {
            Long ownRepId = requireOwnRepId();
            if (requestedRepId != null && !requestedRepId.equals(ownRepId)) {
                throw new ForbiddenException(
                        "Rep-role users may only create requests for their own profile");
            }
            return ownRepId;
        }
        if (requestedRepId == null) {
            throw new BadRequestException("repId is required");
        }
        return requestedRepId;
    }

    /** The rep profile linked to the caller's membership, or 403 if unlinked. */
    private Long requireOwnRepId() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Long userId = TenantContext.actorUserId();
        return entityManager
                .createQuery("select m.repId from Membership m"
                        + " where m.workspaceId = :ws and m.userId = :userId", Long.class)
                .setParameter("ws", workspaceId)
                .setParameter("userId", userId)
                .getResultList()
                .stream()
                .filter(java.util.Objects::nonNull)
                .findFirst()
                .orElseThrow(() -> new ForbiddenException(
                        "Your membership is not linked to a rep profile"));
    }

    private PlacementRequest requirePending(Long id, Long workspaceId) {
        PlacementRequest request = scoped.require(PlacementRequest.class, id,
                "Placement request");
        if (!request.getWorkspaceId().equals(workspaceId)) {
            throw new NotFoundException("Placement request " + id + " not found");
        }
        if (request.getStatus() != PlacementRequestStatus.PENDING) {
            throw new ConflictException("Placement request is already "
                    + request.getStatus().name().toLowerCase());
        }
        return request;
    }

    private static PlacementRequestStatus parseStatus(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return PlacementRequestStatus.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("status must be PENDING, APPROVED or DECLINED");
        }
    }

    private RequestResponse toResponse(PlacementRequest request) {
        return new RequestResponse(
                request.getId(),
                request.getOfferId(),
                request.getOffer() == null ? null : request.getOffer().getTitle(),
                request.getRepId(),
                request.getRep() == null ? null : request.getRep().getName(),
                request.getStatus().name(),
                request.getNote(),
                request.getCreatedAt(),
                request.getDecidedAt());
    }
}
