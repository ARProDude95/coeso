package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.discord.DiscordApiClient;
import com.coeso.roster.discord.DiscordApiClient.DiscordProfile;
import com.coeso.roster.discord.DiscordNotifier;
import com.coeso.roster.entity.WorkspaceDiscord;
import com.coeso.roster.repo.Repositories.UserRepository;
import com.coeso.roster.repo.Repositories.WorkspaceDiscordRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Phase 5:
 *  - Login with Discord links an existing account by email (or creates a user
 *    with no password) and syncs the member's workspace roles from the guild
 *    role map;
 *  - role sync NEVER grants or revokes owner, even when the map says so;
 *  - a failing Discord notification does not fail the placement;
 *  - reports, branding and Discord settings obey the role matrix and are
 *    tenant-scoped (a foreign workspace's config and numbers are invisible).
 *
 * <p>The DiscordApiClient and DiscordNotifier beans are replaced with mocks:
 * no test ever reaches out to Discord. application-test.yml supplies a fake
 * client id/secret so the "configured" paths run.
 */
class Phase5DiscordReportsTest extends IntegrationTest {

    @Autowired private WorkspaceDiscordRepository workspaceDiscordRepository;
    @Autowired private UserRepository userRepository;

    @MockitoBean private DiscordApiClient discordApi;
    @MockitoBean private DiscordNotifier discordNotifier;

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    /**
     * Discord ids must be unique per run: the test database may persist
     * between runs (external MySQL fallback), and users linked to a leftover
     * discord_id would be picked up by findByDiscordId instead of the account
     * this test just registered. Hex "sfx" -> decimal keeps it numeric.
     */
    private String did(String prefix) {
        return prefix + Long.parseLong(sfx, 16);
    }

    // ------------------------------------------------------------ login flow

    @Test
    void discordLoginLinksExistingUserByEmailAndKeepsPasswordLoginWorking() throws Exception {
        Account existing = register("p5-link");

        when(discordApi.configured()).thenReturn(true);
        when(discordApi.exchangeCode("code-link")).thenReturn("access-token");
        when(discordApi.fetchProfile("access-token"))
                .thenReturn(new DiscordProfile(did("91"), existing.email(), "Linked User"));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/auth/discord")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"code-link\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.id").value(existing.userId()))
                .andExpect(jsonPath("$.user.email").value(existing.email()));

        // The password is untouched: the old credentials still log in.
        var user = userRepository.findById(existing.userId()).orElseThrow();
        assertThat(user.getPasswordHash()).isNotBlank();
        assertThat(user.getDiscordId()).isEqualTo(did("91"));
    }

    @Test
    void discordLoginCreatesAUserWithoutAPasswordWhenEmailIsUnknown() throws Exception {
        String email = "fresh-" + sfx + "@discord.test";

        when(discordApi.configured()).thenReturn(true);
        when(discordApi.exchangeCode("code-new")).thenReturn("access-token");
        when(discordApi.fetchProfile("access-token"))
                .thenReturn(new DiscordProfile(did("92"), email, "Fresh Discord User"));

        var first = read(mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/auth/discord")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"code-new\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value(email))
                .andReturn());
        Long userId = first.get("user").get("id").asLong();

        var user = userRepository.findById(userId).orElseThrow();
        assertThat(user.getPasswordHash()).isNull();
        assertThat(user.getDiscordId()).isEqualTo(did("92"));

        // Logging in again reuses the same account: no duplicate user.
        var second = read(mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/auth/discord")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"code-new\"}"))
                .andExpect(status().isOk())
                .andReturn());
        assertThat(second.get("user").get("id").asLong()).isEqualTo(userId);
        assertThat(userRepository.findByEmail(email).isPresent()).isTrue();
    }

    @Test
    void discordEndpointAnswers503WhenNotConfigured() throws Exception {
        // Unstubbed mock: configured() -> false, authorizeUrl() -> null.
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/auth/discord/url"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("DISCORD_NOT_CONFIGURED"));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/auth/discord")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"whatever\"}"))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void discordAuthorizeUrlIsPublic() throws Exception {
        when(discordApi.authorizeUrl()).thenReturn("https://discord.com/oauth2/authorize?client_id=x");
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/auth/discord/url"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value(
                        "https://discord.com/oauth2/authorize?client_id=x"));
    }

    // ------------------------------------------------------------- role sync

    @Test
    void roleSyncUpgradesToTheHighestMappedRoleButNeverOwner() throws Exception {
        Account user = register("p5-sync");
        long ws = createWorkspace(user, "P5 Sync " + sfx, null);
        // Downgrade the creator to MANAGER so the sync has somewhere to go.
        var membership = membershipRepository.findAllByUserId(user.userId()).get(0);
        membership.setRole(WorkspaceRole.MANAGER);
        membershipRepository.save(membership);

        // Role map: ADMIN is grantable, OWNER is ignored by the sync.
        connect(ws, Map.of("111", "ADMIN", "222", "OWNER"));
        stubLogin(did("93"), user.email());
        when(discordApi.memberRoleIds(anyString(), anyString())).thenReturn(List.of("111", "222"));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/auth/discord")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"sync-code\"}"))
                .andExpect(status().isOk());

        var after = membershipRepository.findAllByUserId(user.userId()).get(0);
        assertThat(after.getRole())
                .as("highest grantable mapped role wins")
                .isEqualTo(WorkspaceRole.ADMIN);

        // The sync left an audit row for the role change (rule 8).
        assertThat(auditLogRepository.findAll().stream()
                .filter(a -> a.getEntityType().equals("membership")
                        && a.getDetails() != null
                        && a.getDetails().contains("discord_role_sync"))
                .count()).isGreaterThanOrEqualTo(1);
    }

    @Test
    void roleSyncNeverGrantsOwnerEvenWhenTheMapTargetsIt() throws Exception {
        Account user = register("p5-noowner");
        long ws = createWorkspace(user, "P5 No Owner " + sfx, null);
        var membership = membershipRepository.findAllByUserId(user.userId()).get(0);
        membership.setRole(WorkspaceRole.MANAGER);
        membershipRepository.save(membership);

        connect(ws, Map.of("222", "OWNER", "333", "MANAGER"));
        stubLogin(did("94"), user.email());
        when(discordApi.memberRoleIds(anyString(), anyString())).thenReturn(List.of("222", "333"));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/auth/discord")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"sync-code\"}"))
                .andExpect(status().isOk());

        var after = membershipRepository.findAllByUserId(user.userId()).get(0);
        assertThat(after.getRole())
                .as("an OWNER mapping must never be applied")
                .isEqualTo(WorkspaceRole.MANAGER);
    }

    @Test
    void roleSyncNeverDemotesAnOwner() throws Exception {
        Account owner = register("p5-ownkeep");
        long ws = createWorkspace(owner, "P5 Owner Keep " + sfx, null);

        connect(ws, Map.of("111", "ADMIN", "222", "REP"));
        stubLogin(did("95"), owner.email());
        when(discordApi.memberRoleIds(anyString(), anyString())).thenReturn(List.of("222"));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/auth/discord")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"sync-code\"}"))
                .andExpect(status().isOk());

        var after = membershipRepository.findAllByUserId(owner.userId()).get(0);
        assertThat(after.getRole())
                .as("owners are never touched by role sync")
                .isEqualTo(WorkspaceRole.OWNER);
    }

    // ------------------------------------------------------- failing notifier

    @Test
    void failingDiscordNotificationDoesNotFailThePlacement() throws Exception {
        Account manager = register("p5-notify");
        long ws = createWorkspace(manager, "P5 Notify " + sfx, null);
        long client = repoClient(ws, "Notify Client " + sfx);
        long repId = repoRep(ws, "Notify Rep " + sfx);
        long offerId = repoOffer(ws, client, "Notify Offer " + sfx, 5);

        doThrow(new IllegalStateException("discord is down"))
                .when(discordNotifier).repPlaced(any(), anyString(), anyString());

        apiPost(manager, ws, "/api/placements",
                "{\"offerId\":" + offerId + ",\"repId\":" + repId + "}")
                .andExpect(status().isCreated());

        // The placement committed (and the audit row exists) despite the bot
        // blowing up: exactly one active placement for this rep.
        assertThat(placementRepository.findAll().stream()
                .filter(p -> p.getRepId() == repId && p.getStatus().name().equals("ACTIVE"))
                .count()).isEqualTo(1);
    }

    @Test
    void failingDiscordNotificationDoesNotFailOfferOrRequestCreation() throws Exception {
        Account manager = register("p5-notify2");
        long ws = createWorkspace(manager, "P5 Notify 2 " + sfx, null);
        long client = repoClient(ws, "Notify2 Client " + sfx);
        long offerId = repoOffer(ws, client, "Notify2 Offer " + sfx, 5);
        long repId = repoRep(ws, "Notify2 Rep " + sfx);

        doThrow(new IllegalStateException("discord is down"))
                .when(discordNotifier).offerOpened(any(), anyString(), any());
        doThrow(new IllegalStateException("discord is down"))
                .when(discordNotifier).placementRequest(any(), anyString(), anyString());

        apiPost(manager, ws, "/api/offers",
                "{\"clientId\":" + client + ",\"title\":\"Notify2 New Offer\",\"seats\":3}")
                .andExpect(status().isCreated());

        apiPost(manager, ws, "/api/placement-requests",
                "{\"offerId\":" + offerId + ",\"repId\":" + repId + "}")
                .andExpect(status().is2xxSuccessful());
    }

    // -------------------------------------------------------- Discord settings

    @Test
    void discordSettingsFollowTheRoleMatrixAndRejectOwnerMappings() throws Exception {
        Account owner = register("p5-ds-creator");
        long ws = createWorkspace(owner, "P5 Discord Settings " + sfx, null);
        Account admin = register("p5-ds-admin");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        Account manager = register("p5-ds-mgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        Account rep = register("p5-ds-rep");
        addMember(ws, rep.userId(), WorkspaceRole.REP);

        String body = "{\"guildId\":\"123456\",\"notificationChannelId\":\"654321\","
                + "\"roleMap\":{\"111\":\"MANAGER\"}}";

        // Reads need admin+ too (it is a settings surface).
        apiGet(rep, ws, "/api/discord/settings").andExpect(status().isForbidden());
        apiGet(manager, ws, "/api/discord/settings").andExpect(status().isForbidden());
        apiGet(admin, ws, "/api/discord/settings")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(false));

        // Writes need admin+.
        apiPut(manager, ws, "/api/discord/settings", body).andExpect(status().isForbidden());
        apiPut(admin, ws, "/api/discord/settings", body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(true))
                .andExpect(jsonPath("$.guildId").value("123456"))
                .andExpect(jsonPath("$.roleMap['111']").value("MANAGER"));

        // A role map may never target owner — rejected outright.
        apiPut(admin, ws, "/api/discord/settings",
                "{\"guildId\":\"123456\",\"roleMap\":{\"111\":\"OWNER\"}}")
                .andExpect(status().isBadRequest());
        // Non-numeric Discord ids are rejected too.
        apiPut(admin, ws, "/api/discord/settings",
                "{\"guildId\":\"not-a-snowflake\"}")
                .andExpect(status().isBadRequest());
    }

    @Test
    void discordSettingsAreTenantScoped() throws Exception {
        Account ownerA = register("p5-iso-a");
        long wsA = createWorkspace(ownerA, "P5 Iso A " + sfx, null);
        Account ownerB = register("p5-iso-b");
        long wsB = createWorkspace(ownerB, "P5 Iso B " + sfx, null);

        apiPut(ownerA, wsA, "/api/discord/settings",
                "{\"guildId\":\"111\",\"roleMap\":{\"9\":\"ADMIN\"}}")
                .andExpect(status().isOk());

        // B sees its own (unconnected) settings; A's guild id never leaks.
        apiGet(ownerB, wsB, "/api/discord/settings")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connected").value(false));

        // And B's admin cannot touch A's workspace: not a member -> 403.
        apiGet(ownerB, wsA, "/api/discord/settings").andExpect(status().isForbidden());
    }

    // ---------------------------------------------------------------- branding

    @Test
    void brandingFollowsTheRoleMatrixAndValidatesTheAccentColor() throws Exception {
        Account owner = register("p5-br-creator");
        long ws = createWorkspace(owner, "P5 Branding " + sfx, null);
        Account admin = register("p5-br-admin");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        Account manager = register("p5-br-mgr");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        Account rep = register("p5-br-rep");
        addMember(ws, rep.userId(), WorkspaceRole.REP);

        // Reading branding is open to every member (the shell renders it).
        apiGet(rep, ws, "/api/workspaces/branding")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accentColor").doesNotExist());

        String body = "{\"logoUrl\":\"https://cdn.example.test/logo.png\","
                + "\"accentColor\":\"#CDA35A\",\"customDomain\":\"acme.example.test\"}";
        apiPut(rep, ws, "/api/workspaces/branding", body).andExpect(status().isForbidden());
        apiPut(manager, ws, "/api/workspaces/branding", body).andExpect(status().isForbidden());
        apiPut(admin, ws, "/api/workspaces/branding", body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accentColor").value("#cda35a"))
                .andExpect(jsonPath("$.customDomain").value("acme.example.test"));

        // A non-hex accent color is rejected.
        apiPut(admin, ws, "/api/workspaces/branding", "{\"accentColor\":\"gold\"}")
                .andExpect(status().isBadRequest());

        // Another workspace's owner cannot change this workspace's branding.
        Account outsider = register("p5-br-out");
        long otherWs = createWorkspace(outsider, "P5 Branding Other " + sfx, null);
        apiPut(outsider, otherWs, "/api/workspaces/branding", body)
                .andExpect(status().isOk());
        apiGet(admin, ws, "/api/workspaces/branding")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accentColor").value("#cda35a"));
    }

    // ----------------------------------------------------------------- reports

    @Test
    void reportsAreTenantScopedAndComputedFromPlacements() throws Exception {
        Account manager = register("p5-rep-mgr");
        long wsA = createWorkspace(manager, "P5 Reports A " + sfx, null);
        Account other = register("p5-rep-other");
        long wsB = createWorkspace(other, "P5 Reports B " + sfx, null);

        long client = repoClient(wsA, "Reports Client " + sfx);
        long repA = repoRep(wsA, "Reports Rep A " + sfx);
        long repB = repoRep(wsA, "Reports Rep B " + sfx);
        long offer = repoOffer(wsA, client, "Reports Offer " + sfx, 5);

        // Manager places one of the two reps through the API.
        apiPost(manager, wsA, "/api/placements",
                "{\"offerId\":" + offer + ",\"repId\":" + repA + "}")
                .andExpect(status().isCreated());

        apiGet(manager, wsA, "/api/reports")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.placementRate.totalReps").value(2))
                .andExpect(jsonPath("$.placementRate.placedReps").value(1))
                .andExpect(jsonPath("$.placementRate.rate").value(0.5))
                .andExpect(jsonPath("$.placementsPerOffer[0].activePlacements").value(1))
                .andExpect(jsonPath("$.placementsPerOffer[0].totalPlacements").value(1))
                .andExpect(jsonPath("$.verticals[0].name").value("Uncategorised"))
                .andExpect(jsonPath("$.verticals[0].reps").value(2))
                .andExpect(jsonPath("$.verticals[0].placedReps").value(1))
                .andExpect(jsonPath("$.averageBenchDays").doesNotExist());

        // Workspace B sees none of A's numbers.
        apiGet(other, wsB, "/api/reports")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.placementRate.totalReps").value(0))
                .andExpect(jsonPath("$.placementRate.placedReps").value(0))
                .andExpect(jsonPath("$.placementsPerOffer").isEmpty());

        // Reps may not read the analytics; managers and above may.
        Account rep = register("p5-rep-role");
        addMember(wsA, rep.userId(), WorkspaceRole.REP);
        apiGet(rep, wsA, "/api/reports").andExpect(status().isForbidden());
        Account admin = register("p5-rep-admin");
        addMember(wsA, admin.userId(), WorkspaceRole.ADMIN);
        apiGet(admin, wsA, "/api/reports").andExpect(status().isOk());
        apiGet(manager, wsA, "/api/reports").andExpect(status().isOk());
    }

    @Test
    void reportsComputeAverageBenchDaysFromEndedPlacements() throws Exception {
        Account manager = register("p5-bench");
        long ws = createWorkspace(manager, "P5 Bench " + sfx, null);
        long client = repoClient(ws, "Bench Client " + sfx);
        long repId = repoRep(ws, "Bench Rep " + sfx);
        long offer = repoOffer(ws, client, "Bench Offer " + sfx, 5);

        apiPost(manager, ws, "/api/placements",
                "{\"offerId\":" + offer + ",\"repId\":" + repId + "}")
                .andExpect(status().isCreated());

        // End the placement three days ago (repo write, timestamps included).
        tx().executeWithoutResult(status -> {
            var placement = placementRepository.findAll().stream()
                    .filter(p -> p.getRepId() == repId)
                    .findFirst().orElseThrow();
            placement.setEndedAt(java.time.LocalDateTime.now().minusDays(3));
            placement.setStatus(com.coeso.roster.entity.PlacementStatus.ENDED);
            placementRepository.save(placement);
        });
        clearTenant();

        apiGet(manager, ws, "/api/reports")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.benchSamples").value(1))
                .andExpect(jsonPath("$.averageBenchDays").value(3.0));
    }

    // ---------------------------------------------------------------- helpers

    /** Stubs the OAuth exchange + profile fetch for a Discord login. */
    private void stubLogin(String discordId, String email) {
        when(discordApi.configured()).thenReturn(true);
        when(discordApi.exchangeCode(anyString())).thenReturn("access-token");
        when(discordApi.fetchProfile(anyString()))
                .thenReturn(new DiscordProfile(discordId, email, "Synced User"));
    }

    /** Saves a workspace_discord connection straight through the repository. */
    private void connect(long workspaceId, java.util.Map<String, String> roleMap) {
        WorkspaceDiscord connection = new WorkspaceDiscord();
        connection.setWorkspaceId(workspaceId);
        connection.setGuildId(did("77"));
        connection.setNotificationChannelId(did("88"));
        try {
            connection.setRoleMap(objectMapper.writeValueAsString(roleMap));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        workspaceDiscordRepository.save(connection);
    }
}
