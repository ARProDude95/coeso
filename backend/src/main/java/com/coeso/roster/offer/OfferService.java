package com.coeso.roster.offer;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.Client;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.OfferStatus;
import com.coeso.roster.entity.PlacementStatus;
import com.coeso.roster.entity.Vertical;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import com.coeso.roster.discord.DiscordNotifier;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Offer CRUD. The stored status is only open/closed; the effective status
 * (OPEN / FILLED / CLOSED) is derived from active placements vs seats at query
 * time and never persisted.
 */
@Service
public class OfferService {

    public record OfferRequest(
            @NotNull Long clientId,
            Long verticalId,
            @NotBlank String title,
            @Min(1) Integer seats,
            String notes,
            LocalDate opensAt,
            LocalDate closesAt) {
    }

    public record RepChip(Long repId, String repName) {
    }

    public record OfferResponse(
            Long id,
            Long clientId,
            String clientName,
            Long verticalId,
            String verticalName,
            String title,
            Integer seats,
            int filledSeats,
            String notes,
            LocalDate opensAt,
            LocalDate closesAt,
            String status,
            String effectiveStatus,
            List<RepChip> reps) {
    }

    private static final Logger log = LoggerFactory.getLogger(OfferService.class);

    private final ScopedQueries scoped;
    private final AuditService auditService;
    private final DiscordNotifier discordNotifier;

    @PersistenceContext
    private EntityManager entityManager;

    public OfferService(ScopedQueries scoped, AuditService auditService,
                        DiscordNotifier discordNotifier) {
        this.scoped = scoped;
        this.auditService = auditService;
        this.discordNotifier = discordNotifier;
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public List<OfferResponse> list(String q, Long verticalId, String effectiveStatus) {
        Long workspaceId = TenantContext.requireWorkspaceId();

        StringBuilder where = new StringBuilder(" where o.workspaceId = :workspaceId");
        Map<String, Object> params = new HashMap<>();
        params.put("workspaceId", workspaceId);

        if (q != null && !q.isBlank()) {
            where.append(" and lower(o.title) like :q");
            params.put("q", "%" + q.trim().toLowerCase() + "%");
        }
        if (verticalId != null) {
            where.append(" and o.verticalId = :verticalId");
            params.put("verticalId", verticalId);
        }
        String activeCount = "(select count(p) from Placement p"
                + " where p.offerId = o.id and p.status = :activeStatus)";
        if (effectiveStatus != null && !effectiveStatus.isBlank()) {
            switch (effectiveStatus.trim().toUpperCase()) {
                case "CLOSED" -> {
                    where.append(" and o.status = :closedStatus");
                    params.put("closedStatus", OfferStatus.CLOSED);
                }
                case "OPEN" -> {
                    where.append(" and o.status = :openStatus")
                            .append(" and ").append(activeCount).append(" < o.seats");
                    params.put("openStatus", OfferStatus.OPEN);
                    params.put("activeStatus", PlacementStatus.ACTIVE);
                }
                case "FILLED" -> {
                    where.append(" and o.status = :openStatus")
                            .append(" and ").append(activeCount).append(" >= o.seats");
                    params.put("openStatus", OfferStatus.OPEN);
                    params.put("activeStatus", PlacementStatus.ACTIVE);
                }
                default -> throw new BadRequestException(
                        "effectiveStatus must be OPEN, FILLED or CLOSED");
            }
        }

        var query = entityManager
                .createQuery("select o from Offer o"
                        + " left join fetch o.client"
                        + " left join fetch o.vertical"
                        + where + " order by o.id desc", Offer.class);
        params.forEach(query::setParameter);
        List<Offer> offers = query.getResultList();

        return assemble(offers);
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public OfferResponse create(OfferRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Offer offer = new Offer();
        offer.setWorkspaceId(workspaceId);
        offer.setStatus(OfferStatus.OPEN);
        apply(offer, request);
        entityManager.persist(offer);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_CREATE, "offer", offer.getId(),
                Map.of("title", offer.getTitle(), "seats", offer.getSeats()));

        // Best-effort Discord notification; failures never fail the request.
        try {
            discordNotifier.offerOpened(workspaceId, offer.getTitle(),
                    offer.getClient() == null ? null : offer.getClient().getName());
        } catch (RuntimeException e) {
            log.warn("Discord offer notification failed: {}", e.toString());
        }
        return assemble(List.of(offer)).get(0);
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public OfferResponse update(Long id, OfferRequest request) {
        TenantContext.requireWorkspaceId();
        Offer offer = scoped.require(Offer.class, id, "Offer");
        apply(offer, request);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_UPDATE, "offer", offer.getId(),
                Map.of("title", offer.getTitle(), "seats", offer.getSeats()));
        return assemble(List.of(offer)).get(0);
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public OfferResponse close(Long id) {
        TenantContext.requireWorkspaceId();
        Offer offer = scoped.require(Offer.class, id, "Offer");
        if (offer.getStatus() != OfferStatus.CLOSED) {
            offer.setStatus(OfferStatus.CLOSED);
            entityManager.flush();
            auditService.record(AuditLog.ACTION_UPDATE, "offer", offer.getId(),
                    Map.of("title", offer.getTitle(), "status", "CLOSED"));
        }
        return assemble(List.of(offer)).get(0);
    }

    private void apply(Offer offer, OfferRequest request) {
        String title = request.title() == null ? "" : request.title().trim();
        if (title.isEmpty()) {
            throw new BadRequestException("Offer title is required");
        }
        if (request.seats() == null || request.seats() < 1) {
            throw new BadRequestException("seats must be at least 1");
        }
        Client client = scoped.require(Client.class, request.clientId(), "Client");
        offer.setClientId(client.getId());
        offer.setClient(client);
        if (request.verticalId() != null) {
            Vertical vertical = scoped.require(Vertical.class, request.verticalId(), "Vertical");
            offer.setVerticalId(vertical.getId());
            offer.setVertical(vertical);
        } else {
            offer.setVerticalId(null);
            offer.setVertical(null);
        }
        offer.setTitle(title);
        offer.setSeats(request.seats());
        offer.setNotes(request.notes());
        offer.setOpensAt(request.opensAt());
        offer.setClosesAt(request.closesAt());
    }

    /** Builds responses including seat fill and assigned-rep chips. */
    private List<OfferResponse> assemble(List<Offer> offers) {
        Map<Long, List<RepChip>> chips = loadChips(offers.stream().map(Offer::getId).toList());
        List<OfferResponse> responses = new ArrayList<>(offers.size());
        for (Offer offer : offers) {
            List<RepChip> assigned = chips.getOrDefault(offer.getId(), List.of());
            int filled = assigned.size();
            String effective = offer.getStatus() == OfferStatus.CLOSED
                    ? "CLOSED"
                    : (filled >= offer.getSeats() ? "FILLED" : "OPEN");
            responses.add(new OfferResponse(
                    offer.getId(),
                    offer.getClientId(),
                    offer.getClient() == null ? null : offer.getClient().getName(),
                    offer.getVerticalId(),
                    offer.getVertical() == null ? null : offer.getVertical().getName(),
                    offer.getTitle(),
                    offer.getSeats(),
                    filled,
                    offer.getNotes(),
                    offer.getOpensAt(),
                    offer.getClosesAt(),
                    offer.getStatus().name(),
                    effective,
                    assigned));
        }
        return responses;
    }

    private Map<Long, List<RepChip>> loadChips(List<Long> offerIds) {
        Map<Long, List<RepChip>> result = new HashMap<>();
        if (offerIds.isEmpty()) {
            return result;
        }
        List<Object[]> rows = entityManager
                .createQuery("select p.offerId, p.repId, p.rep.name from Placement p"
                        + " where p.status = :activeStatus and p.offerId in :offerIds"
                        + " order by p.placedAt asc", Object[].class)
                .setParameter("activeStatus", PlacementStatus.ACTIVE)
                .setParameter("offerIds", offerIds)
                .getResultList();
        for (Object[] row : rows) {
            result.computeIfAbsent((Long) row[0], k -> new ArrayList<>())
                    .add(new RepChip((Long) row[1], (String) row[2]));
        }
        return result;
    }
}
