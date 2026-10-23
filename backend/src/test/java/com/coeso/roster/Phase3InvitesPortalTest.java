package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.Invite;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.repo.Repositories.InviteRepository;
import java.time.LocalDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

/**
 * Phase 3:
 *  - invite links are single-use, expire, can be revoked, and only their
 *    SHA-256 hash is stored,
 *  - a rep-role user sees only their own linked rep profile, never others,
 *  - approving a placement request obeys every placement rule (offer open,
 *    free seat, one active placement per rep) through the same transactional
 *    path as a direct placement.
 */
class Phase3InvitesPortalTest extends IntegrationTest {

    @Autowired private InviteRepository inviteRepository;

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    // ------------------------------------------------------------------ invites

    @Test
    void inviteStoresOnlyHashAndGrantIsSingleUse() throws Exception {
        Account owner = register("inv-owner");
        long ws = createWorkspace(owner, "Invite WS " + sfx, null);

        var created = apiPost(owner, ws, "/api/invites",
                        "{\"email\":\"invitee-" + sfx + "@example.test\",\"role\":\"MANAGER\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andReturn();
        String token = read(created).get("token").asText();
        String link = read(created).get("link").asText();
        assertThat(link).contains(token);

        // Only the hash is stored — the raw token must not appear in the row.
        Invite row = inviteRepository.findAll().stream()
                .filter(i -> i.getWorkspaceId() == ws)
                .findFirst().orElseThrow();
        assertThat(row.getTokenHash()).hasSize(64).doesNotContain(token);

        // The invitee registers with the invited email and accepts.
        Account invitee = registerWith("invitee-" + sfx + "@example.test");
        apiPost(invitee, null, "/api/invites/accept?token=" + token, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.workspaceId").value(ws))
                .andExpect(jsonPath("$.role").value("MANAGER"));

        // Accepting again with the same token is rejected.
        apiPost(invitee, null, "/api/invites/accept?token=" + token, null)
                .andExpect(status().isConflict());

        // The membership exists exactly once, with the invited role.
        var membership = membershipRepository.findByUserIdAndWorkspaceId(invitee.userId(), ws);
        assertThat(membership).isPresent();
        assertThat(membership.get().getRole()).isEqualTo(WorkspaceRole.MANAGER);
    }

    @Test
    void invalidInviteRoleIsAClientErrorNotAServerError() throws Exception {
        Account owner = register("inv-role");
        long ws = createWorkspace(owner, "Invite Role " + sfx, null);

        // Regression: an unknown role string used to escape WorkspaceRole.parse
        // as IllegalArgumentException and surface as a 500.
        apiPost(owner, ws, "/api/invites",
                        "{\"email\":\"bad-role-" + sfx
                                + "@example.test\",\"role\":\"banana\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"))
                .andExpect(jsonPath("$.message").value(
                        "Unknown role 'banana' — expected one of owner, admin, manager, rep"));

        // Blank and null-ish role strings are client errors, not NPEs.
        apiPost(owner, ws, "/api/invites",
                        "{\"email\":\"blank-role-" + sfx
                                + "@example.test\",\"role\":\"   \"}")
                .andExpect(status().isBadRequest());

        // Normalization is unchanged: trim + case-insensitive still invite.
        apiPost(owner, ws, "/api/invites",
                        "{\"email\":\"ok-role-" + sfx
                                + "@example.test\",\"role\":\" admin \"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("ADMIN"));
    }

    @Test
    void expiredInviteCannotBeAccepted() throws Exception {
        Account owner = register("inv-exp-owner");
        long ws = createWorkspace(owner, "Invite Exp " + sfx, null);

        var created = apiPost(owner, ws, "/api/invites",
                        "{\"email\":\"expiring-" + sfx + "@example.test\",\"role\":\"REP\"}")
                .andExpect(status().isCreated())
                .andReturn();
        String token = read(created).get("token").asText();
        Long inviteId = read(created).get("id").asLong();

        // Expire the row directly (no clock control needed).
        Invite row = inviteRepository.findById(inviteId).orElseThrow();
        row.setExpiresAt(LocalDateTime.now().minusMinutes(1));
        inviteRepository.save(row);

        Account invitee = registerWith("expiring-" + sfx + "@example.test");
        apiPost(invitee, null, "/api/invites/accept?token=" + token, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("This invite is expired"));

        assertThat(membershipRepository.findByUserIdAndWorkspaceId(invitee.userId(), ws))
                .isEmpty();
    }

    @Test
    void revokedInviteCannotBeAcceptedAndWrongAccountCannotAccept() throws Exception {
        Account owner = register("inv-rev-owner");
        long ws = createWorkspace(owner, "Invite Rev " + sfx, null);

        var created = apiPost(owner, ws, "/api/invites",
                        "{\"email\":\"revoked-" + sfx + "@example.test\",\"role\":\"REP\"}")
                .andExpect(status().isCreated())
                .andReturn();
        String token = read(created).get("token").asText();
        Long inviteId = read(created).get("id").asLong();

        apiDelete(owner, ws, "/api/invites/" + inviteId).andExpect(status().isNoContent());

        Account invitee = registerWith("revoked-" + sfx + "@example.test");
        apiPost(invitee, null, "/api/invites/accept?token=" + token, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("This invite is revoked"));

        // A different, uninvited account cannot use another person's link.
        var other = apiPost(owner, ws, "/api/invites",
                        "{\"email\":\"someone-else-" + sfx + "@example.test\",\"role\":\"REP\"}")
                .andExpect(status().isCreated())
                .andReturn();
        String otherToken = read(other).get("token").asText();
        apiPost(invitee, null, "/api/invites/accept?token=" + otherToken, null)
                .andExpect(status().isBadRequest());
    }

    @Test
    void unknownTokenIsNotFoundAndOwnerRoleCannotBeInvited() throws Exception {
        Account owner = register("inv-owner2");
        long ws = createWorkspace(owner, "Invite Own " + sfx, null);

        apiPost(owner, ws, "/api/invites",
                        "{\"email\":\"x-" + sfx + "@example.test\",\"role\":\"OWNER\"}")
                .andExpect(status().isBadRequest());

        apiPost(owner, null, "/api/invites/accept?token=deadbeef", null)
                .andExpect(status().isNotFound());

        // Listing invites requires admin+; a rep-role member is forbidden.
        Account repUser = register("inv-rep");
        addMember(ws, repUser.userId(), WorkspaceRole.REP);
        apiGet(repUser, ws, "/api/invites").andExpect(status().isForbidden());
    }

    // -------------------------------------------------------------- rep portal

    @Test
    void repRoleUserSeesOnlyOwnProfileNeverOthers() throws Exception {
        Account owner = register("portal-owner");
        long ws = createWorkspace(owner, "Portal WS " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offer = repoOffer(ws, client, "Portal Offer", 3);

        // Two reps; one is linked to a rep-role member, the other is not.
        long linkedRep = repoRep(ws, "Linked Rep");
        long otherRep = repoRep(ws, "Other Rep");
        long otherOffer = repoOffer(ws, client, "Other Offer", 3);

        Account repUser = register("portal-rep");
        Membership membership = new Membership();
        membership.setWorkspaceId(ws);
        membership.setUserId(repUser.userId());
        membership.setRole(WorkspaceRole.REP);
        membership.setRepId(linkedRep);
        membershipRepository.save(membership);

        // Own profile only.
        apiGet(repUser, ws, "/api/me/rep")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(linkedRep))
                .andExpect(jsonPath("$.name").value("Linked Rep"));

        // The full roster is off-limits to a rep-role user.
        apiGet(repUser, ws, "/api/reps").andExpect(status().isForbidden());

        // Open offers are visible, but placing directly is not.
        apiGet(repUser, ws, "/api/me/open-offers")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.title == 'Portal Offer')]").exists());

        apiPost(repUser, ws, "/api/placements",
                        "{\"offerId\":" + offer + ",\"repId\":" + linkedRep + "}")
                .andExpect(status().isForbidden());

        // Requesting for someone else's rep profile is forbidden.
        apiPost(repUser, ws, "/api/placement-requests",
                        "{\"offerId\":" + offer + ",\"repId\":" + otherRep + "}")
                .andExpect(status().isForbidden());

        // Requesting for the own profile works.
        apiPost(repUser, ws, "/api/placement-requests",
                        "{\"offerId\":" + offer + ",\"repId\":" + linkedRep + "}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.repId").value(linkedRep))
                .andExpect(jsonPath("$.status").value("PENDING"));

        // A rep's request list shows only their own requests.
        long foreignRequest = createPendingRequest(ws, otherOffer, otherRep, owner.userId());
        apiGet(repUser, ws, "/api/placement-requests")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.repId == " + linkedRep + ")]").exists())
                .andExpect(jsonPath("$[?(@.id == " + foreignRequest + ")]").doesNotExist());
    }

    @Test
    void repWithoutLinkedProfileIsRejected() throws Exception {
        Account owner = register("portal-nolink");
        long ws = createWorkspace(owner, "Portal NoLink " + sfx, null);
        Account repUser = register("portal-nolink-user");
        addMember(ws, repUser.userId(), WorkspaceRole.REP);

        apiGet(repUser, ws, "/api/me/rep")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message")
                        .value("Your membership is not linked to a rep profile"));
        apiGet(repUser, ws, "/api/me/open-offers").andExpect(status().isForbidden());
    }

    // ------------------------------------------------- request approval rules

    @Test
    void approvingRequestObeysEveryPlacementRule() throws Exception {
        Account owner = register("req-owner");
        long ws = createWorkspace(owner, "Req WS " + sfx, null);
        long client = repoClient(ws, "Acme");

        long offer = repoOffer(ws, client, "Req Offer", 1);
        long rep = repoRep(ws, "Req Rep");
        long pendingId = createPendingRequest(ws, offer, rep, owner.userId());

        // A rep-role user cannot approve.
        Account repUser = register("req-rep");
        Membership membership = new Membership();
        membership.setWorkspaceId(ws);
        membership.setUserId(repUser.userId());
        membership.setRole(WorkspaceRole.REP);
        membership.setRepId(rep);
        membershipRepository.save(membership);
        apiPost(repUser, ws, "/api/placement-requests/" + pendingId + "/approve", "{}")
                .andExpect(status().isForbidden());

        // Approving places through the standard transactional path.
        apiPost(owner, ws, "/api/placement-requests/" + pendingId + "/approve", "{}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));
        assertThat(activePlacements(offer)).isEqualTo(1);

        // Deciding twice is a conflict.
        apiPost(owner, ws, "/api/placement-requests/" + pendingId + "/approve", "{}")
                .andExpect(status().isConflict());

        // A second rep cannot be approved into the last seat: the offer is now
        // full, so the approval fails with the same conflict as a direct place.
        long rep2 = repoRep(ws, "Req Rep 2");
        long pendingId2 = createPendingRequest(ws, offer, rep2, owner.userId());
        apiPost(owner, ws, "/api/placement-requests/" + pendingId2 + "/approve", "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Offer is full (1/1 seats filled)"));
        assertThat(activePlacements(offer)).isEqualTo(1);

        // Closing the offer blocks approval too.
        long offer2 = repoOffer(ws, client, "Req Offer 2", 3);
        long rep3 = repoRep(ws, "Req Rep 3");
        long pendingId3 = createPendingRequest(ws, offer2, rep3, owner.userId());
        apiPost(owner, ws, "/api/offers/" + offer2 + "/close", null).andExpect(status().isOk());
        apiPost(owner, ws, "/api/placement-requests/" + pendingId3 + "/approve", "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Offer is closed"));
        assertThat(activePlacements(offer2)).isZero();
    }

    @Test
    void approvingAlreadyPlacedRepIsRejected() throws Exception {
        Account owner = register("req-double");
        long ws = createWorkspace(owner, "Req Double " + sfx, null);
        long client = repoClient(ws, "Acme");
        long offerA = repoOffer(ws, client, "Offer A", 5);
        long offerB = repoOffer(ws, client, "Offer B", 5);
        long rep = repoRep(ws, "Busy Rep");

        // The rep is placed on offer A directly (approved request path).
        long first = createPendingRequest(ws, offerA, rep, owner.userId());
        apiPost(owner, ws, "/api/placement-requests/" + first + "/approve", "{}")
                .andExpect(status().isOk());

        // A pending request for offer B exists (created before the placement).
        long second = createPendingRequest(ws, offerB, rep, owner.userId());
        apiPost(owner, ws, "/api/placement-requests/" + second + "/approve", "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Rep already has an active placement"));

        // Declining works and is final.
        apiPost(owner, ws, "/api/placement-requests/" + second + "/decline",
                        "{\"note\":\"placed elsewhere\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DECLINED"));
        apiPost(owner, ws, "/api/placement-requests/" + second + "/decline", "{}")
                .andExpect(status().isConflict());
    }

    @Test
    void csvPreviewValidatesRowsAndImportRespectsPlanLimits() throws Exception {
        Account owner = register("csv-owner");
        long ws = createWorkspace(owner, "CSV WS " + sfx, null);

        String csv = """
                name,email,vertical,status,experience,notes,joined
                Alice Wonder,alice@example.test,Sales,Bench,Mid,Great,2026-01-05
                Bob Stone,bob@example.test,Quantum,Bench,Junior,,
                """;

        // Preview flags the unknown vertical on row 3 without writing anything.
        var preview = apiPost(owner, ws, "/api/reps/import/preview",
                        "{\"csv\":" + toJson(csv) + "}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.errorRows").value(1))
                .andExpect(jsonPath("$.rows[0].rowNumber").value(2))
                .andExpect(jsonPath("$.rows[0].valid").value(true))
                .andExpect(jsonPath("$.rows[1].valid").value(false))
                .andReturn();
        assertThat(read(preview)).isNotNull();

        // Import skips the bad row and reports why.
        var imported = apiPost(owner, ws, "/api/reps/import",
                        "{\"csv\":" + toJson(csv) + "}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.imported").value(1))
                .andExpect(jsonPath("$.rows[1].outcome").value("SKIPPED"))
                .andReturn();
        String detail = read(imported).get("rows").get(1).get("detail").asText();
        assertThat(detail).contains("vertical 'Quantum' does not exist");

        // The free plan caps reps at 10: filling to the ceiling, then one more
        // CSV row, is skipped with a plan-limit reason (402-style, no failure).
        for (int i = 0; i < 9; i++) {
            repoRep(ws, "Filler " + i);
        }
        String overflow = """
                name
                Overflow Rep
                """;
        var overflowResult = apiPost(owner, ws, "/api/reps/import",
                        "{\"csv\":" + toJson(overflow) + "}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.imported").value(0))
                .andReturn();
        assertThat(read(overflowResult).get("rows").get(0).get("detail").asText())
                .contains("plan limit reached");

        // Creating a rep beyond the cap via the normal endpoint is a 402.
        apiPost(owner, ws, "/api/reps", "{\"name\":\"Over Cap\"}")
                .andExpect(status().isPaymentRequired())
                .andExpect(jsonPath("$.code").value("PLAN_LIMIT_EXCEEDED"))
                .andExpect(jsonPath("$.details.limit").value(10));
    }

    // ------------------------------------------------------------------ helpers

    /** Inserts a pending placement request straight through the repository. */
    private long createPendingRequest(long workspaceId, long offerId, long repId, Long userId) {
        com.coeso.roster.entity.PlacementRequest request =
                new com.coeso.roster.entity.PlacementRequest();
        request.setWorkspaceId(workspaceId);
        request.setOfferId(offerId);
        request.setRepId(repId);
        request.setRequestedBy(userId);
        request.setStatus(com.coeso.roster.entity.PlacementRequestStatus.PENDING);
        placementRequestRepository.save(request);
        return request.getId();
    }

    private long activePlacements(long offerId) {
        return placementRepository.findAll().stream()
                .filter(p -> p.getOfferId() == offerId
                        && p.getStatus() == com.coeso.roster.entity.PlacementStatus.ACTIVE)
                .count();
    }

    private static String toJson(String raw) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : raw.toCharArray()) {
            if (c == '"' || c == '\\') {
                sb.append('\\').append(c);
            } else if (c == '\n') {
                sb.append("\\n");
            } else if (c == '\r') {
                sb.append("\\r");
            } else {
                sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
