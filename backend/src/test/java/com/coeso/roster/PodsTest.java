package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Mastermind pods:
 *  - deterministic industry-adjacent preview, published as-is or with manual
 *    overrides (previous generation archived),
 *  - weekly check-ins: members only, one per ISO week (normalized), wins /
 *    blockers required, streaks count consecutive Mondays,
 *  - role gates: generation/publish are admin+; members read only their pods,
 *  - tenant isolation: pods of another workspace are invisible and refused.
 */
class PodsTest extends IntegrationTest {

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    @Test
    void previewGroupsByIndustryAndPublishesThePreview() throws Exception {
        Account owner = register("pd-owner");
        long ws = createWorkspace(owner, "Pods Preview " + sfx, null);
        // The owner is an active member too, so they get an industry as well
        // (otherwise they land in the "general" bucket and mix the labels).
        apiPut(owner, ws, "/api/intros/profile",
                "{\"industry\":\"SaaS\",\"offeringTags\":[\"o\"]}")
                .andExpect(status().isOk());

        // 6 Fintech + 6 SaaS members (industry via the intros profile).
        Account[] fintech = new Account[6];
        Account[] saas = new Account[5];
        for (int i = 0; i < fintech.length; i++) {
            fintech[i] = register("pd-fin" + i);
            addMember(ws, fintech[i].userId(), WorkspaceRole.MANAGER);
            apiPut(fintech[i], ws, "/api/intros/profile",
                    "{\"industry\":\"Fintech\",\"offeringTags\":[\"t" + i + "\"]}")
                    .andExpect(status().isOk());
        }
        for (int i = 0; i < saas.length; i++) {
            saas[i] = register("pd-saas" + i);
            addMember(ws, saas[i].userId(), WorkspaceRole.MANAGER);
            apiPut(saas[i], ws, "/api/intros/profile",
                    "{\"industry\":\"SaaS\",\"offeringTags\":[\"s" + i + "\"]}")
                    .andExpect(status().isOk());
        }

        // A manager cannot generate or publish.
        apiPost(fintech[0], ws, "/api/pods/generate", null)
                .andExpect(status().isForbidden());

        // Preview: deterministic, industry-adjacent, partitions everyone once.
        var preview = read(apiPost(owner, ws, "/api/pods/generate", null).andReturn());
        assertThat(preview.isArray()).isTrue();
        assertThat(preview.size()).isEqualTo(2);
        assertThat(preview.get(0).get("industry").asText()).isEqualTo("Fintech");
        assertThat(preview.get(1).get("industry").asText()).isEqualTo("SaaS");
        assertThat(preview.get(0).get("userIds").size()).isEqualTo(6);
        assertThat(preview.get(1).get("userIds").size()).isEqualTo(6);

        // Publishing with no overrides writes exactly the preview.
        var published = read(apiPost(owner, ws, "/api/pods/publish",
                "{\"namePrefix\":\"Cohort\"}").andReturn());
        assertThat(published.size()).isEqualTo(2);
        assertThat(published.get(0).get("name").asText()).isEqualTo("Cohort 1");
        assertThat(published.get(0).get("members").size()).isEqualTo(6);
        assertThat(published.get(1).get("members").size()).isEqualTo(6);

        // Admin sees both pods; a member sees only the one they belong to.
        apiGet(owner, ws, "/api/pods").andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
        apiGet(saas[0], ws, "/api/pods").andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("Cohort 2"));
    }

    @Test
    void manualOverridesAreHonoredAndRepublishArchivesOldGeneration() throws Exception {
        Account owner = register("pd-ovr");
        long ws = createWorkspace(owner, "Pods Override " + sfx, null);
        Account[] members = new Account[4];
        for (int i = 0; i < members.length; i++) {
            members[i] = register("pd-m" + i);
            addMember(ws, members[i].userId(), WorkspaceRole.MANAGER);
        }

        // First generation: one pod of 4 (tiny pool).
        var first = read(apiPost(owner, ws, "/api/pods/publish", "{}").andReturn());
        assertThat(first.size()).isEqualTo(1);
        long oldPodId = first.get(0).get("id").asLong();

        // Manual override: split into two pods; republish archives the old.
        String override = "{\"drafts\":["
                + "{\"industry\":\"A\",\"userIds\":[" + members[0].userId() + ","
                + members[1].userId() + "]},"
                + "{\"industry\":\"B\",\"userIds\":[" + members[2].userId() + ","
                + members[3].userId() + "]}]}";
        var second = read(apiPost(owner, ws, "/api/pods/publish", override).andReturn());
        assertThat(second.size()).isEqualTo(2);
        var visible = read(apiGet(owner, ws, "/api/pods").andReturn());
        assertThat(visible.size()).isEqualTo(2);
        assertThat(visible.toString()).doesNotContain(String.valueOf(oldPodId));

        // Invalid overrides are refused: one-member pod, duplicate member,
        // member of another workspace.
        apiPost(owner, ws, "/api/pods/publish", "{\"drafts\":[{\"userIds\":["
                + members[0].userId() + "]}]}").andExpect(status().isBadRequest());
        apiPost(owner, ws, "/api/pods/publish", "{\"drafts\":["
                + "{\"userIds\":[" + members[0].userId() + "," + members[1].userId()
                + "]},{\"userIds\":[" + members[1].userId() + "," + members[2].userId()
                + "]}]}").andExpect(status().isConflict());
        apiPost(owner, ws, "/api/pods/publish", "{\"drafts\":[{\"userIds\":["
                + members[0].userId() + ",999999999]}]}")
                .andExpect(status().isNotFound());
    }

    @Test
    void checkinsEnforceMembershipAndOnePerWeekWithStreaks() throws Exception {
        Account owner = register("pd-chk");
        long ws = createWorkspace(owner, "Pods Checkins " + sfx, null);
        Account m1 = register("pd-chk-m1");
        addMember(ws, m1.userId(), WorkspaceRole.MANAGER);
        Account m2 = register("pd-chk-m2");
        addMember(ws, m2.userId(), WorkspaceRole.MANAGER);
        Account outsider = register("pd-chk-out");
        addMember(ws, outsider.userId(), WorkspaceRole.MANAGER);

        // One pod with owner + m1 + m2; outsider stays out.
        String publish = "{\"drafts\":[{\"industry\":\"Ops\",\"userIds\":["
                + owner.userId() + "," + m1.userId() + "," + m2.userId() + "]}]}";
        var pods = read(apiPost(owner, ws, "/api/pods/publish", publish).andReturn());
        long podId = pods.get(0).get("id").asLong();

        // Outsider: cannot read the pod or check in.
        apiGet(outsider, ws, "/api/pods").andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        apiGet(outsider, ws, "/api/pods/" + podId).andExpect(status().isForbidden());
        apiPost(outsider, ws, "/api/pods/" + podId + "/checkins",
                "{\"wins\":\"w\",\"blockers\":\"b\"}").andExpect(status().isForbidden());

        LocalDate thisMonday = LocalDate.now()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate w1 = thisMonday.minusWeeks(2);
        LocalDate w2 = thisMonday.minusWeeks(1);
        LocalDate w3 = thisMonday;

        // Validation: wins and blockers are required.
        apiPost(m1, ws, "/api/pods/" + podId + "/checkins",
                "{\"blockers\":\"b\"}").andExpect(status().isBadRequest());
        apiPost(m1, ws, "/api/pods/" + podId + "/checkins",
                "{\"wins\":\"w\"}").andExpect(status().isBadRequest());

        // Three consecutive Mondays for m1; the same week twice is a 409
        // even when the client sends a mid-week date (normalized to Monday).
        apiPost(m1, ws, "/api/pods/" + podId + "/checkins", checkinBody(w1, "w1", "b1"))
                .andExpect(status().isOk());
        apiPost(m1, ws, "/api/pods/" + podId + "/checkins",
                checkinBody(w1.plusDays(2), "again", "again"))
                .andExpect(status().isConflict());
        apiPost(m1, ws, "/api/pods/" + podId + "/checkins", checkinBody(w2, "w2", "b2"))
                .andExpect(status().isOk());
        apiPost(m1, ws, "/api/pods/" + podId + "/checkins",
                checkinBody(w3, "w3", "b3", "ask")).andExpect(status().isOk());

        // m2 checks in only for the current week.
        apiPost(m2, ws, "/api/pods/" + podId + "/checkins", checkinBody(w3, "m2w", "m2b"))
                .andExpect(status().isOk());

        // Streaks: m1 = 3 consecutive weeks, m2 = 1.
        var detail = read(apiGet(owner, ws, "/api/pods/" + podId).andReturn());
        assertThat(streakOf(detail, m1.userId())).isEqualTo(3);
        assertThat(streakOf(detail, m2.userId())).isEqualTo(1);

        // The check-in feed: four rows (m1 x3, m2 x1), newest week first,
        // latest filing first within a week.
        var feed = read(apiGet(owner, ws, "/api/pods/" + podId + "/checkins").andReturn());
        assertThat(feed.size()).isEqualTo(4);
        assertThat(feed.get(0).get("weekStart").asText()).isEqualTo(w3.toString());
        assertThat(feed.get(1).get("wins").asText()).isEqualTo("w3");
        assertThat(feed.get(3).get("weekStart").asText()).isEqualTo(w1.toString());
        assertThat(feed.get(3).get("wins").asText()).isEqualTo("w1");
    }

    @Test
    void podsAreTenantScoped() throws Exception {
        Account ownerA = register("pd-ten-a");
        long wsA = createWorkspace(ownerA, "Pods Ten A " + sfx, null);
        Account ownerB = register("pd-ten-b");
        long wsB = createWorkspace(ownerB, "Pods Ten B " + sfx, null);
        Account memberA = register("pd-ten-m");
        addMember(wsA, memberA.userId(), WorkspaceRole.MANAGER);

        var pods = read(apiPost(ownerA, wsA, "/api/pods/publish", "{}").andReturn());
        long podA = pods.get(0).get("id").asLong();

        // Workspace B: nothing of A's pod is reachable, even by an owner.
        apiGet(ownerB, wsB, "/api/pods").andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        apiGet(ownerB, wsB, "/api/pods/" + podA).andExpect(status().isNotFound());
        apiPost(ownerB, wsB, "/api/pods/" + podA + "/checkins",
                "{\"wins\":\"w\",\"blockers\":\"b\"}").andExpect(status().isNotFound());
        apiGet(ownerB, wsB, "/api/pods/" + podA + "/checkins")
                .andExpect(status().isNotFound());

        // A's own member still sees exactly their pod.
        apiGet(memberA, wsA, "/api/pods/" + podA).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value((int) podA));
    }

    // ---------------------------------------------------------------- helpers

    private String checkinBody(LocalDate weekStart, String wins, String blockers) {
        return checkinBody(weekStart, wins, blockers, null);
    }

    private String checkinBody(LocalDate weekStart, String wins, String blockers,
                               String ask) {
        return "{\"weekStart\":\"" + weekStart + "\",\"wins\":\"" + wins
                + "\",\"blockers\":\"" + blockers + "\""
                + (ask == null ? "" : ",\"ask\":\"" + ask + "\"") + "}";
    }

    private int streakOf(com.fasterxml.jackson.databind.JsonNode podDetail, Long userId) {
        for (var member : podDetail.get("members")) {
            if (member.get("userId").asLong() == userId) {
                return member.get("streak").asInt();
            }
        }
        throw new AssertionError("member " + userId + " not in pod detail");
    }
}
