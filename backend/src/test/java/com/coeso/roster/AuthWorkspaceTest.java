package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.entity.Subscription;
import com.coeso.roster.entity.SubscriptionStatus;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/** Registration, login, JWT, workspace creation with default seeding + trial. */
class AuthWorkspaceTest extends IntegrationTest {

    @Test
    void registerLoginAndMe() throws Exception {
        Account account = register("auth");

        // login works with the same credentials
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + account.email() + "\",\"password\":\"password123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.user.email").value(account.email()));

        // wrong password -> 401
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + account.email() + "\",\"password\":\"wrong-pass-1\"}"))
                .andExpect(status().isUnauthorized());

        // me works with the token, and without a token it is 401
        mockMvc.perform(get("/api/auth/me").header("Authorization", bearer(account)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(account.userId()));
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void duplicateEmailIsRejected() throws Exception {
        Account account = register("dup");
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + account.email() + "\",\"password\":\"password123\","
                                + "\"displayName\":\"Again\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    void creatingWorkspaceSeedsDefaultsAndTrialingSubscription() throws Exception {
        Account owner = register("seed");
        long workspaceId = createWorkspace(owner, "Seed Workspace " + suffix(), null);

        // default verticals
        apiGet(owner, workspaceId, "/api/verticals")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[?(@.name == 'Sales')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Advertising')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Partnerships')]").exists());

        // default statuses with kinds
        apiGet(owner, workspaceId, "/api/statuses")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[?(@.name == 'Bench' && @.kind == 'BENCH')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Training' && @.kind == 'TRAINING')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Inactive' && @.kind == 'INACTIVE')]").exists());

        // default experience levels
        apiGet(owner, workspaceId, "/api/experience-levels")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[?(@.name == 'Junior')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Mid')]").exists())
                .andExpect(jsonPath("$[?(@.name == 'Senior')]").exists());

        // membership: caller is owner
        var membership = membershipRepository.findByUserIdAndWorkspaceId(owner.userId(), workspaceId);
        assertThat(membership).isPresent();
        assertThat(membership.get().getRole().name()).isEqualTo("OWNER");

        // subscription: trialing on the free plan
        Subscription subscription = subscriptionRepository.findByWorkspaceId(workspaceId).orElseThrow();
        assertThat(subscription.getStatus()).isEqualTo(SubscriptionStatus.TRIALING);
        assertThat(subscription.getPlan().getCode()).isEqualTo("free");
        assertThat(subscription.getTrialEndsAt()).isNotNull();

        // workspace appears in the picker with the owner role
        apiGet(owner, null, "/api/workspaces")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == " + workspaceId + " && @.role == 'OWNER')]").exists());
    }

    @Test
    void slugValidation() throws Exception {
        Account owner = register("slug");

        // reserved words are rejected
        apiPost(owner, null, "/api/workspaces", "{\"name\":\"Reserved\",\"slug\":\"admin\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));

        // malformed slugs are rejected
        apiPost(owner, null, "/api/workspaces", "{\"name\":\"Bad\",\"slug\":\"a b\"}")
                .andExpect(status().isBadRequest());

        // duplicate slug -> 409
        String slug = "slug-" + suffix().toLowerCase();
        createWorkspace(owner, "First One", slug);
        apiPost(owner, null, "/api/workspaces", "{\"name\":\"Second\",\"slug\":\"" + slug + "\"}")
                .andExpect(status().isConflict());
    }

    @Test
    void workspaceScopedEndpointRequiresWorkspaceHeader() throws Exception {
        Account account = register("noheader");
        mockMvc.perform(get("/api/reps").header("Authorization", bearer(account)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BAD_REQUEST"));

        // and a bogus X-Workspace is rejected as not-a-member
        mockMvc.perform(get("/api/reps")
                        .header("Authorization", bearer(account))
                        .header("X-Workspace", "999999"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("WORKSPACE_ACCESS_DENIED"));
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
