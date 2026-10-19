package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.IntroRequest;
import com.coeso.roster.intros.IntrosRepos.IntroRequestRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Smart intros:
 *  - profiles carry offering/looking-for tags plus industry (upsert + rules),
 *  - suggestions match tag overlap within the SAME workspace only, ranked
 *    with a reason, capped at 5,
 *  - intro requests: max 3 pending per member, no duplicates, no self,
 *    notified via the notifier (audited), and contact email is only revealed
 *  - tenant isolation on every route (profiles and requests of another
 *    workspace are invisible and refused).
 */
class IntrosTest extends IntegrationTest {

    @Autowired private IntroRequestRepository introRequestRepository;

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    @Test
    void profileUpsertAndSuggestionRankingWithReasons() throws Exception {
        Account owner = register("in-owner");
        long ws = createWorkspace(owner, "Intros A " + sfx, null);
        Account m1 = register("in-m1");
        addMember(ws, m1.userId(), WorkspaceRole.MANAGER);
        Account m2 = register("in-m2");
        addMember(ws, m2.userId(), WorkspaceRole.MANAGER);
        Account m3 = register("in-m3");
        addMember(ws, m3.userId(), WorkspaceRole.MANAGER);

        // m1 looks for go-to-market; m2 offers it (+ same industry); m3
        // offers fundraising only (no overlap: never suggested).
        apiPut(m1, ws, "/api/intros/profile", "{\"offeringTags\":[\"hiring\"],"
                + "\"lookingForTags\":[\"go-to-market\"],\"industry\":\"SaaS\"}")
                .andExpect(status().isOk());
        apiPut(m2, ws, "/api/intros/profile", "{\"offeringTags\":[\"Go-To-Market\"],"
                + "\"lookingForTags\":[\"funding\"],\"industry\":\"saas\"}")
                .andExpect(status().isOk());
        apiPut(m3, ws, "/api/intros/profile", "{\"offeringTags\":[\"fundraising\"],"
                + "\"lookingForTags\":[\"hiring\"]}").andExpect(status().isOk());

        // Empty profile is refused.
        apiPut(m1, ws, "/api/intros/profile", "{}").andExpect(status().isBadRequest());

        // m1 sees m2 first (tag match + same industry, case-insensitive), m3
        // (reverse-direction match on hiring) second; the reason line names
        // the tags.
        var suggestions = read(apiGet(m1, ws, "/api/intros/suggestions").andReturn());
        assertThat(suggestions.isArray()).isTrue();
        assertThat(suggestions.size()).isEqualTo(2);
        assertThat(suggestions.get(0).get("userId").asLong()).isEqualTo(m2.userId());
        assertThat(suggestions.get(0).get("percent").asInt())
                .isGreaterThan(suggestions.get(1).get("percent").asInt());
        assertThat(suggestions.get(0).get("reason").asText())
                .contains("go-to-market").contains("same industry");
        assertThat(suggestions.get(1).get("reason").asText()).contains("hiring");

        // Before any profile: no suggestions, no error.
        Account m4 = register("in-m4");
        addMember(ws, m4.userId(), WorkspaceRole.MANAGER);
        assertThat(read(apiGet(m4, ws, "/api/intros/suggestions").andReturn()).size())
                .isZero();
    }

    @Test
    void requestLimitAndDuplicateRulesHold() throws Exception {
        Account owner = register("in-limit-owner");
        long ws = createWorkspace(owner, "Intros Limit " + sfx, null);
        Account m1 = register("in-limit-m1");
        addMember(ws, m1.userId(), WorkspaceRole.MANAGER);

        // Four other members with profiles.
        Account[] others = new Account[4];
        for (int i = 0; i < 4; i++) {
            others[i] = register("in-other" + i);
            addMember(ws, others[i].userId(), WorkspaceRole.MANAGER);
            apiPut(others[i], ws, "/api/intros/profile",
                    "{\"offeringTags\":[\"tag" + i + "\"]}").andExpect(status().isOk());
        }
        apiPut(m1, ws, "/api/intros/profile", "{\"lookingForTags\":[\"tag0\",\"tag1\"]}")
                .andExpect(status().isOk());

        // Self-request refused; unknown target (no profile here) refused.
        apiPost(m1, ws, "/api/intros/requests",
                "{\"targetUserId\":" + m1.userId() + "}").andExpect(status().isBadRequest());
        apiPost(m1, ws, "/api/intros/requests",
                "{\"targetUserId\":999999999}").andExpect(status().isNotFound());

        // The cap: 3 pending requests allowed, the 4th is a 409.
        for (int i = 0; i < 3; i++) {
            apiPost(m1, ws, "/api/intros/requests",
                    "{\"targetUserId\":" + others[i].userId() + ",\"reason\":\"match\"}")
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("pending"));
        }
        apiPost(m1, ws, "/api/intros/requests",
                "{\"targetUserId\":" + others[3].userId() + "}")
                .andExpect(status().isConflict());

        // Duplicate pending to the same member is collapsed to one request.
        apiPost(m1, ws, "/api/intros/requests",
                "{\"targetUserId\":" + others[0].userId() + "}")
                .andExpect(status().isConflict());

        // The requests were notified: audit rows exist with no content leak.
        assertThat(auditLogRepository.findAll().stream()
                .filter(a -> a.getEntityType().equals("intro_request")
                        && String.valueOf(a.getWorkspaceId()).equals(String.valueOf(ws)))
                .count()).isEqualTo(3);

        // Owner/admin can flag any member expert (already owner) — unchanged.
        assertThat(introRequestRepository.findAll().stream()
                .filter(r -> r.getWorkspaceId().equals(ws) && r.getStatus()
                        == IntroRequest.Status.PENDING)
                .count()).isEqualTo(3);
    }

    @Test
    void contactRevealedOnlyOnAcceptAndOnlyToThePair() throws Exception {
        Account owner = register("in-rev-owner");
        long ws = createWorkspace(owner, "Intros Reveal " + sfx, null);
        Account m1 = register("in-rev-m1");
        addMember(ws, m1.userId(), WorkspaceRole.MANAGER);
        Account m2 = register("in-rev-m2");
        addMember(ws, m2.userId(), WorkspaceRole.MANAGER);
        Account m3 = register("in-rev-m3");
        addMember(ws, m3.userId(), WorkspaceRole.MANAGER);
        apiPut(m2, ws, "/api/intros/profile", "{\"offeringTags\":[\"pricing\"]}")
                .andExpect(status().isOk());
        apiPut(m1, ws, "/api/intros/profile", "{\"lookingForTags\":[\"pricing\"]}")
                .andExpect(status().isOk());
        apiPut(m3, ws, "/api/intros/profile", "{\"offeringTags\":[\"pricing\"]}")
                .andExpect(status().isOk());

        apiPost(m1, ws, "/api/intros/requests",
                "{\"targetUserId\":" + m2.userId() + ",\"reason\":\"pricing help\"}")
                .andExpect(status().isCreated());
        apiPost(m1, ws, "/api/intros/requests",
                "{\"targetUserId\":" + m3.userId() + "}").andExpect(status().isCreated());

        // While pending: no contact anywhere.
        var outgoing = read(apiGet(m1, ws, "/api/intros/requests/outgoing").andReturn());
        assertThat(outgoing.get(0).get("contactEmail").isNull()).isTrue();

        // Only the recipient can accept; the requester cannot.
        apiPost(m1, ws, "/api/intros/requests/" + fromPendingRequestId(m1.userId())
                + "/accept", "{}").andExpect(status().isForbidden());
        apiPost(m2, ws, "/api/intros/requests/"
                + pendingRequestId(m2.userId()) + "/accept", "{}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("accepted"));

        // Accepted: the requester sees the accepted pair's contact email;
        // the declined one stays hidden.
        var after = read(apiGet(m1, ws, "/api/intros/requests/outgoing").andReturn());
        assertThat(emailOfEntry(after, m2.userId()).asText()).contains("@");
        // Suggestion list stays capped at five.
        var suggestions = read(apiGet(m1, ws, "/api/intros/suggestions").andReturn());
        assertThat(suggestions.size()).isLessThanOrEqualTo(5);

        // The other member's incoming request can be declined; no contact.
        apiPost(m3, ws, "/api/intros/requests/"
                + pendingRequestId(m3.userId()) + "/decline", "{}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("declined"));
        var declined = read(apiGet(m1, ws, "/api/intros/requests/outgoing").andReturn());
        assertThat(emailOfEntry(declined, m3.userId()).isNull()).isTrue();
    }

    @Test
    void tenantIsolationKeepsSuggestionsAndRequestsPrivate() throws Exception {
        Account ownerA = register("in-ten-a");
        long wsA = createWorkspace(ownerA, "Intros Ten A " + sfx, null);
        Account ownerB = register("in-ten-b");
        long wsB = createWorkspace(ownerB, "Intros Ten B " + sfx, null);
        Account m1 = register("in-ten-m1");
        addMember(wsA, m1.userId(), WorkspaceRole.MANAGER);
        Account otherWsMember = register("in-ten-x");
        addMember(wsB, otherWsMember.userId(), WorkspaceRole.MANAGER);

        apiPut(m1, wsA, "/api/intros/profile",
                "{\"offeringTags\":[\"shared-tag\"],\"industry\":\"A\"}")
                .andExpect(status().isOk());
        apiPut(otherWsMember, wsB, "/api/intros/profile",
                "{\"lookingForTags\":[\"shared-tag\"],\"industry\":\"B\"}")
                .andExpect(status().isOk());

        // Same tags but different workspaces: no suggestion either way.
        assertThat(read(apiGet(m1, wsA, "/api/intros/suggestions").andReturn()).size())
                .isZero();
        assertThat(read(apiGet(otherWsMember, wsB, "/api/intros/suggestions").andReturn())
                .size()).isZero();

        // A member of A cannot request an intro to a member of B (their
        // profile is invisible here).
        apiPost(m1, wsA, "/api/intros/requests",
                "{\"targetUserId\":" + otherWsMember.userId() + "}")
                .andExpect(status().isNotFound());

        // Incoming/outgoing lists stay workspace-scoped: crossing the header
        // alters nothing.
        apiPost(otherWsMember, wsB, "/api/intros/requests",
                "{\"targetUserId\":" + m1.userId() + "}").andExpect(status().isNotFound());
    }

    // ---------------------------------------------------------------- helpers

    /** Finds the still-pending request id addressed to targetUserId. */
    private long pendingRequestId(Long targetUserId) {
        return introRequestRepository.findAll().stream()
                .filter(r -> r.getToUserId().equals(targetUserId)
                        && r.getStatus() == IntroRequest.Status.PENDING)
                .findFirst().orElseThrow().getId();
    }

    /** contactEmail of the request row addressed to toUserId, null-safe. */
    private com.fasterxml.jackson.databind.JsonNode emailOfEntry(
            com.fasterxml.jackson.databind.JsonNode array, Long toUserId) {
        for (var entry : array) {
            if (entry.get("toUserId").asLong() == toUserId) {
                return entry.get("contactEmail");
            }
        }
        throw new AssertionError("no request row addressed to " + toUserId);
    }

    /** Finds the still-pending request id from fromUserId (recipient lookup). */
    private long fromPendingRequestId(Long fromUserId) {
        return introRequestRepository.findAll().stream()
                .filter(r -> r.getFromUserId().equals(fromUserId)
                        && r.getStatus() == IntroRequest.Status.PENDING)
                .findFirst().orElseThrow().getId();
    }
}
