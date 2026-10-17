package com.coeso.roster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.coeso.roster.common.WorkspaceRole;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.result.MockMvcResultMatchers;

/**
 * Phase 7 — performance, commissions and payouts [PRO]:
 *
 * <ul>
 *   <li>PRO gating: every Phase 7 surface answers 402 PRO_FEATURE_REQUIRED on
 *       the free plan and works after an upgrade;</li>
 *   <li>activity logging: manager+ log anywhere, reps only for their own
 *       linked rep; reps edit only their own rows inside the 7-day window;</li>
 *   <li>the earnings ledger is append-only — corrections append reversal rows
 *       (originals untouched), paid rows can never be reversed, and no HTTP
 *       route mutates a ledger row;</li>
 *   <li>commission math wires up per rule type (percent, flat, tiered);</li>
 *   <li>payouts batch approved entries per rep with CSV export;</li>
 *   <li>leaderboard ranks by period+metric and masks other reps' names from
 *       reps until the workspace setting shares them;</li>
 *   <li>reps can never see other reps' earnings.</li>
 * </ul>
 */
public class Phase7PerformanceTest extends IntegrationTest {

    private long uniqueWorkspace(Account owner, String prefix) {
        return createWorkspace(owner, prefix + " "
                + UUID.randomUUID().toString().substring(0, 8), null);
    }

    /** Moves the workspace onto the pro plan (test fixture, no HTTP). */
    private void upgradePlan(long ws, String planCode) {
        tx().executeWithoutResult(s -> {
            var plan = entityManager
                    .createQuery("select p from Plan p where p.code = :code",
                            com.coeso.roster.entity.Plan.class)
                    .setParameter("code", planCode)
                    .getSingleResult();
            var workspace = entityManager.find(com.coeso.roster.entity.Workspace.class, ws);
            workspace.setPlan(plan);
            entityManager.flush();
        });
    }

    /** Links a user's membership to a rep profile (the "my rows" identity). */
    private void linkRep(long ws, long userId, Long repId) {
        var membership = membershipRepository
                .findByUserIdAndWorkspaceId(userId, ws).orElseThrow();
        membership.setRepId(repId);
        membershipRepository.save(membership);
    }

    private long seededMetric(long ws, String name) {
        return tx().execute(s -> entityManager
                .createQuery("select m.id from MetricType m"
                        + " where m.workspaceId = :ws and m.name = :name", Long.class)
                .setParameter("ws", ws)
                .setParameter("name", name)
                .getSingleResult());
    }

    private long logEntry(Account actor, long ws, long placementId, long metricId,
                          String occurredOn, long valueMinor) throws Exception {
        var result = apiPost(actor, ws, "/api/activity", """
                {"placementId":%d,"metricTypeId":%d,"occurredOn":"%s","valueMinor":%d}
                """.formatted(placementId, metricId, occurredOn, valueMinor))
                .andExpect(MockMvcResultMatchers.status().isCreated())
                .andReturn();
        return read(result).get("id").asLong();
    }

    private JsonNode earnings(Account actor, long ws, String query) throws Exception {
        var result = apiGet(actor, ws, "/api/earnings" + query)
                .andExpect(MockMvcResultMatchers.status().isOk())
                .andReturn();
        return read(result);
    }

    // ------------------------------------------------------------- PRO gate

    @Test
    void everyPhase7SurfaceIsProGatedThenWorksAfterUpgrade() throws Exception {
        Account owner = register("p7-gate");
        long ws = uniqueWorkspace(owner, "Gate Co");
        long client = repoClient(ws, "Gate Client");
        long rep = repoRep(ws, "Gate Rep");
        long offer = repoOffer(ws, client, "Gate Offer", 2);
        long placement = repoPlacement(ws, offer, rep);
        long revenueMetric = seededMetric(ws, "Revenue generated");

        // Free plan: every surface answers 402 with a clear upgrade message.
        for (String path : new String[]{"/api/metric-types", "/api/activity",
                "/api/earnings", "/api/payouts", "/api/commission-rules",
                "/api/leaderboard?metricTypeId=" + revenueMetric}) {
            var result = apiGet(owner, ws, path)
                    .andExpect(MockMvcResultMatchers.status().isPaymentRequired())
                    .andExpect(MockMvcResultMatchers.jsonPath("$.code")
                            .value("PRO_FEATURE_REQUIRED"))
                    .andReturn();
            assertTrue(responseOf(result).contains("Upgrade"),
                    "402 must carry an upgrade message: " + path);
        }
        apiPost(owner, ws, "/api/activity",
                        "{\"placementId\":" + placement + ",\"metricTypeId\":"
                                + revenueMetric + ",\"occurredOn\":\"" + LocalDate.now()
                                + "\",\"valueMinor\":100}")
                .andExpect(MockMvcResultMatchers.status().isPaymentRequired());
        apiPost(owner, ws, "/api/commission-rules", "{\"kind\":\"percent\"}")
                .andExpect(MockMvcResultMatchers.status().isPaymentRequired());

        // Upgraded: the same reads now answer 200.
        upgradePlan(ws, "pro");
        apiGet(owner, ws, "/api/metric-types")
                .andExpect(MockMvcResultMatchers.status().isOk());
        apiGet(owner, ws, "/api/activity")
                .andExpect(MockMvcResultMatchers.status().isOk());
        apiGet(owner, ws, "/api/earnings")
                .andExpect(MockMvcResultMatchers.status().isOk());
        apiGet(owner, ws, "/api/leaderboard?metricTypeId=" + revenueMetric)
                .andExpect(MockMvcResultMatchers.status().isOk());
    }

    // -------------------------------------------------------- activity rules

    @Test
    void activityLoggingHonoursRolesAndTheSevenDayRepWindow() throws Exception {
        Account owner = register("p7-act");
        long ws = uniqueWorkspace(owner, "Activity Co");
        upgradePlan(ws, "pro");
        long revenue = seededMetric(ws, "Revenue generated");
        long calls = seededMetric(ws, "Calls");

        long client = repoClient(ws, "Act Client");
        long ownerOffer = repoOffer(ws, client, "Owner Offer", 2);
        long ownerPlacement = repoPlacement(ws, ownerOffer, repoRep(ws, "Owner Rep"));

        // Manager+ can log for anyone.
        long owned = logEntry(owner, ws, ownerPlacement, revenue,
                LocalDate.now().toString(), 100_000);

        // A rep linked to their own rep row: only their own placements.
        Account repUser = register("p7-actrep");
        addMember(ws, repUser.userId(), WorkspaceRole.REP);
        long selfRep = repoRep(ws, "Self Rep");
        linkRep(ws, repUser.userId(), selfRep);
        long selfOffer = repoOffer(ws, client, "Self Offer", 2);
        long selfPlacement = repoPlacement(ws, selfOffer, selfRep);

        apiPost(repUser, ws, "/api/activity",
                        "{\"placementId\":" + selfPlacement + ",\"metricTypeId\":" + calls
                                + ",\"occurredOn\":\"" + LocalDate.now()
                                + "\",\"valueMinor\":5}")
                .andExpect(MockMvcResultMatchers.status().isCreated());
        apiPost(repUser, ws, "/api/activity",
                        "{\"placementId\":" + ownerPlacement + ",\"metricTypeId\":" + calls
                                + ",\"occurredOn\":\"" + LocalDate.now()
                                + "\",\"valueMinor\":5}")
                .andExpect(MockMvcResultMatchers.status().isForbidden());

        // Rep's own fresh entry: editable. An 8-day-old one: outside the window.
        JsonNode page = read(apiGet(repUser, ws, "/api/activity")
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        long freshId = page.get("items").get(0).get("id").asLong();
        apiPut(repUser, ws, "/api/activity/" + freshId, "{\"valueMinor\":7}")
                .andExpect(MockMvcResultMatchers.status().isOk());

        long oldId = logEntry(repUser, ws, selfPlacement, calls,
                LocalDate.now().minusDays(8).toString(), 1);
        apiPut(repUser, ws, "/api/activity/" + oldId, "{\"valueMinor\":9}")
                .andExpect(MockMvcResultMatchers.status().isForbidden());

        // Reps cannot touch other people's rows, nor delete at all.
        apiPut(repUser, ws, "/api/activity/" + owned, "{\"valueMinor\":1}")
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        apiDelete(repUser, ws, "/api/activity/" + freshId)
                .andExpect(MockMvcResultMatchers.status().isForbidden());

        // A manager can edit and delete anything.
        apiPut(owner, ws, "/api/activity/" + freshId, "{\"valueMinor\":9}")
                .andExpect(MockMvcResultMatchers.status().isOk());
        apiDelete(owner, ws, "/api/activity/" + freshId)
                .andExpect(MockMvcResultMatchers.status().isNoContent());

        // Rep listing is clamped to their own rows; asking for another rep 403s.
        JsonNode repView = read(apiGet(repUser, ws, "/api/activity")
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        for (JsonNode item : repView.get("items")) {
            assertEquals(selfRep, item.get("repId").asLong(),
                    "reps only ever see their own activity");
        }
        apiGet(repUser, ws, "/api/activity?repId=" + selfRep)
                .andExpect(MockMvcResultMatchers.status().isOk());

        // Log metadata (the placement picker) is open to every member; reps
        // only ever see their own placements in it.
        Account admin = register("p7-actadmin");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        Account manager = register("p7-actmgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        for (Account actor : new Account[]{owner, admin, manager, repUser}) {
            apiGet(actor, ws, "/api/activity/meta")
                    .andExpect(MockMvcResultMatchers.status().isOk());
        }
        JsonNode ownerMeta = read(apiGet(owner, ws, "/api/activity/meta")
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        boolean ownerSeesAll = false;
        for (JsonNode row : ownerMeta) {
            if (row.get("placementId").asLong() == ownerPlacement) {
                ownerSeesAll = true;
            }
        }
        assertTrue(ownerSeesAll, "manager+ sees every placement to log against");
        JsonNode repMeta = read(apiGet(repUser, ws, "/api/activity/meta")
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        for (JsonNode row : repMeta) {
            assertEquals(selfPlacement, row.get("placementId").asLong(),
                    "reps only see their own placements in the picker");
        }
    }

    // ------------------------------------------------------- ledger behavior

    @Test
    void ledgerIsAppendOnlyWithReversingCorrectionsAndPayoutProtection() throws Exception {
        Account owner = register("p7-ledger");
        long ws = uniqueWorkspace(owner, "Ledger Co");
        upgradePlan(ws, "pro");
        long revenue = seededMetric(ws, "Revenue generated");
        long client = repoClient(ws, "Led Client");
        long offer = repoOffer(ws, client, "Led Offer", 5);
        long rep = repoRep(ws, "Led Rep");
        long placement = repoPlacement(ws, offer, rep);

        // Workspace default: 10% of revenue.
        apiPost(owner, ws, "/api/commission-rules",
                        "{\"kind\":\"percent\",\"rateBp\":1000,\"currency\":\"USD\"}")
                .andExpect(MockMvcResultMatchers.status().isCreated());

        // 1000.00 revenue → 100.00 accrued.
        long entry = logEntry(owner, ws, placement, revenue,
                LocalDate.now().toString(), 100_000);
        JsonNode afterAccrual = earnings(owner, ws, "");
        assertEquals(10_000L, afterAccrual.get("netMinor").asLong());
        assertEquals(1, afterAccrual.get("total").asInt());
        assertEquals(10_000L,
                afterAccrual.get("items").get(0).get("amountMinor").asLong());
        assertEquals("accrued", afterAccrual.get("items").get(0).get("status").asText());

        // Correcting the entry appends a reversal + a fresh accrual; the
        // original row is never edited in place.
        apiPut(owner, ws, "/api/activity/" + entry, "{\"valueMinor\":200000}")
                .andExpect(MockMvcResultMatchers.status().isOk());
        JsonNode corrected = earnings(owner, ws, "");
        assertEquals(3, corrected.get("total").asInt(), "original + reversal + new");
        long net = corrected.get("netMinor").asLong();
        assertEquals(20_000L, net, "net = the corrected 10% of 2000.00");
        boolean sawOriginal = false;
        boolean sawReversal = false;
        for (JsonNode item : corrected.get("items")) {
            if (item.get("amountMinor").asLong() == 10_000L) {
                sawOriginal = true; // untouched original still there
            }
            if (item.get("reversal").asBoolean()) {
                assertEquals(-10_000L, item.get("amountMinor").asLong());
                assertEquals("accrued", item.get("status").asText(),
                        "reversal copies the original status");
                assertNotNull(item.get("reversesEntryId"));
                sawReversal = true;
            }
        }
        assertTrue(sawOriginal && sawReversal, "append-only correction trail");

        // Approve the fresh accrual, pay it out — after that it is frozen.
        long approvedId = -1;
        for (JsonNode item : corrected.get("items")) {
            if (item.get("amountMinor").asLong() == 20_000L
                    && !item.get("reversal").asBoolean()) {
                approvedId = item.get("id").asLong();
            }
        }
        assertTrue(approvedId > 0);
        apiPost(owner, ws, "/api/earnings/" + approvedId + "/approve", "{}")
                .andExpect(MockMvcResultMatchers.status().isOk());
        apiPost(owner, ws, "/api/earnings/" + approvedId + "/approve", "{}")
                .andExpect(MockMvcResultMatchers.status().isConflict());
        apiPost(owner, ws, "/api/payouts",
                        "{\"entryIds\":[" + approvedId + "],\"paidOn\":\""
                                + LocalDate.now() + "\",\"referenceNote\":\"wire 1\"}")
                .andExpect(MockMvcResultMatchers.status().isCreated());

        // Editing revenue whose earnings are already paid → 409, and the edit
        // rolls back (value unchanged).
        apiPut(owner, ws, "/api/activity/" + entry, "{\"valueMinor\":300000}")
                .andExpect(MockMvcResultMatchers.status().isConflict())
                .andExpect(MockMvcResultMatchers.jsonPath("$.message")
                        .value(org.hamcrest.Matchers.containsString("paid")));
        JsonNode page = read(apiGet(owner, ws, "/api/activity")
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        assertEquals(200_000L, page.get("items").get(0).get("valueMinor").asLong(),
                "the failed edit rolled back");

        // No HTTP route can mutate a ledger row directly.
        apiPut(owner, ws, "/api/earnings/" + approvedId, "{\"amountMinor\":1}")
                .andExpect(MockMvcResultMatchers.status().isNotFound());
        apiDelete(owner, ws, "/api/earnings/" + approvedId)
                .andExpect(MockMvcResultMatchers.status().isNotFound());

        // Flat rule: one new entry → flat accrual.
        apiPost(owner, ws, "/api/commission-rules",
                        "{\"kind\":\"flat\",\"flatMinor\":750,\"currency\":\"USD\"}")
                .andExpect(MockMvcResultMatchers.status().isCreated());
        logEntry(owner, ws, placement, revenue, LocalDate.now().toString(), 999);
        // Tiered rule: 5% to 1000.00, 20% above → 1500.00 revenue earns 150.00.
        apiPost(owner, ws, "/api/commission-rules",
                        "{\"kind\":\"tiered\",\"currency\":\"USD\",\"tiers\":["
                                + "{\"upToMinor\":100000,\"rateBp\":500},"
                                + "{\"upToMinor\":null,\"rateBp\":2000}]}")
                .andExpect(MockMvcResultMatchers.status().isCreated());
        logEntry(owner, ws, placement, revenue, LocalDate.now().toString(), 150_000);

        JsonNode finalLedger = earnings(owner, ws, "");
        boolean sawFlat = false;
        boolean sawTiered = false;
        for (JsonNode item : finalLedger.get("items")) {
            if (item.get("amountMinor").asLong() == 750L) {
                sawFlat = true;
            }
            if (item.get("amountMinor").asLong() == 15_000L) {
                sawTiered = true;
            }
        }
        assertTrue(sawFlat, "flat rule wired through the accrual engine");
        assertTrue(sawTiered, "tiered rule wired through the accrual engine");

        // Audit trail recorded the ledger movements.
        JsonNode feed = read(apiGet(owner, ws, "/api/audit?size=100")
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        boolean sawLedgerCreate = false;
        boolean sawPayoutCreate = false;
        for (JsonNode item : feed.get("items")) {
            if ("ledger_entry".equals(item.get("entityType").asText())) {
                sawLedgerCreate = true;
            }
            if ("payout".equals(item.get("entityType").asText())) {
                sawPayoutCreate = true;
            }
        }
        assertTrue(sawLedgerCreate && sawPayoutCreate, "ledger + payout audited");
    }

    // ----------------------------------------------------------- isolation

    @Test
    void repCannotSeeOtherRepsEarnings() throws Exception {
        Account owner = register("p7-iso");
        long ws = uniqueWorkspace(owner, "Iso Co");
        upgradePlan(ws, "pro");
        long revenue = seededMetric(ws, "Revenue generated");
        long client = repoClient(ws, "Iso Client");
        long offer = repoOffer(ws, client, "Iso Offer", 5);
        long repA = repoRep(ws, "Rep A");
        long repB = repoRep(ws, "Rep B");
        long placementA = repoPlacement(ws, offer, repA);
        long placementB = repoPlacement(ws, offer, repB);

        apiPost(owner, ws, "/api/commission-rules",
                "{\"kind\":\"percent\",\"rateBp\":1000,\"currency\":\"USD\"}")
                .andExpect(MockMvcResultMatchers.status().isCreated());
        logEntry(owner, ws, placementA, revenue, LocalDate.now().toString(), 10_000);
        logEntry(owner, ws, placementB, revenue, LocalDate.now().toString(), 40_000);

        Account repUserA = register("p7-isorep");
        addMember(ws, repUserA.userId(), WorkspaceRole.REP);
        linkRep(ws, repUserA.userId(), repA);

        // Own rows only — and asking for the other rep is a 403.
        JsonNode own = earnings(repUserA, ws, "");
        assertEquals(1, own.get("total").asInt());
        for (JsonNode item : own.get("items")) {
            assertEquals(repA, item.get("repId").asLong());
        }
        apiGet(repUserA, ws, "/api/earnings?repId=" + repB)
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        apiGet(repUserA, ws, "/api/earnings?repId=" + repA)
                .andExpect(MockMvcResultMatchers.status().isOk());

        // Manager sees both.
        JsonNode all = earnings(owner, ws, "?repId=" + repB);
        assertEquals(1, all.get("total").asInt());
        assertEquals(4_000L, all.get("items").get(0).get("amountMinor").asLong());
    }

    // --------------------------------------------------------------- payouts

    @Test
    void payoutsBatchApprovedEntriesPerRepAndExportCsv() throws Exception {
        Account owner = register("p7-pay");
        long ws = uniqueWorkspace(owner, "Pay Co");
        upgradePlan(ws, "pro");
        long revenue = seededMetric(ws, "Revenue generated");
        long client = repoClient(ws, "Pay Client");
        long offer = repoOffer(ws, client, "Pay Offer", 5);
        long rep = repoRep(ws, "Paid Rep");
        long placement = repoPlacement(ws, offer, rep);

        apiPost(owner, ws, "/api/commission-rules",
                "{\"kind\":\"percent\",\"rateBp\":1000,\"currency\":\"USD\"}")
                .andExpect(MockMvcResultMatchers.status().isCreated());
        logEntry(owner, ws, placement, revenue, LocalDate.now().toString(), 50_000);
        logEntry(owner, ws, placement, revenue, LocalDate.now().toString(), 30_000);

        var approved = new java.util.ArrayList<Long>();
        for (JsonNode item : earnings(owner, ws, "?status=accrued").get("items")) {
            approved.add(item.get("id").asLong());
        }
        assertEquals(2, approved.size());
        for (Long id : approved) {
            apiPost(owner, ws, "/api/earnings/" + id + "/approve", "{}")
                    .andExpect(MockMvcResultMatchers.status().isOk());
        }

        // An unapproved entry poisons the batch.
        long pendingActivity = logEntry(owner, ws, placement, revenue,
                LocalDate.now().toString(), 10_000);
        long pendingLedger = -1;
        for (JsonNode item : earnings(owner, ws, "?status=accrued").get("items")) {
            if (item.get("activityEntryId").asLong() == pendingActivity) {
                pendingLedger = item.get("id").asLong();
            }
        }
        assertTrue(pendingLedger > 0, "the new revenue accrued a ledger row");
        apiPost(owner, ws, "/api/payouts",
                        "{\"entryIds\":[" + approved.get(0) + "," + pendingLedger
                                + "],\"paidOn\":\"" + LocalDate.now() + "\"}")
                .andExpect(MockMvcResultMatchers.status().isConflict());

        // One rep per payout.
        long otherRep = repoRep(ws, "Other Paid Rep");
        long otherPlacement = repoPlacement(ws, repoOffer(ws, client, "Other", 5), otherRep);
        logEntry(owner, ws, otherPlacement, revenue, LocalDate.now().toString(), 10_000);
        long otherAccrued = -1;
        for (JsonNode item : earnings(owner, ws, "?status=accrued").get("items")) {
            if (item.get("repId").asLong() == otherRep) {
                otherAccrued = item.get("id").asLong();
            }
        }
        apiPost(owner, ws, "/api/payouts",
                        "{\"entryIds\":[" + approved.get(0) + "," + otherAccrued
                                + "],\"paidOn\":\"" + LocalDate.now() + "\"}")
                .andExpect(MockMvcResultMatchers.status().isConflict());

        // The real batch goes through; totals and statuses line up.
        var created = apiPost(owner, ws, "/api/payouts",
                        "{\"entryIds\":[" + approved.get(0) + "," + approved.get(1)
                                + "],\"paidOn\":\"" + LocalDate.now()
                                + "\",\"referenceNote\":\"Oct wire\"}")
                .andExpect(MockMvcResultMatchers.status().isCreated())
                .andReturn();
        JsonNode payout = read(created);
        assertEquals(8_000L, payout.get("amountMinor").asLong());
        assertEquals(2, payout.get("entryCount").asInt());
        assertEquals("USD", payout.get("currency").asText());

        JsonNode paid = earnings(owner, ws, "?status=paid");
        assertEquals(2, paid.get("total").asInt(), "batched entries are now paid");

        // Double-paying the same entries is refused.
        apiPost(owner, ws, "/api/payouts",
                        "{\"entryIds\":[" + approved.get(0) + "],\"paidOn\":\""
                                + LocalDate.now() + "\"}")
                .andExpect(MockMvcResultMatchers.status().isConflict());

        // CSV export for the payment run.
        String csv = responseOf(apiGet(owner, ws, "/api/payouts/export")
                .andExpect(MockMvcResultMatchers.status().isOk())
                .andExpect(MockMvcResultMatchers.header().string("Content-Disposition",
                        org.hamcrest.Matchers.containsString("payout-export.csv")))
                .andReturn());
        assertTrue(csv.startsWith("id,rep,paid_on,entries,amount_minor,currency,reference"));
        assertTrue(csv.contains("Oct wire"), "reference note exported: " + csv);
        assertTrue(csv.contains("8000"), "integer minor units in the export");

        // Reps may not see org payout runs at all.
        Account repUser = register("p7-payrep");
        addMember(ws, repUser.userId(), WorkspaceRole.REP);
        apiGet(repUser, ws, "/api/payouts")
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        apiGet(repUser, ws, "/api/payouts/export")
                .andExpect(MockMvcResultMatchers.status().isForbidden());
    }

    // ------------------------------------------------------------ leaderboard

    @Test
    void leaderboardRanksByPeriodAndMasksRepNamesUntilTheSettingSaysOtherwise()
            throws Exception {
        Account owner = register("p7-board");
        long ws = uniqueWorkspace(owner, "Board Co");
        upgradePlan(ws, "pro");
        long calls = seededMetric(ws, "Calls");
        long client = repoClient(ws, "Board Client");

        long r1 = repoRep(ws, "Leader One");
        long r2 = repoRep(ws, "Leader Two");
        long r3 = repoRep(ws, "Leader Three");
        logEntry(owner, ws, repoPlacement(ws, repoOffer(ws, client, "B1", 1), r1),
                calls, LocalDate.now().toString(), 5);
        logEntry(owner, ws, repoPlacement(ws, repoOffer(ws, client, "B2", 1), r2),
                calls, LocalDate.now().toString(), 9);
        logEntry(owner, ws, repoPlacement(ws, repoOffer(ws, client, "B3", 1), r3),
                calls, LocalDate.now().toString(), 3);

        // Manager view: names, ranks, sorted best-first.
        JsonNode board = read(apiGet(owner, ws,
                        "/api/leaderboard?period=month&metricTypeId=" + calls)
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        assertTrue(board.get("showNames").asBoolean());
        assertEquals("Leader Two", board.get("items").get(0).get("repName").asText());
        assertEquals(9, board.get("items").get(0).get("value").asLong());
        assertEquals(1, board.get("items").get(0).get("rank").asInt());
        assertEquals(3, board.get("items").size());

        // Rep view with the default (off) setting: only their own identity.
        Account repUser = register("p7-boardrep");
        addMember(ws, repUser.userId(), WorkspaceRole.REP);
        linkRep(ws, repUser.userId(), r1);
        JsonNode repBoard = read(apiGet(repUser, ws,
                        "/api/leaderboard?period=month&metricTypeId=" + calls)
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        assertTrue(!repBoard.get("showNames").asBoolean(),
                "names hidden for reps by default");
        assertEquals(2, repBoard.get("selfRank").asInt(), "rep knows their own rank");
        for (JsonNode row : repBoard.get("items")) {
            if (row.get("self").asBoolean()) {
                assertEquals("Leader One", row.get("repName").asText(),
                        "reps always see themselves");
            }
        }
        boolean sawMasked = false;
        for (JsonNode row : repBoard.get("items")) {
            if (!row.get("self").asBoolean()) {
                assertTrue(row.get("repName").isNull() || row.get("repName").asText().isEmpty(),
                        "other reps' names are masked: " + row.toPrettyString());
                sawMasked = true;
            }
        }
        assertTrue(sawMasked, "the leader rows exist but are masked");

        // Owner flips the workspace setting; reps now see names.
        apiPut(owner, ws, "/api/workspaces/settings",
                        "{\"leaderboardShowNames\":true}")
                .andExpect(MockMvcResultMatchers.status().isOk());
        JsonNode shared = read(apiGet(repUser, ws,
                        "/api/leaderboard?period=month&metricTypeId=" + calls)
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        assertTrue(shared.get("showNames").asBoolean());
        assertEquals("Leader Two", shared.get("items").get(0).get("repName").asText());

        // Only admins+ change the setting; a custom period needs dates.
        Account manager = register("p7-boardmgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        apiPut(manager, ws, "/api/workspaces/settings",
                        "{\"leaderboardShowNames\":false}")
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        apiGet(owner, ws, "/api/leaderboard?period=custom&metricTypeId=" + calls)
                .andExpect(MockMvcResultMatchers.status().isBadRequest());
        apiGet(owner, ws, "/api/leaderboard?period=week&metricTypeId=" + calls)
                .andExpect(MockMvcResultMatchers.status().isOk());
    }

    // ------------------------------------------------------------ config & matrix

    @Test
    void metricConfigFollowsLookupBarsAndDefaultsShipSeeded() throws Exception {
        Account owner = register("p7-cfg");
        long ws = uniqueWorkspace(owner, "Config Co");
        upgradePlan(ws, "pro");

        // Defaults are seeded for every workspace.
        JsonNode metrics = read(apiGet(owner, ws, "/api/metric-types")
                .andExpect(MockMvcResultMatchers.status().isOk()).andReturn());
        assertEquals(4, metrics.size());
        String revenueUnit = null;
        for (JsonNode metric : metrics) {
            if (metric.get("name").asText().equals("Revenue generated")) {
                revenueUnit = metric.get("unit").asText();
            }
        }
        assertEquals("currency", revenueUnit);

        // Custom metric creation follows the lookup write bar (admin+).
        Account manager = register("p7-cfgmgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        Account admin = register("p7-cfgadmin");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        Account rep = register("p7-cfgrep");
        addMember(ws, rep.userId(), WorkspaceRole.REP);

        apiPost(rep, ws, "/api/metric-types", "{\"name\":\"Demos\",\"unit\":\"count\"}")
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        apiPost(manager, ws, "/api/metric-types", "{\"name\":\"Demos\",\"unit\":\"count\"}")
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        var created = apiPost(admin, ws, "/api/metric-types",
                        "{\"name\":\"Demos\",\"unit\":\"count\"}")
                .andExpect(MockMvcResultMatchers.status().isCreated())
                .andReturn();
        long demoId = read(created).get("id").asLong();

        // Reads are open to every member (after the PRO gate).
        apiGet(rep, ws, "/api/metric-types")
                .andExpect(MockMvcResultMatchers.status().isOk());

        // Duplicate names are refused; used metrics cannot be deleted.
        apiPost(owner, ws, "/api/metric-types", "{\"name\":\"demos\",\"unit\":\"count\"}")
                .andExpect(MockMvcResultMatchers.status().isConflict());
        apiDelete(owner, ws, "/api/metric-types/" + demoId)
                .andExpect(MockMvcResultMatchers.status().isNoContent());

        long client = repoClient(ws, "Cfg Client");
        long placement = repoPlacement(ws, repoOffer(ws, client, "Cfg", 1),
                repoRep(ws, "Cfg Rep"));
        long calls = seededMetric(ws, "Calls");
        logEntry(owner, ws, placement, calls, LocalDate.now().toString(), 1);
        apiDelete(owner, ws, "/api/metric-types/" + calls)
                .andExpect(MockMvcResultMatchers.status().isConflict());

        // Commission rules and payouts stay manager+.
        apiGet(rep, ws, "/api/commission-rules")
                .andExpect(MockMvcResultMatchers.status().isForbidden());
        apiPost(manager, ws, "/api/commission-rules",
                        "{\"kind\":\"percent\",\"rateBp\":500,\"currency\":\"USD\"}")
                .andExpect(MockMvcResultMatchers.status().isCreated());
        // Bad rule shapes are rejected clearly.
        apiPost(owner, ws, "/api/commission-rules",
                        "{\"kind\":\"tiered\",\"currency\":\"USD\",\"tiers\":[]}")
                .andExpect(MockMvcResultMatchers.status().isBadRequest());
        apiPost(owner, ws, "/api/commission-rules",
                        "{\"kind\":\"percent\",\"rateBp\":1000}")
                .andExpect(MockMvcResultMatchers.status().isBadRequest());
    }
}