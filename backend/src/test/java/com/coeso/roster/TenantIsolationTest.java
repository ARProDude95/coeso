package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.Client;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.entity.Rep;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Rule 1 (tenant isolation) proven through the HTTP surface: a member of
 * workspace A must not be able to read, update or delete anything belonging to
 * workspace B, even by guessing ids. The X-Workspace header is verified against
 * memberships, and the Hibernate filter narrows every repository query, so a
 * foreign id simply looks "not found".
 */
class TenantIsolationTest extends IntegrationTest {

    private String sfx;

    // The two workspaces with a row of each tenant-owned type, created via
    // repositories so no role logic is involved in the fixtures.
    private long wsA;
    private long wsB;
    private long repA;
    private long repB;
    private long clientA;
    private long clientB;
    private long offerA;
    private long offerB;
    private long verticalA;
    private long verticalB;
    private long statusA;
    private long statusB;

    private Account ownerA;
    private Account ownerB;

    private void setup() {
        // Fresh rows per test method (PER_CLASS lifecycle): a unique suffix
        // avoids slug conflicts between tests.
        sfx = UUID.randomUUID().toString().substring(0, 8);
        ownerA = register("iso-a");
        wsA = createWorkspace(ownerA, "Iso A " + sfx, null);
        ownerB = register("iso-b");
        wsB = createWorkspace(ownerB, "Iso B " + sfx, null);

        repA = repoRep(wsA, "Rep-Of-A");
        repB = repoRep(wsB, "Rep-Of-B");
        clientA = repoClient(wsA, "Client-Of-A");
        clientB = repoClient(wsB, "Client-Of-B");
        offerA = repoOffer(wsA, clientA, "Offer-Of-A", 3);
        offerB = repoOffer(wsB, clientB, "Offer-Of-B", 3);
        verticalA = repoVertical(wsA, "Vertical-Of-A");
        verticalB = repoVertical(wsB, "Vertical-Of-B");
        statusA = repoStatus(wsA, "Status-Of-A");
        statusB = repoStatus(wsB, "Status-Of-B");
    }

    // ------------------------------------------------------------------- reads

    @Test
    void listsNeverLeakForeignRows() throws Exception {
        setup();

        apiGet(ownerA, wsA, "/api/reps")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.name == 'Rep-Of-A')]").exists())
                .andExpect(jsonPath("$.items[?(@.name == 'Rep-Of-B')]").doesNotExist());

        apiGet(ownerA, wsA, "/api/clients")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.name == 'Client-Of-A')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Client-Of-B')]").doesNotExist());

        apiGet(ownerA, wsA, "/api/offers")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.title == 'Offer-Of-A')]").exists())
                .andExpect(jsonPath("$[?(@.title == 'Offer-Of-B')]").doesNotExist());

        apiGet(ownerA, wsA, "/api/verticals")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.name == 'Vertical-Of-A')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Vertical-Of-B')]").doesNotExist());

        apiGet(ownerA, wsA, "/api/statuses")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.name == 'Status-Of-A')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Status-Of-B')]").doesNotExist());
    }

    @Test
    void foreignIdsAreNotFoundOnEveryEndpoint() throws Exception {
        setup();

        // reps: update + soft-delete with B's rep id
        apiPut(ownerA, wsA, "/api/reps/" + repB, "{\"name\":\"Hijacked\"}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        apiDelete(ownerA, wsA, "/api/reps/" + repB)
                .andExpect(status().isNotFound());
        assertThat(repRepository.findById(repB).orElseThrow().getName()).isEqualTo("Rep-Of-B");
        assertThat(repRepository.findById(repB).orElseThrow().getDeletedAt()).isNull();

        // clients: update + hard-delete with B's client id
        apiPut(ownerA, wsA, "/api/clients/" + clientB, "{\"name\":\"Hijacked\"}")
                .andExpect(status().isNotFound());
        apiDelete(ownerA, wsA, "/api/clients/" + clientB)
                .andExpect(status().isNotFound());
        assertThat(clientRepository.findById(clientB).orElseThrow().getName()).isEqualTo("Client-Of-B");

        // offers: update + close with B's offer id
        apiPut(ownerA, wsA, "/api/offers/" + offerB,
                        "{\"clientId\":" + clientB + ",\"title\":\"Hijacked\",\"seats\":1}")
                .andExpect(status().isNotFound());
        apiPost(ownerA, wsA, "/api/offers/" + offerB + "/close", null)
                .andExpect(status().isNotFound());
        assertThat(offerRepository.findById(offerB).orElseThrow().getStatus().name())
                .isEqualTo("OPEN");

        // lookups: update + delete with B's vertical / status ids
        apiPut(ownerA, wsA, "/api/verticals/" + verticalB, "{\"name\":\"Hijacked\"}")
                .andExpect(status().isNotFound());
        apiDelete(ownerA, wsA, "/api/verticals/" + verticalB)
                .andExpect(status().isNotFound());
        assertThat(verticalRepository.findById(verticalB).orElseThrow().getName())
                .isEqualTo("Vertical-Of-B");

        apiPut(ownerA, wsA, "/api/statuses/" + statusB, "{\"name\":\"Hijacked\",\"kind\":\"BENCH\"}")
                .andExpect(status().isNotFound());
        apiDelete(ownerA, wsA, "/api/statuses/" + statusB)
                .andExpect(status().isNotFound());
    }

    @Test
    void placementCannotTargetForeignOfferOrRep() throws Exception {
        setup();

        // A placing its own rep onto B's offer: offer not found in A.
        apiPost(ownerA, wsA, "/api/placements",
                        "{\"offerId\":" + offerB + ",\"repId\":" + repA + "}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        assertThat(placementCountForOffer(offerB)).isZero();

        // A placing B's rep onto its own offer: rep not found in A.
        apiPost(ownerA, wsA, "/api/placements",
                        "{\"offerId\":" + offerA + ",\"repId\":" + repB + "}")
                .andExpect(status().isNotFound());
        assertThat(placementCountForOffer(offerA)).isZero();

        // Listing placements by a foreign offer id yields nothing (not an error).
        apiGet(ownerA, wsA, "/api/placements?offerId=" + offerB)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void endingAPlacementInAnotherWorkspaceIsImpossible() throws Exception {
        setup();
        long placementB = repoPlacement(wsB, offerB, repB);

        apiPost(ownerA, wsA, "/api/placements/" + placementB + "/end", "{}")
                .andExpect(status().isNotFound());
        assertThat(placementRepository.findById(placementB).orElseThrow().getStatus().name())
                .isEqualTo("ACTIVE");
    }

    // ---------------------------------------------------- membership boundary

    @Test
    void membershipInOneWorkspaceDoesNotGrantAnother() throws Exception {
        setup();

        // ownerA asking for workspace B by id and by slug: 403, never data.
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/reps")
                        .header("Authorization", bearer(ownerA))
                        .header("X-Workspace", String.valueOf(wsB)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("WORKSPACE_ACCESS_DENIED"));

        String slugB = workspaceRepository.findById(wsB).orElseThrow().getSlug();
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/reps")
                        .header("Authorization", bearer(ownerA))
                        .header("X-Workspace", slugB))
                .andExpect(status().isForbidden());
    }

    @Test
    void workspaceDeletionOnlyAffectsTheCallerWorkspace() throws Exception {
        setup();

        apiDelete(ownerA, wsA, "/api/workspaces/" + wsA)
                .andExpect(status().isNoContent());

        assertThat(workspaceRepository.findById(wsA).orElseThrow().getStatus().name())
                .isEqualTo("DELETED");
        assertThat(workspaceRepository.findById(wsB).orElseThrow().getStatus().name())
                .isEqualTo("ACTIVE");

        // B still works normally.
        apiGet(ownerB, wsB, "/api/reps").andExpect(status().isOk());
    }

    @Test
    void lookupsAreIsolatedPerWorkspace() throws Exception {
        setup();
        // Two workspaces both seed the same default names; ids must differ and
        // edits in one workspace must not affect the other.
        long salesA = verticalIdByName(wsA, "Sales");
        long salesB = verticalIdByName(wsB, "Sales");
        assertThat(salesA).isNotEqualTo(salesB);

        Account adminA = register("iso-admin-a");
        addMember(wsA, adminA.userId(), WorkspaceRole.ADMIN);
        apiPut(adminA, wsA, "/api/verticals/" + salesA, "{\"name\":\"Revenue\"}")
                .andExpect(status().isOk());

        assertThat(verticalRepository.findById(salesB).orElseThrow().getName()).isEqualTo("Sales");
    }

    // ------------------------------------------------------------------ helpers

    private long placementCountForOffer(long offerId) {
        return placementRepository.findAll().stream()
                .filter(p -> p.getOfferId() == offerId)
                .count();
    }

    private long verticalIdByName(long workspaceId, String name) {
        return verticalRepository.findAll().stream()
                .filter(v -> v.getWorkspaceId() == workspaceId && name.equals(v.getName()))
                .findFirst().orElseThrow().getId();
    }
}
