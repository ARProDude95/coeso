package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.health.DigestJob;
import com.coeso.roster.health.DigestService;
import com.coeso.roster.health.HealthRepos;
import com.coeso.roster.health.Summarizer;
import com.coeso.roster.health.TemplateSummarizer;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;

/**
 * Weekly digest (feature 5, PROGRESS "Next steps" #2):
 *  - building renders the templated plain text (activity, new members, top
 *    contributors, pipeline) and stores exactly one row per (workspace, ISO
 *    week) — repeat builds are no-ops,
 *  - reads are admin+ and tenant-scoped (404 elsewhere, never another
 *    workspace's body),
 *  - the system-wide build the cron calls works without a tenant context and
 *    is idempotent across all active workspaces,
 *  - the schedule itself is disabled in tests (job bean absent) while the
 *    templated Summarizer is asserted directly against a Facts fixture,
 *  - phase 12: the digest is [PRO] — 402 on the free plan, building after an
 *    upgrade, and the Monday job skips (never fails on) workspaces below Pro.
 */
class DigestTest extends IntegrationTest {

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    @Autowired private DigestService digestService;
    @Autowired private HealthRepos.DigestLogRepository digestLogs;
    @Autowired private ApplicationContext applicationContext;

    @Test
    void buildRendersStoresAndStaysIdempotent() throws Exception {
        Account owner = register("dg-build");
        long ws = createWorkspace(owner, "Digest Build " + sfx, null);
        moveToPlan(ws, "pro");
        Account member = register("dg-build-m");
        addMember(ws, member.userId(), WorkspaceRole.MANAGER);

        // A guaranteed audit row: the profile save always writes one, so the
        // member shows up as this week's top contributor.
        apiPut(member, ws, "/api/intros/profile",
                "{\"industry\":\"SaaS\",\"offeringTags\":[\"tag\"]}")
                .andExpect(status().isOk());
        // One open deal for the pipeline line.
        long client = repoClient(ws, "Digest Client " + sfx);
        repoOffer(ws, client, "Digest AE", 1);

        // Nothing built yet: GET says so instead of inventing an empty digest.
        apiGet(owner, ws, "/api/digest").andExpect(status().isNotFound());

        var first = read(apiPost(owner, ws, "/api/digest/build", null).andReturn());
        long id = first.get("id").asLong();
        String body = first.get("body").asText();
        assertThat(first.get("weekStart").asText()).isEqualTo(monday().toString());
        assertThat(body)
                .contains("Weekly digest — Digest Build " + sfx)
                .contains("Week of " + monday())
                .contains("Top contributors: Test User (1)")
                .contains("New members: Test User")
                .contains("Pipeline: 1 open offer · 0 bookings (last 7d) "
                        + "· 0 pending intro requests")
                .contains("· 0 pod check-ins");

        // Second build for the same week: same row back, still one row stored.
        var again = read(apiPost(owner, ws, "/api/digest/build", null).andReturn());
        assertThat(again.get("id").asLong()).isEqualTo(id);
        assertThat(digestLogs.countByWorkspaceIdAndWeekStart(ws, monday())).isEqualTo(1);

        // GET returns the stored digest.
        apiGet(owner, ws, "/api/digest").andExpect(status().isOk())
                .andExpect(jsonPath("$.weekStart").value(monday().toString()))
                .andExpect(jsonPath("$.body").value(body));
    }

    @Test
    void readsAreAdminGatedAndTenantScoped() throws Exception {
        Account owner = register("dg-role");
        long ws = createWorkspace(owner, "Digest Role " + sfx, null);
        moveToPlan(ws, "pro");
        Account manager = register("dg-role-m");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        apiPost(owner, ws, "/api/digest/build", null).andExpect(status().isOk());

        // The digest names every member's activity: management summary only.
        apiGet(manager, ws, "/api/digest").andExpect(status().isForbidden());
        apiPost(manager, ws, "/api/digest/build", null).andExpect(status().isForbidden());

        // Another workspace: its own digest history is empty (404), and the
        // body it builds names only itself.
        Account other = register("dg-role-b");
        long wsB = createWorkspace(other, "Digest Role B " + sfx, null);
        moveToPlan(wsB, "pro");
        apiGet(other, wsB, "/api/digest").andExpect(status().isNotFound());
        var bDigest = read(apiPost(other, wsB, "/api/digest/build", null).andReturn());
        assertThat(bDigest.get("body").asText())
                .contains("Digest Role B " + sfx)
                .doesNotContain("Digest Role " + sfx);

        // A's digest is untouched by B's build.
        var aDigest = read(apiGet(owner, ws, "/api/digest").andReturn());
        assertThat(aDigest.get("body").asText()).contains("Digest Role " + sfx);
    }

    @Test
    void systemWideBuildIsIdempotentAndJobScheduleIsOffInTests() {
        Account owner = register("dg-all");
        long ws = createWorkspace(owner, "Digest All " + sfx, null);
        moveToPlan(ws, "pro");

        // The cron's entry point: no tenant context on this thread at all.
        digestService.buildAllForActiveWorkspaces();
        assertThat(digestLogs.countByWorkspaceIdAndWeekStart(ws, monday())).isEqualTo(1);

        // Second run in the same week changes nothing.
        digestService.buildAllForActiveWorkspaces();
        assertThat(digestLogs.countByWorkspaceIdAndWeekStart(ws, monday())).isEqualTo(1);

        var row = digestLogs.findFirstByWorkspaceIdAndWeekStart(ws, monday()).orElseThrow();
        assertThat(row.getWorkspaceId()).isEqualTo(ws);
        assertThat(row.getBody()).contains("Digest All " + sfx);

        // Guard asserted: the schedule is disabled in the test context, so no
        // cron can race these assertions (DigestTest drives the service).
        assertThat(applicationContext.getBeansOfType(DigestJob.class)).isEmpty();
    }

    @Test
    void freePlanAnswers402AndTheMondayJobSkipsIt() throws Exception {
        Account owner = register("dg-pro");
        long ws = createWorkspace(owner, "Digest Free " + sfx, null); // free plan

        apiGet(owner, ws, "/api/digest")
                .andExpect(status().isPaymentRequired())
                .andExpect(jsonPath("$.code").value("PRO_FEATURE_REQUIRED"))
                .andExpect(jsonPath("$.details.feature").value("weekly digest"))
                .andExpect(jsonPath("$.details.planRequired").value("pro"));
        apiPost(owner, ws, "/api/digest/build", null)
                .andExpect(status().isPaymentRequired())
                .andExpect(jsonPath("$.code").value("PRO_FEATURE_REQUIRED"));

        // The cron path skips below-Pro workspaces: no digest row, no Discord
        // delivery, and nothing for the next run to inherit.
        digestService.buildAllForActiveWorkspaces();
        assertThat(digestLogs.countByWorkspaceIdAndWeekStart(ws, monday())).isZero();

        // Upgrade unlocks the same surface; the first build is the usual one.
        moveToPlan(ws, "pro");
        var built = read(apiPost(owner, ws, "/api/digest/build", null).andReturn());
        assertThat(built.get("body").asText()).contains("Digest Free " + sfx);
        assertThat(digestLogs.countByWorkspaceIdAndWeekStart(ws, monday())).isEqualTo(1);
        apiGet(owner, ws, "/api/digest").andExpect(status().isOk());
    }

    @Test
    void templateSummarizerRendersEveryFactDeterministically() {
        var facts = new Summarizer.Facts(
                "Acme HQ", monday(), 5, 4,
                2, List.of("Ada", "Grace"),
                List.of(new Summarizer.Contributor("Grace", 9),
                        new Summarizer.Contributor("Ada", 3)),
                6, 2, 1);
        assertThat(new TemplateSummarizer().summarize(facts)).isEqualTo(
                "Weekly digest — Acme HQ\n"
                        + "Week of " + monday() + "\n"
                        + "Activity: 5 active members · 4 pod check-ins\n"
                        + "New members: Ada, Grace\n"
                        + "Top contributors: Grace (9), Ada (3)\n"
                        + "Pipeline: 6 open offers · 2 bookings (last 7d) "
                        + "· 1 pending intro request\n");

        // Empty lists and zero counts read as "none yet" / plural zeros.
        var empty = new Summarizer.Facts(
                "Bare", monday(), 0, 0, 0, List.of(), List.of(), 0, 0, 0);
        assertThat(new TemplateSummarizer().summarize(empty)).isEqualTo(
                "Weekly digest — Bare\n"
                        + "Week of " + monday() + "\n"
                        + "Activity: 0 active members · 0 pod check-ins\n"
                        + "New members: none yet\n"
                        + "Top contributors: none yet\n"
                        + "Pipeline: 0 open offers · 0 bookings (last 7d) "
                        + "· 0 pending intro requests\n");

        // Singular forms: 1 of each.
        var single = new Summarizer.Facts(
                "Solo", monday(), 1, 1, 1, List.of("Ada"),
                List.of(new Summarizer.Contributor("Ada", 1)), 1, 1, 1);
        assertThat(new TemplateSummarizer().summarize(single))
                .contains("Activity: 1 active member · 1 pod check-in")
                .contains("Pipeline: 1 open offer · 1 booking (last 7d) "
                        + "· 1 pending intro request");
    }

    // ---------------------------------------------------------------- helpers

    private static LocalDate monday() {
        return LocalDate.now().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }
}
