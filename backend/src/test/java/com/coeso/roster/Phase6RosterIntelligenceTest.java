package com.coeso.roster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.entity.PlacementStatus;
import java.time.LocalDate;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

/**
 * Phase 6 — roster intelligence and auditability:
 *
 * <ul>
 *   <li>bench aging: unplaced reps report benchDays from the last ended
 *       placement, else the joined date; placed reps report null.</li>
 *   <li>CSV export: same columns the import recognizes, RFC-4180 quoting,
 *       same filters as the list endpoint, and a clean round-trip through
 *       the import preview.</li>
 *   <li>activity feed: /api/audit pages newest-first with actor names,
 *       scoped to the workspace, manager+.</li>
 *   <li>delete guard: a rep with an active placement cannot be soft-deleted
 *       (409); after unplacing, delete succeeds.</li>
 * </ul>
 */
public class Phase6RosterIntelligenceTest extends IntegrationTest {

    /**
     * Workspace with a run-unique name: the external-MySQL test fallback
     * persists between runs, so fixed names would collide on the slug.
     */
    private long uniqueWorkspace(Account owner, String prefix) {
        return createWorkspace(owner, prefix + " "
                + java.util.UUID.randomUUID().toString().substring(0, 8), null);
    }

    /** Id of a seeded default vertical (new workspaces ship with three). */
    private long seededVerticalId(long ws, String name) {
        return tx().execute(s -> entityManager
                .createQuery("select v.id from Vertical v"
                        + " where v.workspaceId = :ws and v.name = :name", Long.class)
                .setParameter("ws", ws)
                .setParameter("name", name)
                .getSingleResult());
    }

    /** Id of a seeded default rep status. */
    private long seededStatusId(long ws, String name) {
        return tx().execute(s -> entityManager
                .createQuery("select s.id from RepStatus s"
                        + " where s.workspaceId = :ws and s.name = :name", Long.class)
                .setParameter("ws", ws)
                .setParameter("name", name)
                .getSingleResult());
    }

    // ------------------------------------------------------------- bench aging

    @Test
    void benchDaysCountsFromLastEndedPlacementThenJoinedDate() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Bench Co");

        // Joined 10 days ago, never placed -> bench clock from joinedDate.
        var created = apiPost(owner, ws, "/api/reps",
                        "{\"name\":\"Fresh Joiner\",\"joinedDate\":\"" + LocalDate.now().minusDays(10) + "\"}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated())
                .andReturn();
        int joinerBench = read(created).get("benchDays").asInt();
        assertEquals(10, joinerBench, "bench days should count from the joined date");

        // Ended placement 3 days ago (joined 100 days ago) -> clock restarted.
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "Offer", 2);
        long roided = repoRep(ws, "Roaming");
        tx().executeWithoutResult(s -> {
            Placement placement = new Placement();
            placement.setWorkspaceId(ws);
            placement.setOfferId(offer);
            placement.setRepId(roided);
            placement.setStatus(PlacementStatus.ENDED);
            placement.setPlacedAt(LocalDateTime.now().minusDays(60));
            placement.setEndedAt(LocalDateTime.now().minusDays(3));
            placementRepository.save(placement);
        });

        var page = apiGet(owner, ws, "/api/reps")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn();
        var items = read(page).get("items");
        boolean sawRestartedClock = false;
        boolean sawPlacedNull = false;
        for (var item : items) {
            if (item.get("name").asText().equals("Roaming")) {
                assertEquals(3, item.get("benchDays").asInt(),
                        "bench clock restarts at the last ended placement");
                sawRestartedClock = true;
            }
            if (item.get("name").asText().equals("Fresh Joiner")) {
                assertEquals(10, item.get("benchDays").asInt());
            }
        }
        assertTrue(sawRestartedClock, "ended-placement rep present in list");

        // A placed rep's bench clock is not running -> null.
        long placedRep = repoRep(ws, "Working");
        repoPlacement(ws, offer, placedRep);
        var page2 = apiGet(owner, ws, "/api/reps")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn();
        for (var item : read(page2).get("items")) {
            if (item.get("name").asText().equals("Working")) {
                assertTrue(item.get("benchDays").isNull(),
                        "placed reps have no bench clock");
                sawPlacedNull = true;
            }
        }
        assertTrue(sawPlacedNull, "placed rep present in list");
    }

    // -------------------------------------------------------------- csv export

    @Test
    void csvExportUsesImportColumnsAndEscapesFields() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Export Co");
        // New workspaces are seeded with Sales/Advertising/Partnerships and
        // Bench/Training/Inactive — reuse the seed rather than re-creating it.
        long vertical = seededVerticalId(ws, "Sales");
        long status = seededStatusId(ws, "Bench");

        apiPost(owner, ws, "/api/reps",
                "{\"name\":\"Comma, \\\"Quoted\\\"\",\"email\":\"comma@example.test\","
                        + "\"verticalId\":" + vertical + ",\"statusId\":" + status
                        + ",\"notes\":\"line one\\nline two\"}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated());

        var result = apiGet(owner, ws, "/api/reps/export")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("Content-Disposition",
                                org.hamcrest.Matchers.containsString("roster-export.csv")))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .content().string(org.hamcrest.Matchers.startsWith(
                                "name,email,discord,vertical,status,experience,notes,joined")))
                .andReturn();
        String csv = responseOf(result);
        assertTrue(csv.contains("\"Comma, \"\"Quoted\"\"\""),
                "comma and quotes must be RFC-4180 escaped: " + csv);
        assertTrue(csv.contains("\"line one\nline two\""),
                "embedded newline must be quoted: " + csv);
        assertTrue(csv.contains("Sales") && csv.contains("Bench"),
                "seeded lookup names exported for round-trip");
    }

    @Test
    void csvExportRoundTripsThroughImportPreview() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Roundtrip Co");
        long vertical = seededVerticalId(ws, "Partnerships");
        apiPost(owner, ws, "/api/reps",
                "{\"name\":\"Round Trip\",\"email\":\"rt@example.test\","
                        + "\"verticalId\":" + vertical + ",\"joinedDate\":\"2026-01-15\"}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated());

        String csv = responseOf(apiGet(owner, ws, "/api/reps/export")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());

        // The exported file must parse cleanly through the importer's own
        // preview: mapping auto-detected, zero error rows.
        var preview = apiPost(owner, ws, "/api/reps/import/preview",
                        "{\"csv\":" + objectMapper.writeValueAsString(csv) + "}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn();
        var body = read(preview);
        assertEquals(0, body.get("errorRows").asInt(),
                "export must re-import without row errors: " + body.toString());
        assertTrue(body.get("validRows").asInt() >= 1, "exported row is valid");
        assertEquals("name", body.get("suggestedMapping").get("name").asText(),
                "header row maps to the name column");
    }

    @Test
    void csvExportHonoursFiltersAndRoles() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Filter Co");
        long sales = seededVerticalId(ws, "Sales");
        long support = seededVerticalId(ws, "Advertising");
        apiPost(owner, ws, "/api/reps",
                "{\"name\":\"Filtered In\",\"verticalId\":" + sales + "}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated());
        apiPost(owner, ws, "/api/reps",
                "{\"name\":\"Filtered Out\",\"verticalId\":" + support + "}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated());

        String csv = responseOf(apiGet(owner, ws, "/api/reps/export?verticalId=" + sales)
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        assertTrue(csv.contains("Filtered In"), "filtered rep exported");
        assertTrue(!csv.contains("Filtered Out"), "other vertical excluded: " + csv);

        // REP role may not export (same bar as the list endpoint).
        Account rep = register("repuser");
        addMember(ws, rep.userId(), WorkspaceRole.REP);
        apiGet(rep, ws, "/api/reps/export")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isForbidden());
    }

    // ------------------------------------------------------------ activity feed

    @Test
    void auditFeedPagesNewestFirstWithActorNames() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Audit Co");
        var first = apiPost(owner, ws, "/api/reps", "{\"name\":\"First Rep\"}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated())
                .andReturn();
        long firstId = read(first).get("id").asLong();
        apiPost(owner, ws, "/api/reps", "{\"name\":\"Second Rep\"}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated());

        var result = apiGet(owner, ws, "/api/audit?page=0&size=1")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn();
        var page = read(result);
        assertEquals(1, page.get("items").size(), "size=1 pages one row");
        assertTrue(page.get("total").asLong() >= 2, "both creates are in the trail");
        var newest = page.get("items").get(0);
        assertEquals("CREATE", newest.get("action").asText());
        assertEquals("rep", newest.get("entityType").asText());
        assertTrue(newest.get("actorUserId").asLong() > 0, "actor recorded");
        assertEquals("Test User", newest.get("actorName").asText(),
                "actor display name resolved");

        // Page 1 holds the older entry.
        var secondPage = apiGet(owner, ws, "/api/audit?page=1&size=1")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn();
        assertEquals(firstId, read(secondPage).get("items").get(0).get("entityId").asLong(),
                "older create on page 1");

        // Scoped: a different workspace sees only its own trail (workspace
        // creation is itself audited), never this workspace's rep entries.
        Account other = register();
        long otherWs = uniqueWorkspace(other, "Other Co");
        var otherFeed = apiGet(other, otherWs, "/api/audit")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn();
        var otherBody = read(otherFeed);
        assertEquals(1, otherBody.get("total").asLong(),
                "only the workspace's own creation is in its feed");
        assertEquals("workspace", otherBody.get("items").get(0).get("entityType").asText(),
                "audit feed is workspace-scoped");

        // REP role cannot read the trail.
        Account rep = register("trailrep");
        addMember(ws, rep.userId(), WorkspaceRole.REP);
        apiGet(rep, ws, "/api/audit")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isForbidden());
    }

    // ------------------------------------------------------------- delete guard

    @Test
    void placedRepCannotBeDeletedUntilUnplaced() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Guard Co");
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "Offer", 1);
        long rep = repoRep(ws, "Placed Rep");
        long placement = repoPlacement(ws, offer, rep);

        apiDelete(owner, ws, "/api/reps/" + rep)
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isConflict());

        // Rep is still live after the refused delete.
        apiGet(owner, ws, "/api/reps")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .jsonPath("$.items[?(@.name == 'Placed Rep')]").exists());

        // Unplace, then delete succeeds.
        apiPost(owner, ws, "/api/placements/" + placement + "/end", "{}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk());
        apiDelete(owner, ws, "/api/reps/" + rep)
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isNoContent());
    }
}
