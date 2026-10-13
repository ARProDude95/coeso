package com.coeso.roster.rep;

import com.coeso.roster.common.ForbiddenException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.OfferStatus;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.entity.PlacementStatus;
import com.coeso.roster.entity.Rep;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Rep portal: a rep-role user linked to a rep profile sees only their own
 * profile, their own active placement and the workspace's open offers — never
 * the full roster, other reps, closed offers or other people's placements.
 *
 * <p>The linkage comes from {@code memberships.rep_id}; a rep-role membership
 * without that link can see nothing (403), and the rep id is resolved from the
 * membership, never from the request.
 */
@Service
public class RepPortalService {

    public record MyRepResponse(Long id, String name, String email, String notes,
                                String verticalName, String statusName, String statusKind,
                                String experienceLevelName, java.time.LocalDate joinedDate) {
    }

    public record MyPlacementResponse(Long id, Long offerId, String offerTitle,
                                      String clientName, String placedAt) {
    }

    public record OpenOfferResponse(Long id, String title, String clientName,
                                    String verticalName, int seats, int filledSeats,
                                    boolean requested) {
    }

    private final ScopedQueries scoped;

    @PersistenceContext
    private EntityManager entityManager;

    public RepPortalService(ScopedQueries scoped) {
        this.scoped = scoped;
    }

    /** The caller's own rep profile, or 403 when the membership is unlinked. */
    @PreAuthorize("@roles.hasAtLeast('REP')")
    public MyRepResponse me() {
        Rep rep = requireOwnRep();
        return new MyRepResponse(
                rep.getId(),
                rep.getName(),
                rep.getEmail(),
                rep.getNotes(),
                rep.getVertical() == null ? null : rep.getVertical().getName(),
                rep.getStatus() == null ? null : rep.getStatus().getName(),
                rep.getStatus() == null ? null : rep.getStatus().getKind().name(),
                rep.getExperienceLevel() == null ? null : rep.getExperienceLevel().getName(),
                rep.getJoinedDate());
    }

    /** The caller's active placement, or null when on bench. */
    @PreAuthorize("@roles.hasAtLeast('REP')")
    public MyPlacementResponse myPlacement() {
        Rep rep = requireOwnRep();
        List<Placement> placements = entityManager
                .createQuery("select p from Placement p"
                        + " where p.workspaceId = :ws and p.repId = :repId"
                        + " and p.status = :active", Placement.class)
                .setParameter("ws", TenantContext.requireWorkspaceId())
                .setParameter("repId", rep.getId())
                .setParameter("active", PlacementStatus.ACTIVE)
                .getResultList();
        if (placements.isEmpty()) {
            return null;
        }
        Placement placement = placements.get(0);
        Offer offer = placement.getOffer();
        return new MyPlacementResponse(
                placement.getId(),
                placement.getOfferId(),
                offer == null ? null : offer.getTitle(),
                offer == null || offer.getClient() == null ? null : offer.getClient().getName(),
                placement.getPlacedAt() == null ? null : placement.getPlacedAt().toString());
    }

    /** Open offers in the workspace (title, client, seat fill, request state). */
    @PreAuthorize("@roles.hasAtLeast('REP')")
    public List<OpenOfferResponse> openOffers() {
        Rep rep = requireOwnRep();
        Long workspaceId = TenantContext.requireWorkspaceId();

        List<Offer> offers = entityManager
                .createQuery("select o from Offer o"
                        + " left join fetch o.client"
                        + " left join fetch o.vertical"
                        + " where o.workspaceId = :ws and o.status = :open"
                        + " order by o.id desc", Offer.class)
                .setParameter("ws", workspaceId)
                .setParameter("open", OfferStatus.OPEN)
                .getResultList();

        // Which offers this rep already has a pending request for.
        List<Long> requestedOfferIds = entityManager
                .createQuery("select r.offerId from PlacementRequest r"
                        + " where r.workspaceId = :ws and r.repId = :repId"
                        + " and r.status = com.coeso.roster.entity.PlacementRequestStatus.PENDING",
                        Long.class)
                .setParameter("ws", workspaceId)
                .setParameter("repId", rep.getId())
                .getResultList();

        Map<Long, Long> filled = entityManager
                .createQuery("select p.offerId, count(p) from Placement p"
                        + " where p.workspaceId = :ws and p.status = :active"
                        + " group by p.offerId", Long[].class)
                .setParameter("ws", workspaceId)
                .setParameter("active", PlacementStatus.ACTIVE)
                .getResultList()
                .stream()
                .collect(java.util.stream.Collectors.toMap(
                        row -> (Long) row[0], row -> (Long) row[1]));

        return offers.stream()
                .map(o -> new OpenOfferResponse(
                        o.getId(),
                        o.getTitle(),
                        o.getClient() == null ? null : o.getClient().getName(),
                        o.getVertical() == null ? null : o.getVertical().getName(),
                        o.getSeats(),
                        filled.getOrDefault(o.getId(), 0L).intValue(),
                        requestedOfferIds.contains(o.getId())))
                .toList();
    }

    // ---------------------------------------------------------------- helpers

    private Rep requireOwnRep() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Long userId = TenantContext.actorUserId();
        Long repId = entityManager
                .createQuery("select m.repId from Membership m"
                        + " where m.workspaceId = :ws and m.userId = :userId", Long.class)
                .setParameter("ws", workspaceId)
                .setParameter("userId", userId)
                .getResultList()
                .stream()
                .filter(Objects::nonNull)
                .findFirst()
                .orElseThrow(() -> new ForbiddenException(
                        "Your membership is not linked to a rep profile"));
        Rep rep = scoped.require(Rep.class, repId, "Rep");
        if (rep.getDeletedAt() != null) {
            throw new ForbiddenException("Your rep profile has been removed");
        }
        return rep;
    }
}
