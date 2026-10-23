package com.coeso.roster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.coeso.roster.common.WorkspaceRole;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.result.MockMvcResultMatchers;

/**
 * Phase 8 — the offer pipeline and its accessible kanban board:
 *
 * <ul>
 *   <li>every workspace ships with the four default stages, in order, and new
 *       offers land in the first column;</li>
 *   <li>the board returns columns in stage order with the offers grouped under
 *       them, and follows the offers bar (manager+ reads);</li>
 *   <li>moving an offer between columns is a manager action; the target stage
 *       must belong to the same workspace (foreign/unknown → 404);</li>
 *   <li>stage configuration follows the lookup write bar (admin+), with
 *       case-insensitive duplicate names refused, positions staying
 *       contiguous after reorder/delete, empty-only deletion and a guaranteed
 *       last column;</li>
 *   <li>stage reads stay open to every member, like all lookups.</li>
 * </ul>
 */
public class Phase8PipelineTest extends IntegrationTest {

    private long uniqueWorkspace(Account owner, String prefix) {
        return createWorkspace(owner, prefix + " "
                + UUID.randomUUID().toString().substring(0, 8), null);
    }

    // ------------------------------------------------------------------ helpers

    private JsonNode stages(Account actor, long ws) throws Exception {
        var result = apiGet(actor, ws, "/api/pipeline/stages")
                .andExpect(MockMvcResultMatchers.status().isOk())
                .andReturn();
        return read(result);
    }

    private long stageIdByName(JsonNode stages, String name) {
        for (JsonNode stage : stages) {
            if (stage.get("name").asText().equals(name)) {
                return stage.get("id").asLong();
            }
        }
        throw new AssertionError("no stage named " + name + " in " + stages);
    }

    private List<String> names(JsonNode stages) {
        List<String> result = new ArrayList<>();
        for (JsonNode stage : stages) {
            result.add(stage.get("name").asText());
        }
        return result;
    }

    private void assertContiguous(JsonNode stages) {
        for (int i = 0; i < stages.size(); i++) {
            assertEquals(i + 1, stages.get(i).get("position").asInt(),
                    "positions stay contiguous 1..n: " + stages);
        }
    }

    private long createOfferViaApi(Account actor, long ws, long clientId, String title)
            throws Exception {
        var result = apiPost(actor, ws, "/api/offers", """
                {"clientId":%d,"title":"%s","seats":2}
                """.formatted(clientId, title))
                .andExpect(MockMvcResultMatchers.status().isCreated())
                .andReturn();
        return read(result).get("id").asLong();
    }

    private JsonNode board(Account actor, long ws) throws Exception {
        var result = apiGet(actor, ws, "/api/pipeline/board")
                .andExpect(MockMvcResultMatchers.status().isOk())
                .andReturn();
        return read(result);
    }

    private long moveStage(Account actor, long ws, long offerId, long stageId)
            throws Exception {
        var result = apiPost(actor, ws, "/api/offers/" + offerId + "/stage",
                        "{\"stageId\":%d}".formatted(stageId))
                .andExpect(MockMvcResultMatchers.status().isOk())
                .andReturn();
        return read(result).get("stageId").asLong();
    }

    // ------------------------------------------------------------------- tests

    @Test
    void defaultStagesShipAndNewOffersLandInTheFirstColumn() throws Exception {
        Account owner = register("p8-seed");
        long ws = uniqueWorkspace(owner, "Seed Co");

        // The four defaults arrive with the workspace, in order.
        JsonNode seeded = stages(owner, ws);
        assertEquals(List.of("Sourcing", "Interviewing", "Onboarding", "Live"),
                names(seeded));
        assertContiguous(seeded);

        // A created offer starts in the first column…
        long client = repoClient(ws, "Pipe Client");
        long offerId = createOfferViaApi(owner, ws, client, "Account Executive");
        JsonNode columns = board(owner, ws);
        assertEquals(4, columns.size());
        assertEquals(stageIdByName(seeded, "Sourcing"),
                columns.get(0).get("stage").get("id").asLong());
        assertEquals("Sourcing", columns.get(0).get("offers").get(0)
                .get("stageName").asText(), "new offer sits in the first column");
        assertEquals(1, columns.get(0).get("offers").size());
        for (int i = 1; i < columns.size(); i++) {
            assertEquals(0, columns.get(i).get("offers").size(),
                    "later columns start empty");
        }

        // …and moving it carries it to the target column on the next read.
        long liveId = stageIdByName(seeded, "Live");
        assertEquals(liveId, moveStage(owner, ws, offerId, liveId));
        JsonNode after = board(owner, ws);
        assertEquals(0, after.get(0).get("offers").size());
        assertEquals(1, after.get(3).get("offers").size());
        assertEquals(offerId, after.get(3).get("offers").get(0).get("id").asLong());

        // The board keeps the stage ordering, not insertion order.
        assertEquals(names(seeded), namesOfStages(after));
    }

    private List<String> namesOfStages(JsonNode columns) {
        List<String> result = new ArrayList<>();
        for (JsonNode column : columns) {
            result.add(column.get("stage").get("name").asText());
        }
        return result;
    }

    @Test
    void movesFollowTheManagerBarAndNeverCrossWorkspaces() throws Exception {
        Account owner = register("p8-move");
        long ws = uniqueWorkspace(owner, "Move Co");
        Account manager = register("p8-movemgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        Account rep = register("p8-moverep");
        addMember(ws, rep.userId(), WorkspaceRole.REP);
        long client = repoClient(ws, "Move Client");
        long offerId = createOfferViaApi(owner, ws, client, "SDR");
        JsonNode seeded = stages(owner, ws);

        // Reads split like the rest of the app: stages for every member,
        // the board (which carries offer data) for manager+.
        apiGet(rep, ws, "/api/pipeline/stages")
                .andExpect(MockMvcResultMatchers.status().isOk());
        apiGet(rep, ws, "/api/pipeline/board")
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        apiGet(manager, ws, "/api/pipeline/board")
                .andExpect(MockMvcResultMatchers.status().isOk());

        // Moving an offer needs manager+; reps are refused.
        apiPost(rep, ws, "/api/offers/" + offerId + "/stage",
                        "{\"stageId\":%d}".formatted(stageIdByName(seeded, "Live")))
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        // A manager may move it.
        assertEquals(stageIdByName(seeded, "Interviewing"),
                moveStage(manager, ws, offerId, stageIdByName(seeded, "Interviewing")));

        // Same-column moves are harmless no-ops.
        assertEquals(stageIdByName(seeded, "Interviewing"),
                moveStage(owner, ws, offerId, stageIdByName(seeded, "Interviewing")));

        // Unknown and foreign stages both read as "not in this workspace".
        apiPost(owner, ws, "/api/offers/" + offerId + "/stage",
                        "{\"stageId\":999999999}")
                .andExpect(MockMvcResultMatchers.status().isNotFound());

        Account outsider = register("p8-out");
        long otherWs = uniqueWorkspace(outsider, "Other Co");
        long foreignStage = stageIdByName(stages(outsider, otherWs), "Live");
        apiPost(owner, ws, "/api/offers/" + offerId + "/stage",
                        "{\"stageId\":%d}".formatted(foreignStage))
                .andExpect(MockMvcResultMatchers.status().isNotFound());

        // The offer itself cannot be addressed across workspaces either.
        apiPost(outsider, otherWs, "/api/offers/" + offerId + "/stage",
                        "{\"stageId\":%d}".formatted(stageIdByName(seeded, "Live")))
                .andExpect(MockMvcResultMatchers.status().isNotFound());

        // Bad direction payloads are refused clearly.
        apiPost(owner, ws, "/api/pipeline/stages/1/move", "{\"direction\":\"LEFT\"}")
                .andExpect(MockMvcResultMatchers.status().isBadRequest());
    }

    @Test
    void stageConfigFollowsTheAdminBarAndKeepsTheBoardConsistent() throws Exception {
        Account owner = register("p8-cfg");
        long ws = uniqueWorkspace(owner, "Cfg Co");
        Account manager = register("p8-cfgmgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        Account admin = register("p8-cfgadmin");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        Account rep = register("p8-cfgrep");
        addMember(ws, rep.userId(), WorkspaceRole.REP);

        // Writes are admin+ (the lookup write bar); reads are member+.
        String body = "{\"name\":\"Escalation\"}";
        apiPost(rep, ws, "/api/pipeline/stages", body)
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        apiPost(manager, ws, "/api/pipeline/stages", body)
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        var created = apiPost(admin, ws, "/api/pipeline/stages", body)
                .andExpect(MockMvcResultMatchers.status().isCreated())
                .andReturn();
        long escalationId = read(created).get("id").asLong();
        assertEquals(5, read(created).get("position").asInt(),
                "new columns are appended");

        // Blank names are a validation error; duplicates a conflict — and the
        // uniqueness check is case-insensitive.
        apiPost(owner, ws, "/api/pipeline/stages", "{\"name\":\"  \"}")
                .andExpect(MockMvcResultMatchers.status().isBadRequest());
        apiPost(owner, ws, "/api/pipeline/stages", "{\"name\":\"escalation\"}")
                .andExpect(MockMvcResultMatchers.status().isConflict());
        apiPut(owner, ws, "/api/pipeline/stages/" + escalationId,
                        "{\"name\":\"Sourcing\"}")
                .andExpect(MockMvcResultMatchers.status().isConflict());

        // Renaming works for a free name; the rename applies everywhere.
        apiPut(admin, ws, "/api/pipeline/stages/" + escalationId,
                        "{\"name\":\"Negotiation\"}")
                .andExpect(MockMvcResultMatchers.status().isOk());
        assertEquals(List.of("Sourcing", "Interviewing", "Onboarding", "Live",
                        "Negotiation"), names(stages(owner, ws)));

        // Reorder: DOWN on the last column is a no-op, UP swaps with its
        // neighbour, and positions stay contiguous afterwards.
        assertEquals(List.of("Sourcing", "Interviewing", "Onboarding", "Live",
                "Negotiation"), names(apiMove(owner, ws, escalationId, "DOWN")));
        JsonNode afterUp = apiMove(owner, ws, escalationId, "UP");
        assertEquals(List.of("Sourcing", "Interviewing", "Onboarding", "Negotiation",
                "Live"), names(afterUp));
        assertContiguous(afterUp);

        // Deleting a stage that still holds offers is refused.
        long client = repoClient(ws, "Cfg Client");
        long offerId = createOfferViaApi(owner, ws, client, "Closer");
        long sourcingId = stageIdByName(stages(owner, ws), "Sourcing");
        apiDelete(owner, ws, "/api/pipeline/stages/" + sourcingId)
                .andExpect(MockMvcResultMatchers.status().isConflict());

        // Empty columns delete fine and the rest renumber to 1..n.
        long negotiationId = stageIdByName(stages(owner, ws), "Negotiation");
        // negotiation holds no offers (the offer sits in Sourcing) — but is it
        // empty? Yes: only one offer exists and it is in Sourcing.
        apiDelete(admin, ws, "/api/pipeline/stages/" + negotiationId)
                .andExpect(MockMvcResultMatchers.status().isNoContent());
        JsonNode afterDelete = stages(owner, ws);
        assertEquals(List.of("Sourcing", "Interviewing", "Onboarding", "Live"),
                names(afterDelete));
        assertContiguous(afterDelete);

        // A workspace always keeps one column: empty ones can go until only
        // the offer-holding Sourcing is left, and that last delete is refused
        // for "needs at least one stage".
        apiDelete(owner, ws, "/api/pipeline/stages/"
                        + stageIdByName(stages(owner, ws), "Interviewing"))
                .andExpect(MockMvcResultMatchers.status().isNoContent());
        apiDelete(owner, ws, "/api/pipeline/stages/"
                        + stageIdByName(stages(owner, ws), "Onboarding"))
                .andExpect(MockMvcResultMatchers.status().isNoContent());
        apiDelete(owner, ws, "/api/pipeline/stages/"
                        + stageIdByName(stages(owner, ws), "Live"))
                .andExpect(MockMvcResultMatchers.status().isNoContent());
        JsonNode onlyOne = stages(owner, ws);
        assertEquals(1, onlyOne.size());
        apiDelete(owner, ws, "/api/pipeline/stages/" + onlyOne.get(0).get("id").asLong())
                .andExpect(MockMvcResultMatchers.status().isConflict());

        // The surviving offer is still on the board (nothing orphaned).
        JsonNode columns = board(owner, ws);
        assertEquals(1, columns.size());
        assertEquals(offerId, columns.get(0).get("offers").get(0).get("id").asLong());

        // Unknown column ids are 404 for every verb.
        apiDelete(owner, ws, "/api/pipeline/stages/999999999")
                .andExpect(MockMvcResultMatchers.status().isNotFound());
    }

    /** Runs a column move and returns the resulting ordered stage list. */
    private JsonNode apiMove(Account actor, long ws, long stageId, String direction)
            throws Exception {
        var result = apiPost(actor, ws,
                        "/api/pipeline/stages/" + stageId + "/move",
                        "{\"direction\":\"%s\"}".formatted(direction))
                .andExpect(MockMvcResultMatchers.status().isOk())
                .andReturn();
        JsonNode order = read(result);
        assertTrue(order.size() > 0, "move answers with the full order");
        return order;
    }

    /**
     * The board is also the fallback for offers created straight through the
     * repository (stage_id NULL): they show up in the first column instead of
     * disappearing.
     */
    @Test
    void stagelessOffersFallIntoTheFirstColumn() throws Exception {
        Account owner = register("p8-null");
        long ws = uniqueWorkspace(owner, "Null Co");
        long client = repoClient(ws, "Null Client");
        long offerId = repoOffer(ws, client, "Legacy Offer", 1);

        JsonNode columns = board(owner, ws);
        boolean found = false;
        for (JsonNode offer : columns.get(0).get("offers")) {
            if (offer.get("id").asLong() == offerId) {
                assertTrue(offer.get("stageId").isNull(),
                        "stageId stays null, the offer is just rendered first");
                found = true;
            }
        }
        assertTrue(found, "the stageless offer lands in the first column");
        for (int i = 1; i < columns.size(); i++) {
            assertEquals(0, columns.get(i).get("offers").size());
        }
    }
}