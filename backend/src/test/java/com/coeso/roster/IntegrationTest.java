package com.coeso.roster;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.Client;
import com.coeso.roster.entity.ExperienceLevel;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.OfferStatus;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.entity.PlacementStatus;
import com.coeso.roster.entity.Rep;
import com.coeso.roster.entity.RepStatus;
import com.coeso.roster.entity.StatusKind;
import com.coeso.roster.entity.Vertical;
import com.coeso.roster.placement.PlacementService;
import com.coeso.roster.repo.Repositories.AuditLogRepository;
import com.coeso.roster.repo.Repositories.ClientRepository;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.OfferRepository;
import com.coeso.roster.repo.Repositories.PlacementRepository;
import com.coeso.roster.repo.Repositories.PlacementRequestRepository;
import com.coeso.roster.repo.Repositories.RepRepository;
import com.coeso.roster.repo.Repositories.RepStatusRepository;
import com.coeso.roster.repo.Repositories.SubscriptionRepository;
import com.coeso.roster.repo.Repositories.ExperienceLevelRepository;
import com.coeso.roster.repo.Repositories.VerticalRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.util.UUID;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.utility.DockerImageName;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;

/**
 * Base class for integration tests.
 *
 * <p>Database: Testcontainers MySQL 8 when Docker is available (the default on
 * dev machines and CI). When Docker is missing, the suite falls back to an
 * external MySQL given by {@code ROSTER_TEST_DB_URL} (see
 * application-test.yml) — the same engine and the same assertions either way.
 * The test schema is cleaned and re-migrated by Flyway on every run.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
public abstract class IntegrationTest {

    protected static final MySQLContainer<?> MYSQL;

    static {
        MySQLContainer<?> container = null;
        try {
            if (DockerClientFactory.instance().isDockerAvailable()) {
                container = new MySQLContainer<>(DockerImageName.parse("mysql:8.0.40"))
                        .withDatabaseName("roster_test");
                container.start();
                System.out.println("[tests] Database: Testcontainers MySQL -> "
                        + container.getJdbcUrl());
            }
        } catch (Throwable t) {
            System.out.println("[tests] Docker unavailable ("
                    + t.getClass().getSimpleName() + ": " + t.getMessage() + ")");
        }
        if (container == null) {
            System.out.println("[tests] Database: external MySQL from application-test.yml");
        }
        MYSQL = container;
    }

    @DynamicPropertySource
    static void testDatasource(DynamicPropertyRegistry registry) {
        if (MYSQL != null) {
            registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
            registry.add("spring.datasource.username", MYSQL::getUsername);
            registry.add("spring.datasource.password", MYSQL::getPassword);
        }
    }

    @Autowired protected MockMvc mockMvc;
    @Autowired protected ObjectMapper objectMapper;
    @Autowired protected MembershipRepository membershipRepository;
    @Autowired protected SubscriptionRepository subscriptionRepository;
    @Autowired protected AuditLogRepository auditLogRepository;
    @Autowired protected PlacementRepository placementRepository;
    @Autowired protected PlacementRequestRepository placementRequestRepository;
    @Autowired protected RepRepository repRepository;
    @Autowired protected OfferRepository offerRepository;
    @Autowired protected ClientRepository clientRepository;
    @Autowired protected VerticalRepository verticalRepository;
    @Autowired protected WorkspaceRepository workspaceRepository;
    @Autowired protected RepStatusRepository repStatusRepository;
    @Autowired protected ExperienceLevelRepository experienceLevelRepository;
    @Autowired protected PlatformTransactionManager transactionManager;
    @Autowired protected PlacementService placementService;

    @PersistenceContext protected EntityManager entityManager;

    protected TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    // ------------------------------------------------------------------ accounts

    protected record Account(String token, Long userId, String email) {
    }

    protected Account register() {
        return register("user");
    }

    protected Account register(String prefix) {
        String email = prefix + "-" + UUID.randomUUID().toString().substring(0, 8)
                + "@example.test";
        return registerWith(email);
    }

    /** Registers with an exact email (needed for invite-acceptance tests). */
    protected Account registerWith(String email) {
        String body = "{\"email\":\"" + email + "\",\"password\":\"password123\","
                + "\"displayName\":\"Test User\"}";
        try {
            MvcResult result = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                            .post("/api/auth/register")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                            .status().isCreated())
                    .andReturn();
            JsonNode node = read(result);
            return new Account(node.get("token").asText(),
                    node.get("user").get("id").asLong(), email);
        } catch (Exception e) {
            throw new IllegalStateException("registration failed", e);
        }
    }

    protected long createWorkspace(Account owner, String name, String slug) {
        String body = slug == null
                ? "{\"name\":\"" + name + "\"}"
                : "{\"name\":\"" + name + "\",\"slug\":\"" + slug + "\"}";
        try {
            MvcResult result = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                            .post("/api/workspaces")
                            .header("Authorization", bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                            .status().isCreated())
                    .andReturn();
            return read(result).get("id").asLong();
        } catch (Exception e) {
            throw new IllegalStateException("workspace creation failed", e);
        }
    }

    protected void addMember(long workspaceId, Long userId, WorkspaceRole role) {
        Membership membership = new Membership();
        membership.setWorkspaceId(workspaceId);
        membership.setUserId(userId);
        membership.setRole(role);
        membershipRepository.save(membership);
    }

    /**
     * Moves the workspace onto another plan (test fixture, no HTTP). New
     * workspaces start on the free plan, so [PRO] surfaces need this first.
     */
    protected void moveToPlan(long workspaceId, String planCode) {
        tx().executeWithoutResult(s -> {
            var plan = entityManager
                    .createQuery("select p from Plan p where p.code = :code",
                            com.coeso.roster.entity.Plan.class)
                    .setParameter("code", planCode)
                    .getSingleResult();
            var workspace = entityManager.find(com.coeso.roster.entity.Workspace.class,
                    workspaceId);
            workspace.setPlan(plan);
            entityManager.flush();
        });
    }

    // ------------------------------------------------------------------ requests

    protected static String bearer(Account account) {
        return "Bearer " + account.token();
    }

    protected ResultActions apiGet(Account account, Long workspaceId, String path) throws Exception {
        return mockMvc.perform(withHeaders(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .get(path), account, workspaceId));
    }

    protected ResultActions apiPost(Account account, Long workspaceId, String path, String body)
            throws Exception {
        MockHttpServletRequestBuilder builder = withHeaders(
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path),
                account, workspaceId);
        if (body != null) {
            builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    protected ResultActions apiPut(Account account, Long workspaceId, String path, String body)
            throws Exception {
        MockHttpServletRequestBuilder builder = withHeaders(
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(path),
                account, workspaceId)
                .contentType(MediaType.APPLICATION_JSON);
        if (body != null) {
            builder.content(body);
        }
        return mockMvc.perform(builder);
    }

    protected ResultActions apiDelete(Account account, Long workspaceId, String path) throws Exception {
        return mockMvc.perform(withHeaders(
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(path),
                account, workspaceId));
    }

    private MockHttpServletRequestBuilder withHeaders(MockHttpServletRequestBuilder builder,
                                                       Account account, Long workspaceId) {
        builder.header("Authorization", bearer(account));
        if (workspaceId != null) {
            builder.header("X-Workspace", String.valueOf(workspaceId));
        }
        return builder;
    }

    protected JsonNode read(MvcResult result) {
        String body = responseOf(result);
        try {
            return objectMapper.readTree(body);
        } catch (Exception e) {
            throw new IllegalStateException("unparsable response: " + body, e);
        }
    }

    protected static String responseOf(MvcResult result) {
        try {
            return result.getResponse().getContentAsString();
        } catch (java.io.UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    // ------------------------------------------------------------------ fixtures

    /** Creates a client straight through the repository (no auth/role involved). */
    protected long repoClient(long workspaceId, String name) {
        Client client = new Client();
        client.setWorkspaceId(workspaceId);
        client.setName(name);
        clientRepository.save(client);
        return client.getId();
    }

    protected long repoRep(long workspaceId, String name) {
        Rep rep = new Rep();
        rep.setWorkspaceId(workspaceId);
        rep.setName(name);
        repRepository.save(rep);
        return rep.getId();
    }

    protected long repoOffer(long workspaceId, long clientId, String title, int seats) {
        Offer offer = new Offer();
        offer.setWorkspaceId(workspaceId);
        offer.setClientId(clientId);
        offer.setTitle(title);
        offer.setSeats(seats);
        offer.setStatus(OfferStatus.OPEN);
        offerRepository.save(offer);
        return offer.getId();
    }

    protected long repoVertical(long workspaceId, String name) {
        Vertical vertical = new Vertical();
        vertical.setWorkspaceId(workspaceId);
        vertical.setName(name);
        verticalRepository.save(vertical);
        return vertical.getId();
    }

    protected long repoStatus(long workspaceId, String name) {
        RepStatus status = new RepStatus();
        status.setWorkspaceId(workspaceId);
        status.setName(name);
        status.setKind(StatusKind.BENCH);
        repStatusRepository.save(status);
        return status.getId();
    }

    protected long repoPlacement(long workspaceId, long offerId, long repId) {
        Placement placement = new Placement();
        placement.setWorkspaceId(workspaceId);
        placement.setOfferId(offerId);
        placement.setRepId(repId);
        placement.setStatus(PlacementStatus.ACTIVE);
        placementRepository.save(placement);
        return placement.getId();
    }

    /** Installs a TenantContext on this thread for direct service calls. */
    protected void setTenant(long workspaceId, WorkspaceRole role, Long userId) {
        com.coeso.roster.common.TenantContext.set(workspaceId, role, userId);
    }

    protected void clearTenant() {
        com.coeso.roster.common.TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    protected static MockHttpServletResponse responseOf(
            org.springframework.test.web.servlet.ResultActions actions) {
        try {
            return actions.andReturn().getResponse();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
