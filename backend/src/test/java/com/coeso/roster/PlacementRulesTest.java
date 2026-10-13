package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.NotFoundException;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.placement.PlacementService;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * Placement rules (Phase 1):
 *  - closed or full offer is rejected,
 *  - a second active placement for the same rep is rejected (service and DB),
 *  - two concurrent attempts for the last seat yield exactly one success,
 *  - placing writes an audit row atomically.
 */
class PlacementRulesTest extends IntegrationTest {

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    @Test
    void placingOnClosedOfferIsRejected() throws Exception {
        Account manager = register("rule-closed");
        long ws = createWorkspace(manager, "Rule Closed " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "Closed Offer", 5);
        long rep = repoRep(ws, "Rep-1");

        apiPost(manager, ws, "/api/offers/" + offer + "/close", null)
                .andExpect(status().isOk());

        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":" + offer + ",\"repId\":" + rep + "}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"))
                .andExpect(jsonPath("$.message").value("Offer is closed"));

        assertThat(activePlacements(offer)).isZero();
    }

    @Test
    void placingOnFullOfferIsRejected() throws Exception {
        Account manager = register("rule-full");
        long ws = createWorkspace(manager, "Rule Full " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "One Seat", 1);
        long rep1 = repoRep(ws, "Rep-1");
        long rep2 = repoRep(ws, "Rep-2");

        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":" + offer + ",\"repId\":" + rep1 + "}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":" + offer + ",\"repId\":" + rep2 + "}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Offer is full (1/1 seats filled)"));

        assertThat(activePlacements(offer)).isEqualTo(1);
    }

    @Test
    void repWithActivePlacementCannotBePlacedAgain() throws Exception {
        Account manager = register("rule-double");
        long ws = createWorkspace(manager, "Rule Double " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offer1 = repoOffer(ws, client, "Offer 1", 5);
        long offer2 = repoOffer(ws, client, "Offer 2", 5);
        long rep = repoRep(ws, "Rep-1");

        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":" + offer1 + ",\"repId\":" + rep + "}")
                .andExpect(status().isCreated());

        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":" + offer2 + ",\"repId\":" + rep + "}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Rep already has an active placement"));

        // After ending the first placement the rep can be placed again.
        Long placementId = placementRepository.findAll().stream()
                .filter(p -> p.getRepId() == rep && p.getStatus().name().equals("ACTIVE"))
                .findFirst().orElseThrow().getId();
        apiPost(manager, ws, "/api/placements/" + placementId + "/end",
                        "{\"reason\":\"contract finished\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ENDED"));

        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":" + offer2 + ",\"repId\":" + rep + "}")
                .andExpect(status().isCreated());
    }

    @Test
    void databaseRejectsSecondActivePlacementEvenIfServiceIsBypassed() {
        long ws = createWorkspace(register("rule-db-dup"), "Rule DbDup " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "Offer", 10);
        long rep = repoRep(ws, "Rep-1");
        repoPlacement(ws, offer, rep);

        // Direct repository insert of a second ACTIVE placement for the same
        // rep violates uq_placements_ws_active_rep (generated column) even
        // though seats are free — the database itself enforces rule 3.
        Placement second = new Placement();
        second.setWorkspaceId(ws);
        second.setOfferId(offer);
        second.setRepId(rep);
        second.setStatus(com.coeso.roster.entity.PlacementStatus.ACTIVE);
        assertThatThrownBy(() -> placementRepository.save(second))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void concurrentLastSeatRaceYieldsExactlyOneSuccess() throws Exception {
        Account manager = register("rule-race");
        long ws = createWorkspace(manager, "Rule Race " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "Last Seat", 1);
        long rep1 = repoRep(ws, "Racer-1");
        long rep2 = repoRep(ws, "Racer-2");

        int threads = 2;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CyclicBarrier startLine = new CyclicBarrier(threads);
        CountDownLatch done = new CountDownLatch(threads);
        List<Throwable> failures = new ArrayList<>();
        List<Long> successes = new ArrayList<>();

        try {
            List<Future<?>> futures = new ArrayList<>();
            for (long rep : new long[] {rep1, rep2}) {
                futures.add(pool.submit(() -> {
                    try {
                        setTenant(ws, WorkspaceRole.MANAGER, manager.userId());
                        startLine.await();
                        PlacementService.PlaceRequest request =
                                new PlacementService.PlaceRequest(offer, rep);
                        PlacementService.PlacementResponse response = placementService.place(request);
                        synchronized (successes) {
                            successes.add(response.id());
                        }
                    } catch (Throwable t) {
                        synchronized (failures) {
                            failures.add(t);
                        }
                    } finally {
                        clearTenant();
                        done.countDown();
                    }
                    return null;
                }));
            }
            for (Future<?> future : futures) {
                future.get(); // propagate nothing; failures are collected
            }
        } finally {
            pool.shutdownNow();
        }

        assertThat(successes).hasSize(1);
        assertThat(failures).hasSize(1);
        assertThat(failures.get(0))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Offer is full");
        assertThat(activePlacements(offer)).isEqualTo(1);

        // The successful placement wrote exactly one audit row.
        List<AuditLog> audits = auditLogRepository.findAll().stream()
                .filter(a -> AuditLog.ACTION_PLACE.equals(a.getAction())
                        && a.getWorkspaceId() == ws)
                .toList();
        assertThat(audits).hasSize(1);
    }

    @Test
    void placeAndUnplaceWriteAuditRowsWithActor() throws Exception {
        Account manager = register("rule-audit");
        long ws = createWorkspace(manager, "Rule Audit " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "Offer", 2);
        long rep = repoRep(ws, "Rep-1");

        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":" + offer + ",\"repId\":" + rep + "}")
                .andExpect(status().isCreated());

        Long placementId = placementRepository.findAll().stream()
                .filter(p -> p.getRepId() == rep && p.getStatus().name().equals("ACTIVE"))
                .findFirst().orElseThrow().getId();

        apiPost(manager, ws, "/api/placements/" + placementId + "/end", "{\"reason\":\"no-show\"}")
                .andExpect(status().isOk());

        List<AuditLog> audits = auditLogRepository.findAll().stream()
                .filter(a -> a.getWorkspaceId() == ws)
                .toList();
        assertThat(audits).extracting(AuditLog::getAction)
                .contains(AuditLog.ACTION_PLACE, AuditLog.ACTION_UNPLACE);
        assertThat(audits).allSatisfy(a -> assertThat(a.getActorUserId()).isEqualTo(manager.userId()));

        // Ending twice is a conflict.
        apiPost(manager, ws, "/api/placements/" + placementId + "/end", "{}")
                .andExpect(status().isConflict());
    }

    @Test
    void placeRequiresManagerRole() throws Exception {
        Account owner = register("rule-owner");
        long ws = createWorkspace(owner, "Rule Role " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "Offer", 1);
        long rep = repoRep(ws, "Rep-1");

        Account repUser = register("rule-rep-user");
        addMember(ws, repUser.userId(), WorkspaceRole.REP);
        apiPost(repUser, ws, "/api/placements",
                        "{\"offerId\":" + offer + ",\"repId\":" + rep + "}")
                .andExpect(status().isForbidden());

        // A foreign workspace's rep id is 404, never a placement.
        long otherWs = createWorkspace(register("rule-other"), "Rule Other " + sfx, null);
        long foreignRep = repoRep(otherWs, "Foreign");
        Account owner2 = register("rule-owner2");
        apiPost(owner2, otherWs, "/api/placements",
                        "{\"offerId\":" + offer + ",\"repId\":" + foreignRep + "}")
                .andExpect(status().isForbidden());
    }

    @Test
    void placeUnknownIdsAreNotFound() throws Exception {
        Account manager = register("rule-404");
        long ws = createWorkspace(manager, "Rule 404 " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "Offer", 1);

        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":" + offer + ",\"repId\":999999}")
                .andExpect(status().isNotFound());

        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":999999,\"repId\":" + repoRep(ws, "Rep-1") + "}")
                .andExpect(status().isNotFound());

        // deleted rep cannot be placed
        long rep = repoRep(ws, "Doomed");
        apiDelete(manager, ws, "/api/reps/" + rep).andExpect(status().isNoContent());
        apiPost(manager, ws, "/api/placements",
                        "{\"offerId\":" + offer + ",\"repId\":" + rep + "}")
                .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------ helpers

    private long activePlacements(long offerId) {
        return placementRepository.findAll().stream()
                .filter(p -> p.getOfferId() == offerId
                        && p.getStatus() == com.coeso.roster.entity.PlacementStatus.ACTIVE)
                .count();
    }
}
