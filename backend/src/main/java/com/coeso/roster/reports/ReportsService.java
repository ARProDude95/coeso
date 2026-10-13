package com.coeso.roster.reports;

import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.entity.PlacementStatus;
import com.coeso.roster.entity.Rep;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Workspace analytics computed from placements and the audit trail:
 * placement rate, average bench time, placements per offer and a per-vertical
 * breakdown. Managers and above only; every query is scoped to the current
 * workspace by the Hibernate filter plus an explicit workspaceId predicate.
 *
 * <p>Bench time is the gap between an ended placement and the rep's next
 * placement; reps still on the bench contribute from their last ended
 * placement (or joined date) until now.
 */
@Service
public class ReportsService {

    public record PlacementRate(int placedReps, int totalReps, double rate) {
    }

    public record OfferPlacements(Long offerId, String title, String clientName,
                                  int totalPlacements, int activePlacements) {
    }

    public record VerticalBreakdown(Long verticalId, String name, int reps, int placedReps) {
    }

    public record ReportsResponse(PlacementRate placementRate,
                                  Double averageBenchDays,
                                  int benchSamples,
                                  List<OfferPlacements> placementsPerOffer,
                                  List<VerticalBreakdown> verticals) {
    }

    @PersistenceContext
    private EntityManager entityManager;

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public ReportsResponse reports() {
        Long workspaceId = TenantContext.requireWorkspaceId();

        // ---------------------------------------------------------- placements
        List<Placement> placements = entityManager
                .createQuery("select p from Placement p where p.workspaceId = :ws"
                        + " order by p.repId asc, p.placedAt asc", Placement.class)
                .setParameter("ws", workspaceId)
                .getResultList();

        Set<Long> placedRepIds = new HashSet<>();
        Map<Long, int[]> perOffer = new HashMap<>(); // offerId -> [total, active]
        Map<Long, List<Placement>> perRep = new HashMap<>();
        for (Placement placement : placements) {
            if (placement.getStatus() == PlacementStatus.ACTIVE) {
                placedRepIds.add(placement.getRepId());
            }
            int[] counts = perOffer.computeIfAbsent(placement.getOfferId(), k -> new int[2]);
            counts[0]++;
            if (placement.getStatus() == PlacementStatus.ACTIVE) {
                counts[1]++;
            }
            perRep.computeIfAbsent(placement.getRepId(), k -> new ArrayList<>()).add(placement);
        }

        // ---------------------------------------------------------------- reps
        List<Rep> reps = entityManager
                .createQuery("select r from Rep r where r.workspaceId = :ws"
                        + " and r.deletedAt is null", Rep.class)
                .setParameter("ws", workspaceId)
                .getResultList();
        Map<Long, Rep> repsById = new HashMap<>();
        for (Rep rep : reps) {
            repsById.put(rep.getId(), rep);
        }
        // A rep may hold placements after soft-deletion; count only live reps.
        placedRepIds.retainAll(repsById.keySet());

        int totalReps = reps.size();
        int placedReps = placedRepIds.size();
        double rate = totalReps == 0 ? 0.0
                : Math.round(placedReps * 10000.0 / totalReps) / 10000.0;

        // -------------------------------------------------------- bench timing
        long benchMillis = 0;
        int benchSamples = 0;
        LocalDateTime now = LocalDateTime.now();
        for (Map.Entry<Long, List<Placement>> entry : perRep.entrySet()) {
            Rep rep = repsById.get(entry.getKey());
            if (rep == null) {
                continue; // rep was soft-deleted: skip its history
            }
            List<Placement> history = entry.getValue();
            for (int i = 0; i < history.size(); i++) {
                Placement placement = history.get(i);
                if (placement.getStatus() != PlacementStatus.ENDED
                        || placement.getEndedAt() == null) {
                    continue;
                }
                LocalDateTime benchStart = placement.getEndedAt();
                LocalDateTime benchEnd = i + 1 < history.size()
                        ? history.get(i + 1).getPlacedAt()
                        : now;
                if (benchEnd != null && benchEnd.isAfter(benchStart)) {
                    benchMillis += ChronoUnit.MILLIS.between(benchStart, benchEnd);
                    benchSamples++;
                }
            }
        }
        // Reps that have never been placed but are on the bench since joining.
        for (Rep rep : reps) {
            if (!perRep.containsKey(rep.getId()) && rep.getJoinedDate() != null) {
                LocalDateTime benchStart = rep.getJoinedDate().atStartOfDay();
                if (now.isAfter(benchStart)) {
                    benchMillis += ChronoUnit.MILLIS.between(benchStart, now);
                    benchSamples++;
                }
            }
        }
        Double averageBenchDays = benchSamples == 0 ? null
                : Math.round(benchMillis / (double) benchSamples / 86_400_000.0 * 100.0) / 100.0;

        // ------------------------------------------------------ per-offer view
        List<OfferPlacements> perOfferList = new ArrayList<>();
        if (!perOffer.isEmpty()) {
            Map<Long, String[]> offerTitles = new HashMap<>();
            for (Object[] row : entityManager
                    .createQuery("select o.id, o.title, c.name from Offer o"
                            + " left join o.client c where o.workspaceId = :ws", Object[].class)
                    .setParameter("ws", workspaceId)
                    .getResultList()) {
                offerTitles.put((Long) row[0], new String[] {(String) row[1], (String) row[2]});
            }
            perOffer.entrySet().stream()
                    .sorted(Map.Entry.<Long, int[]>comparingByKey())
                    .forEach(entry -> {
                        String[] title = offerTitles.getOrDefault(entry.getKey(),
                                new String[] {"(deleted offer)", null});
                        perOfferList.add(new OfferPlacements(entry.getKey(), title[0], title[1],
                                entry.getValue()[0], entry.getValue()[1]));
                    });
        }

        // ------------------------------------------------------ vertical view
        Map<Long, Integer> repsPerVertical = new HashMap<>();
        Map<Long, String> verticalNames = new HashMap<>();
        verticalNames.put(null, "Uncategorised");
        for (Rep rep : reps) {
            repsPerVertical.merge(rep.getVerticalId(), 1, Integer::sum);
        }
        for (Object[] row : entityManager
                .createQuery("select v.id, v.name from Vertical v where v.workspaceId = :ws",
                        Object[].class)
                .setParameter("ws", workspaceId)
                .getResultList()) {
            verticalNames.put((Long) row[0], (String) row[1]);
        }
        Map<Long, Integer> placedPerVertical = new HashMap<>();
        for (Long repId : placedRepIds) {
            Rep rep = repsById.get(repId);
            placedPerVertical.merge(rep.getVerticalId(), 1, Integer::sum);
        }
        List<VerticalBreakdown> verticals = new ArrayList<>();
        Set<Long> verticalIds = new HashSet<>(repsPerVertical.keySet());
        verticalIds.addAll(verticalNames.keySet());
        verticalIds.stream().sorted((a, b) -> Long.compare(
                a == null ? -1 : a, b == null ? -1 : b)).forEach(id -> {
            int repCount = repsPerVertical.getOrDefault(id, 0);
            int placedCount = placedPerVertical.getOrDefault(id, 0);
            if (repCount == 0 && placedCount == 0) {
                return; // empty vertical: leave it out of the breakdown
            }
            verticals.add(new VerticalBreakdown(id,
                    verticalNames.getOrDefault(id, id == null ? "Uncategorised" : "(unknown)"),
                    repCount, placedCount));
        });

        return new ReportsResponse(new PlacementRate(placedReps, totalReps, rate),
                averageBenchDays, benchSamples, perOfferList, verticals);
    }
}
