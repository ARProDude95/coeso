package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.discord.DiscordNotifier;
import com.coeso.roster.entity.EngagementSnapshot;
import com.coeso.roster.health.EngagementJob;
import com.coeso.roster.health.EngagementService;
import com.coeso.roster.health.HealthRepos;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Engagement snapshots + churn dashboard (feature 5, PROGRESS "Next steps"
 * #1):
 *  - refresh computes the weighted 30-day window from real activity (audit *
 *    1 + check-ins * 4 + messages * 2 + intros * 3 + bookings * 3) and is
 *    idempotent per (workspace, member, day) — the nightly job path included,
 *  - the owner dashboard flags a sharp drop against the previous snapshot
 *    (DROP) and 14+ days of silence (INACTIVE), nothing for healthy members,
 *  - the templated nudge goes through the DiscordNotifier seam and writes an
 *    audit row,
 *  - reads are owner-only, other workspaces cannot nudge foreign members, and
 *    the schedule itself is disabled in tests (job bean absent).
 */
class EngagementTest extends IntegrationTest {

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    @Autowired private EngagementService engagementService;
    @Autowired private HealthRepos.EngagementSnapshotRepository snapshots;
    @Autowired private ApplicationContext applicationContext;
    @MockitoBean private DiscordNotifier discordNotifier;

    @Test
    void refreshComputesWeightedSnapshotsAndStaysIdempotent() throws Exception {
        Account owner = register("en-refresh");
        long ws = createWorkspace(owner, "Engagement Refresh " + sfx, null);
        Account member = register("en-refresh-m");
        addMember(ws, member.userId(), WorkspaceRole.MANAGER);

        // Real activity: profile saves (audit rows), a pod with a check-in
        // and a thread message, and an intro request — four of the five
        // sources. The target needs an intros profile for the request to land.
        apiPut(member, ws, "/api/intros/profile",
                "{\"industry\":\"SaaS\",\"offeringTags\":[\"g\"]}")
                .andExpect(status().isOk());
        apiPut(owner, ws, "/api/intros/profile",
                "{\"industry\":\"Ops\",\"offeringTags\":[\"lead\"]}")
                .andExpect(status().isOk());
        var pods = read(apiPost(owner, ws, "/api/pods/publish",
                "{\"drafts\":[{\"industry\":\"Ops\",\"userIds\":["
                        + owner.userId() + "," + member.userId() + "]}]}").andReturn());
        long podId = pods.get(0).get("id").asLong();
        apiPost(member, ws, "/api/pods/" + podId + "/checkins",
                "{\"wins\":\"w\",\"blockers\":\"b\"}").andExpect(status().isOk());
        apiPost(member, ws, "/api/pods/" + podId + "/messages",
                "{\"body\":\"hello\"}").andExpect(status().isOk());
        apiPost(member, ws, "/api/intros/requests",
                "{\"targetUserId\":" + owner.userId() + "}")
                .andExpect(status().isCreated());

        var rows = read(apiPost(owner, ws, "/api/engagement/refresh", null).andReturn());
        JsonNode memberRow = rowFor(rows, member.userId());
        assertThat(memberRow.get("podCheckins").asInt()).isEqualTo(1);
        assertThat(memberRow.get("podMessages").asInt()).isEqualTo(1);
        assertThat(memberRow.get("introActivity").asInt()).isEqualTo(1);
        assertThat(memberRow.get("auditActions").asInt()).isGreaterThanOrEqualTo(1);
        assertThat(memberRow.get("bookings").asInt()).isZero();
        assertThat(memberRow.get("score").asInt()).isEqualTo(
                memberRow.get("auditActions").asInt() * 1
                        + memberRow.get("podCheckins").asInt() * 4
                        + memberRow.get("podMessages").asInt() * 2
                        + memberRow.get("introActivity").asInt() * 3
                        + memberRow.get("bookings").asInt() * 3);
        assertThat(memberRow.get("daysInactive").asInt()).isZero();
        assertThat(memberRow.get("snapshotDate").asText()).isEqualTo(LocalDate.now().toString());

        // Idempotent: a second refresh and the system-wide job path both keep
        // exactly one row per member for today.
        int before = snapshots.findByWorkspaceIdAndSnapshotDate(ws, LocalDate.now()).size();
        read(apiPost(owner, ws, "/api/engagement/refresh", null).andReturn());
        assertThat(engagementService.snapshotAllActiveWorkspaces()).isGreaterThanOrEqualTo(1);
        assertThat(snapshots.findByWorkspaceIdAndSnapshotDate(ws, LocalDate.now()))
                .hasSize(before);
    }

    @Test
    void dashboardFlagsDropsAndInactivityAndNudgesThroughTheSeam() throws Exception {
        Account owner = register("en-risk");
        long ws = createWorkspace(owner, "Engagement Risk " + sfx, null);
        Account member = register("en-risk-m");
        addMember(ws, member.userId(), WorkspaceRole.MANAGER);
        Account dormant = register("en-risk-d");
        addMember(ws, dormant.userId(), WorkspaceRole.MANAGER);

        // The dormant member's today row already says 20 quiet days — refresh
        // keeps existing rows (append-only per day), so the seed survives.
        snapshots.saveAndFlush(snapshot(ws, dormant.userId(), LocalDate.now(), 0, 20));

        // Member does a little activity, so today's snapshot is small but
        // non-zero; refresh fills today for everyone.
        apiPut(member, ws, "/api/intros/profile",
                "{\"industry\":\"SaaS\",\"offeringTags\":[\"g\"]}")
                .andExpect(status().isOk());
        read(apiPost(owner, ws, "/api/engagement/refresh", null).andReturn());

        // Yesterday the member scored 30 — today's score is at most 15, a
        // sharp DROP against a baseline above the noise floor.
        snapshots.saveAndFlush(snapshot(ws, member.userId(),
                LocalDate.now().minusDays(1), 30, 0));

        var dash = read(apiGet(owner, ws, "/api/engagement/dashboard").andReturn());
        assertThat(dash.get("snapshotDate").asText()).isEqualTo(LocalDate.now().toString());
        assertThat(dash.get("membersConsidered").asInt()).isEqualTo(3);
        assertThat(dash.get("atRisk").size()).isEqualTo(2);

        JsonNode drop = riskFor(dash, member.userId());
        assertThat(drop.get("previousScore").asInt()).isEqualTo(30);
        assertThat(drop.get("score").asInt()).isLessThanOrEqualTo(15);
        assertThat(drop.get("daysInactive").asInt()).isZero();
        assertThat(drop.get("reasons").toString()).contains("DROP").doesNotContain("INACTIVE");

        JsonNode inactive = riskFor(dash, dormant.userId());
        assertThat(inactive.get("daysInactive").asInt()).isEqualTo(20);
        assertThat(inactive.get("previousScore").isNull()).isTrue();
        assertThat(inactive.get("reasons").toString()).contains("INACTIVE");

        // The owner nudges: templated reason from the member's own snapshot,
        // delivered through the seam, and written to the audit trail.
        apiPost(owner, ws, "/api/engagement/members/" + member.userId() + "/nudge", null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Test User"))
                .andExpect(jsonPath("$.reason", containsString("dropped from")));
        verify(discordNotifier).engagementNudge(eq(ws), eq("Test User"),
                contains("dropped from 30"));

        apiPost(owner, ws, "/api/engagement/members/" + dormant.userId() + "/nudge", null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reason", containsString("20 days")));
        verify(discordNotifier).engagementNudge(eq(ws), eq("Test User"),
                contains("no tracked activity for 20 days"));

        assertThat(auditLogRepository.findByWorkspaceIdAndCreatedAtAfter(
                ws, LocalDateTime.now().minusMinutes(5)))
                .anySatisfy(row -> assertThat(row.getEntityType())
                        .isEqualTo("engagement_nudge"));
    }

    @Test
    void readsAreOwnerGatedAndTenantScopedAndTheJobIsOff() throws Exception {
        Account owner = register("en-role");
        long ws = createWorkspace(owner, "Engagement Role " + sfx, null);
        Account manager = register("en-role-m");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);

        // Owner-only: a manager gets 403 on every engagement endpoint.
        apiGet(manager, ws, "/api/engagement/dashboard").andExpect(status().isForbidden());
        apiPost(manager, ws, "/api/engagement/refresh", null)
                .andExpect(status().isForbidden());
        apiPost(manager, ws, "/api/engagement/members/" + owner.userId() + "/nudge", null)
                .andExpect(status().isForbidden());

        // Before the first snapshot the dashboard is an empty state, not an error.
        apiGet(owner, ws, "/api/engagement/dashboard").andExpect(status().isOk())
                .andExpect(jsonPath("$.atRisk").isEmpty());

        // Another workspace cannot nudge a foreign member.
        Account other = register("en-role-b");
        long wsB = createWorkspace(other, "Engagement Role B " + sfx, null);
        apiPost(other, wsB, "/api/engagement/members/" + owner.userId() + "/nudge", null)
                .andExpect(status().isNotFound());

        // The nightly schedule itself is off in tests: EngagementTest drives
        // the service directly, exactly like DigestTest and its job.
        assertThat(applicationContext.getBeanNamesForType(EngagementJob.class)).isEmpty();
    }

    // ---------------------------------------------------------------- helpers

    private EngagementSnapshot snapshot(Long ws, Long userId, LocalDate date,
                                        int score, int daysInactive) {
        EngagementSnapshot row = new EngagementSnapshot();
        row.setWorkspaceId(ws);
        row.setUserId(userId);
        row.setSnapshotDate(date);
        row.setScore(score);
        row.setDaysInactive(daysInactive);
        return row;
    }

    private static JsonNode rowFor(JsonNode rows, Long userId) {
        for (JsonNode row : rows) {
            if (row.get("userId").asLong() == userId) {
                return row;
            }
        }
        throw new AssertionError("no snapshot for user " + userId);
    }

    private static JsonNode riskFor(JsonNode dashboard, Long userId) {
        for (JsonNode row : dashboard.get("atRisk")) {
            if (row.get("userId").asLong() == userId) {
                return row;
            }
        }
        throw new AssertionError("user " + userId + " not flagged at risk");
    }
}
