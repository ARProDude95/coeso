package com.coeso.roster;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Role matrix: every workspace-scoped endpoint is exercised as each of the four
 * roles (owner, admin, manager, rep). Reads of lookup tables are open to every
 * member; roster/client/offer/placement/stats operations need manager+; lookup
 * writes need admin+; deleting the workspace needs owner.
 */
class RoleMatrixTest extends IntegrationTest {

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    @Test
    void ownerPassesEveryEndpoint() throws Exception {
        Account owner = register("mx-owner");
        long ws = createWorkspace(owner, "Matrix Owner " + sfx, null);
        assertMatrix(owner, ws, WorkspaceRole.OWNER);
    }

    @Test
    void adminPassesEverythingExceptWorkspaceDeletion() throws Exception {
        Account creator = register("mx-admin-creator");
        long ws = createWorkspace(creator, "Matrix Admin " + sfx, null);
        Account admin = register("mx-admin");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        assertMatrix(admin, ws, WorkspaceRole.ADMIN);
    }

    @Test
    void managerPassesRosterEndpointsButNotLookupWrites() throws Exception {
        Account creator = register("mx-mgr-creator");
        long ws = createWorkspace(creator, "Matrix Manager " + sfx, null);
        Account manager = register("mx-mgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        assertMatrix(manager, ws, WorkspaceRole.MANAGER);
    }

    @Test
    void repOnlyReadsLookups() throws Exception {
        Account creator = register("mx-rep-creator");
        long ws = createWorkspace(creator, "Matrix Rep " + sfx, null);
        Account rep = register("mx-rep");
        addMember(ws, rep.userId(), WorkspaceRole.REP);
        assertMatrix(rep, ws, WorkspaceRole.REP);
    }

    // ------------------------------------------------------------------ matrix

    private void assertMatrix(Account actor, long ws, WorkspaceRole role) throws Exception {
        boolean isManagerPlus = role.atLeast(WorkspaceRole.MANAGER);
        boolean isAdminPlus = role.atLeast(WorkspaceRole.ADMIN);
        boolean isOwner = role == WorkspaceRole.OWNER;

        // Fixtures inside the actor's workspace (no role logic in setup).
        long client = repoClient(ws, "MX Client " + sfx);
        long repId = repoRep(ws, "MX Rep " + sfx);
        long offer = repoOffer(ws, client, "MX Offer " + sfx, 5);
        long extraVertical = repoVertical(ws, "MX Vertical " + sfx);
        long extraStatus = repoStatus(ws, "MX Status " + sfx);
        long extraLevel = repoExperienceLevel(ws, "MX Level " + sfx);

        // ---------------------------------------------------------------- reps
        expect(actor, ws, "GET /api/reps", get("/api/reps"), isManagerPlus, 200);
        expect(actor, ws, "POST /api/reps",
                post("/api/reps", "{\"name\":\"MX New Rep\"}"), isManagerPlus, 201);
        expect(actor, ws, "PUT /api/reps/{id}",
                put("/api/reps/" + repId, "{\"name\":\"MX Renamed\"}"), isManagerPlus, 200);
        // DELETE must stay last for reps: a soft-deleted rep breaks later 200s.
        expect(actor, ws, "DELETE /api/reps/{id}",
                del("/api/reps/" + repId), isManagerPlus, 204);

        // -------------------------------------------------------------- clients
        long client2 = repoClient(ws, "MX Client 2 " + sfx);
        expect(actor, ws, "GET /api/clients", get("/api/clients"), isManagerPlus, 200);
        expect(actor, ws, "POST /api/clients",
                post("/api/clients", "{\"name\":\"MX New Client\"}"), isManagerPlus, 201);
        expect(actor, ws, "PUT /api/clients/{id}",
                put("/api/clients/" + client2, "{\"name\":\"MX Client 2 Renamed\"}"),
                isManagerPlus, 200);
        expect(actor, ws, "DELETE /api/clients/{id}",
                del("/api/clients/" + client2), isManagerPlus, 204);

        // --------------------------------------------------------------- offers
        expect(actor, ws, "GET /api/offers", get("/api/offers"), isManagerPlus, 200);
        expect(actor, ws, "POST /api/offers",
                post("/api/offers",
                        "{\"clientId\":" + client + ",\"title\":\"MX New Offer\",\"seats\":2}"),
                isManagerPlus, 201);
        expect(actor, ws, "PUT /api/offers/{id}",
                put("/api/offers/" + offer,
                        "{\"clientId\":" + client + ",\"title\":\"MX Offer Renamed\",\"seats\":3}"),
                isManagerPlus, 200);
        expect(actor, ws, "POST /api/offers/{id}/close",
                post("/api/offers/" + offer + "/close", null), isManagerPlus, 200);

        // ----------------------------------------------------------- placements
        long offer2 = repoOffer(ws, client, "MX Offer 2 " + sfx, 5);
        long repId2 = repoRep(ws, "MX Rep 2 " + sfx);
        expect(actor, ws, "GET /api/placements?offerId=" + offer2,
                get("/api/placements?offerId=" + offer2), isManagerPlus, 200);
        expect(actor, ws, "POST /api/placements",
                post("/api/placements",
                        "{\"offerId\":" + offer2 + ",\"repId\":" + repId2 + "}"),
                isManagerPlus, 201);
        // When the role was denied no placement exists; the end call still
        // exercises the guard (403 happens before any id lookup).
        long placementId = isManagerPlus
                ? placementRepository.findAll().stream()
                        .filter(p -> p.getRepId() == repId2 && p.getStatus().name().equals("ACTIVE"))
                        .findFirst().orElseThrow().getId()
                : -1L;
        expect(actor, ws, "POST /api/placements/{id}/end",
                post("/api/placements/" + placementId + "/end", "{}"), isManagerPlus, 200);

        // ---------------------------------------------------------------- stats
        expect(actor, ws, "GET /api/stats", get("/api/stats"), isManagerPlus, 200);

        // -------------------------------------------------- lookup reads (all)
        expect(actor, ws, "GET /api/verticals", get("/api/verticals"), true, 200);
        expect(actor, ws, "GET /api/statuses", get("/api/statuses"), true, 200);
        expect(actor, ws, "GET /api/experience-levels",
                get("/api/experience-levels"), true, 200);

        // -------------------------------------------- lookup writes (admin+)
        expect(actor, ws, "POST /api/verticals",
                post("/api/verticals", "{\"name\":\"MX Made Vertical\"}"), isAdminPlus, 201);
        expect(actor, ws, "PUT /api/verticals/{id}",
                put("/api/verticals/" + extraVertical, "{\"name\":\"MX Vertical Renamed\"}"),
                isAdminPlus, 200);
        expect(actor, ws, "DELETE /api/verticals/{id}",
                del("/api/verticals/" + extraVertical), isAdminPlus, 204);

        expect(actor, ws, "POST /api/statuses",
                post("/api/statuses", "{\"name\":\"MX Made Status\",\"kind\":\"BENCH\"}"),
                isAdminPlus, 201);
        expect(actor, ws, "PUT /api/statuses/{id}",
                put("/api/statuses/" + extraStatus,
                        "{\"name\":\"MX Status Renamed\",\"kind\":\"BENCH\"}"),
                isAdminPlus, 200);
        expect(actor, ws, "DELETE /api/statuses/{id}",
                del("/api/statuses/" + extraStatus), isAdminPlus, 204);

        expect(actor, ws, "POST /api/experience-levels",
                post("/api/experience-levels", "{\"name\":\"MX Made Level\"}"), isAdminPlus, 201);
        expect(actor, ws, "PUT /api/experience-levels/{id}",
                put("/api/experience-levels/" + extraLevel, "{\"name\":\"MX Level Renamed\"}"),
                isAdminPlus, 200);
        expect(actor, ws, "DELETE /api/experience-levels/{id}",
                del("/api/experience-levels/" + extraLevel), isAdminPlus, 204);

        // ---------------------------------------------------- workspace delete
        expect(actor, ws, "DELETE /api/workspaces/{id}",
                del("/api/workspaces/" + ws), isOwner, 204);
    }

    // ------------------------------------------------------------------ helper

    /**
     * Runs one request as {@code actor} in {@code ws} and asserts the outcome:
     * allowed -> {@code allowedStatus}; denied -> 403 with code FORBIDDEN.
     */
    private void expect(Account actor, long ws, String label,
                        org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
                        boolean allowed, int allowedStatus) throws Exception {
        if (allowed) {
            mockMvc.perform(request.header("Authorization", bearer(actor))
                            .header("X-Workspace", String.valueOf(ws)))
                    .andExpect(status().is(allowedStatus));
        } else {
            mockMvc.perform(request.header("Authorization", bearer(actor))
                            .header("X-Workspace", String.valueOf(ws)))
                    .andExpect(status().isForbidden())
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                            .jsonPath("$.code").value("FORBIDDEN"));
        }
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder get(
            String path) {
        return org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path);
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder post(
            String path, String body) {
        var builder = org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .post(path).contentType(org.springframework.http.MediaType.APPLICATION_JSON);
        if (body != null) {
            builder.content(body);
        }
        return builder;
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder put(
            String path, String body) {
        return org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .put(path).contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content(body);
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder del(
            String path) {
        return org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(path);
    }

    private long repoExperienceLevel(long workspaceId, String name) {
        com.coeso.roster.entity.ExperienceLevel level =
                new com.coeso.roster.entity.ExperienceLevel();
        level.setWorkspaceId(workspaceId);
        level.setName(name);
        experienceLevelRepository.save(level);
        return level.getId();
    }
}
