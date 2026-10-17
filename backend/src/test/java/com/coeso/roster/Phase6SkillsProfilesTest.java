package com.coeso.roster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.coeso.roster.common.WorkspaceRole;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * Phase 6 — skills, profiles and smart matching:
 *
 * <ul>
 *   <li>rep profile expansion persists skills / languages / timezone /
 *       availability / preferred verticals / bio, and skill tags grow the
 *       workspace's list case-insensitively;</li>
 *   <li>roster filters by skill, language and availability (list + CSV
 *       export honour them);</li>
 *   <li>offer requirements round-trip, and GET suggested ranks available reps
 *       0–100 with the per-factor breakdown, excludes placed reps, and never
 *       crosses a tenant boundary;</li>
 *   <li>photo upload validates type and 2 MB size;</li>
 *   <li>every new endpoint follows the permission matrix — lookups are open to
 *       all four roles, profile/photo/suggestions are manager+ (rep 403);</li>
 *   <li>tag creation and profile changes land in the audit trail.</li>
 * </ul>
 */
public class Phase6SkillsProfilesTest extends IntegrationTest {

    /** Run-unique workspace name (external-MySQL fallback persists rows). */
    private long uniqueWorkspace(Account owner, String prefix) {
        return createWorkspace(owner, prefix + " "
                + UUID.randomUUID().toString().substring(0, 8), null);
    }

    /** Id of a seeded default vertical (Sales/Advertising/Partnerships). */
    private long seededVerticalId(long ws, String name) {
        return tx().execute(s -> entityManager
                .createQuery("select v.id from Vertical v"
                        + " where v.workspaceId = :ws and v.name = :name", Long.class)
                .setParameter("ws", ws)
                .setParameter("name", name)
                .getSingleResult());
    }

    /** Highest-id experience level = most senior seed (Junior, Mid, Senior). */
    private long seniorLevelId(long ws) {
        return tx().execute(s -> entityManager
                .createQuery("select max(e.id) from ExperienceLevel e"
                        + " where e.workspaceId = :ws", Long.class)
                .setParameter("ws", ws)
                .getSingleResult());
    }

    private long createRepViaApi(Account actor, long ws, String body) throws Exception {
        var result = apiPost(actor, ws, "/api/reps", body)
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated())
                .andReturn();
        return read(result).get("id").asLong();
    }

    private JsonNode getReps(Account actor, long ws, String query) throws Exception {
        var result = apiGet(actor, ws, "/api/reps" + query)
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn();
        return read(result);
    }

    /** True when the rep page contains an item with this name. */
    private boolean contains(JsonNode page, String name) {
        for (JsonNode item : page.get("items")) {
            if (name.equals(item.get("name").asText())) {
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------ profile round-trip

    @Test
    void repProfilePersistsSkillsLanguagesAndAvailability() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Profile Co");
        long sales = seededVerticalId(ws, "Sales");

        createRepViaApi(owner, ws, """
                {"name":"Ada Profile","email":"ada@example.test",
                 "skills":["Cold Calling"," Outbound "],
                 "languages":["English","Spanish"],
                 "timezone":"Europe/Berlin","hoursPerWeek":32,
                 "availableFrom":"%s","bio":"Sells things well.",
                 "preferredVerticalIds":[%d]}
                """.formatted(LocalDate.now().plusDays(3), sales));

        JsonNode page = getReps(owner, ws, "");
        JsonNode ada = null;
        for (JsonNode item : page.get("items")) {
            if (item.get("name").asText().equals("Ada Profile")) {
                ada = item;
            }
        }
        assertNotNull(ada, "created rep is listed");
        assertTrue(ada.get("skills").toString().contains("Cold Calling"));
        assertTrue(ada.get("skills").toString().contains("Outbound"),
                "skill names are trimmed");
        assertEquals("Europe/Berlin", ada.get("timezone").asText());
        assertEquals(32, ada.get("hoursPerWeek").asInt());
        assertEquals(LocalDate.now().plusDays(3).toString(),
                ada.get("availableFrom").asText());
        assertEquals("Sells things well.", ada.get("bio").asText());
        assertTrue(ada.get("preferredVerticalIds").toString().contains(String.valueOf(sales)));
        assertFalse(ada.get("hasPhoto").asBoolean(), "no photo before upload");

        // Skill tags now exist for the workspace, exactly once per name.
        JsonNode skills = read(apiGet(owner, ws, "/api/skills")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        var coldCalling = new java.util.ArrayList<JsonNode>();
        skills.forEach(tag -> {
            if (tag.get("name").asText().equalsIgnoreCase("Cold Calling")) {
                coldCalling.add(tag);
            }
        });
        assertEquals(1, coldCalling.size(), "one tag after first use");

        // Second rep reuses the tag case-insensitively — no duplicate vocabulary.
        createRepViaApi(owner, ws,
                "{\"name\":\"Bob Case\",\"skills\":[\"cold   calling\"]}".replace("  ", ""));
        JsonNode skillsAfter = read(apiGet(owner, ws, "/api/skills")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        long duplicates = skillsAfter.findValues("name").stream()
                .filter(n -> n.asText().equalsIgnoreCase("Cold Calling")).count();
        assertEquals(1, duplicates, "case-insensitive tag reuse");

        // Languages endpoint reflects the roster.
        JsonNode languages = read(apiGet(owner, ws, "/api/languages")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        assertTrue(languages.toString().contains("Spanish"));
    }

    // ---------------------------------------------------------- roster filters

    @Test
    void rosterFiltersBySkillLanguageAndAvailability() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Filters Co");

        createRepViaApi(owner, ws, """
                {"name":"Skill Alice","skills":["Enterprise Selling"],
                 "languages":["English"],
                 "availableFrom":"%s"}
                """.formatted(LocalDate.now().minusDays(2)));
        createRepViaApi(owner, ws, """
                {"name":"Skill Bob","skills":["Hardware"],
                 "languages":["French"],
                 "availableFrom":"%s"}
                """.formatted(LocalDate.now().plusDays(45)));

        JsonNode skills = read(apiGet(owner, ws, "/api/skills")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        long enterpriseId = -1;
        for (JsonNode tag : skills) {
            if (tag.get("name").asText().equals("Enterprise Selling")) {
                enterpriseId = tag.get("id").asLong();
            }
        }
        assertTrue(enterpriseId > 0, "skill tag exists");

        // By skill.
        JsonNode bySkill = getReps(owner, ws, "?skillId=" + enterpriseId);
        assertTrue(contains(bySkill, "Skill Alice"));
        assertFalse(contains(bySkill, "Skill Bob"));

        // By language (param is lowercase-matched).
        JsonNode byLanguage = getReps(owner, ws, "?language=english");
        assertTrue(contains(byLanguage, "Skill Alice"));
        assertFalse(contains(byLanguage, "Skill Bob"));

        // By availability: Alice's date has passed, Bob's is 45 days out.
        JsonNode available = getReps(owner, ws, "?available=true");
        assertTrue(contains(available, "Skill Alice"));
        assertFalse(contains(available, "Skill Bob"));
        JsonNode unavailable = getReps(owner, ws, "?available=false");
        assertTrue(contains(unavailable, "Skill Bob"));
        assertFalse(contains(unavailable, "Skill Alice"));

        // CSV export honours the same filters.
        String csv = responseOf(apiGet(owner, ws, "/api/reps/export?skillId=" + enterpriseId)
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        assertTrue(csv.contains("Skill Alice"));
        assertFalse(csv.contains("Skill Bob"));
    }

    // ------------------------------------------------ offer requirements + rank

    @Test
    void suggestedRanksAvailableRepsWithBreakdownAndPlaces() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Match Co");
        long sales = seededVerticalId(ws, "Sales");
        long advertising = seededVerticalId(ws, "Advertising");
        long senior = seniorLevelId(ws);
        long client = repoClient(ws, "Match Client");

        long strongId = createRepViaApi(owner, ws, """
                {"name":"Strong Contender","verticalId":%d,"experienceLevelId":%d,
                 "skills":["Java","Outbound"],"languages":["English"],
                 "timezone":"Europe/Berlin"}
                """.formatted(sales, senior));
        createRepViaApi(owner, ws, """
                {"name":"Weak Contender","verticalId":%d,
                 "skills":["Cooking"],"languages":["French"],
                 "timezone":"Pacific/Auckland",
                 "availableFrom":"%s"}
                """.formatted(advertising, LocalDate.now().plusDays(90)));

        long offerId = createOffer(owner, ws, client, sales, senior);

        // Requirements round-trip on the offer.
        JsonNode offers = read(apiGet(owner, ws, "/api/offers")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        JsonNode offer = offers.get(0);
        assertTrue(offer.get("requiredSkills").toString().contains("Java"));
        assertTrue(offer.get("requiredSkills").toString().contains("Outbound"));
        assertEquals("English", offer.get("requiredLanguage").asText());
        assertEquals(0, offer.get("tzWindowStart").asInt());
        assertEquals(720, offer.get("tzWindowEnd").asInt());
        assertEquals(LocalDate.now().plusDays(7).toString(),
                offer.get("startDate").asText());

        // Ranked suggestions with the per-factor breakdown.
        JsonNode suggested = read(apiGet(owner, ws,
                        "/api/offers/" + offerId + "/suggested")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        assertTrue(suggested.size() >= 2, "both candidates ranked");
        assertEquals("Strong Contender", suggested.get(0).get("repName").asText(),
                "the qualified rep ranks first");
        int previous = 101;
        for (JsonNode row : suggested) {
            int score = row.get("score").asInt();
            assertTrue(score >= 0 && score <= 100, "score in range: " + score);
            assertTrue(score <= previous, "sorted best-first");
            previous = score;
            assertEquals(7, row.get("factors").size(),
                    "every factor explained: " + row.toPrettyString());
            for (JsonNode factor : row.get("factors")) {
                assertTrue(factor.get("label").asText().length() > 0);
                assertTrue(factor.get("detail").asText().length() > 0);
                assertTrue(factor.get("points").asInt() <= factor.get("weight").asInt());
            }
        }
        assertEquals(100, suggested.get(0).get("score").asInt(),
                "100 for the candidate that meets every requirement");
        assertTrue(suggested.get(0).get("score").asInt()
                        > suggested.get(1).get("score").asInt(),
                "qualified rep outscores the unqualified one");

        // Placed reps drop out of the suggestions (they are not available).
        repoPlacement(ws, offerId,
                repIdByName(owner, ws, "Weak Contender"));
        JsonNode afterPlace = read(apiGet(owner, ws,
                        "/api/offers/" + offerId + "/suggested")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        for (JsonNode row : afterPlace) {
            assertFalse(row.get("repName").asText().equals("Weak Contender"),
                    "placed reps are not 'available'");
        }

        // One-click place goes through the normal placement pipeline (201).
        apiPost(owner, ws, "/api/placements",
                        "{\"offerId\":" + offerId + ",\"repId\":" + strongId + "}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated());
        JsonNode afterStrong = read(apiGet(owner, ws,
                        "/api/offers/" + offerId + "/suggested")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        for (JsonNode row : afterStrong) {
            assertFalse(row.get("repName").asText().equals("Strong Contender"));
        }

        // Cross-tenant: another workspace sees 404, never this offer's data.
        Account outsider = register();
        long otherWs = uniqueWorkspace(outsider, "Outsider Co");
        apiGet(outsider, otherWs, "/api/offers/" + offerId + "/suggested")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isNotFound());
        apiPut(outsider, otherWs, "/api/reps/" + strongId, "{\"name\":\"Hijacked\"}")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isNotFound());
    }

    private long createOffer(Account owner, long ws, long client, long vertical,
                             long level) throws Exception {
        var result = apiPost(owner, ws, "/api/offers", """
                {"clientId":%d,"title":"Backend AE","seats":2,"verticalId":%d,
                 "requiredSkills":["Java","Outbound"],"requiredLevelId":%d,
                 "requiredLanguage":"English","tzWindowStart":0,"tzWindowEnd":720,
                 "startDate":"%s"}
                """.formatted(client, vertical, level, LocalDate.now().plusDays(7)))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated())
                .andReturn();
        return read(result).get("id").asLong();
    }

    private long repIdByName(Account actor, long ws, String name) throws Exception {
        JsonNode page = getReps(actor, ws, "");
        for (JsonNode item : page.get("items")) {
            if (item.get("name").asText().equals(name)) {
                return item.get("id").asLong();
            }
        }
        throw new AssertionError("rep not found: " + name);
    }

    // ------------------------------------------------------------ photo upload

    @Test
    void photoUploadValidatesTypeAndSizeAndIsolatesTenants() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Photo Co");
        long repId = repoRep(ws, "Snapface");

        // No photo yet.
        apiGet(owner, ws, "/api/reps/" + repId + "/photo")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isNotFound());

        byte[] png = new byte[]{(byte) 0x89, 'P', 'N', 'G', 0, 1, 2, 3, 4, 5};
        var upload = mockMvc.perform(MockMvcRequestBuilders
                        .multipart("/api/reps/" + repId + "/photo")
                        .file(new MockMultipartFile("file", "avatar.png",
                                "image/png", png))
                        .header("Authorization", bearer(owner))
                        .header("X-Workspace", String.valueOf(ws)))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isCreated())
                .andReturn();
        JsonNode photo = read(upload);
        assertEquals("/api/reps/" + repId + "/photo", photo.get("photoUrl").asText());
        assertEquals("image/png", photo.get("contentType").asText());

        // Round-trip: the GET serves exactly those bytes.
        MvcResult download = mockMvc.perform(MockMvcRequestBuilders
                        .get("/api/reps/" + repId + "/photo")
                        .header("Authorization", bearer(owner))
                        .header("X-Workspace", String.valueOf(ws)))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("Content-Type", "image/png"))
                .andReturn();
        assertEquals(png.length, download.getResponse().getContentAsByteArray().length);

        // Type guard: text/plain rejected with a clear 400.
        apiMultipart(owner, ws, repId, "notes.txt", "text/plain",
                        "just text".getBytes())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isBadRequest())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .jsonPath("$.message").value(
                                org.hamcrest.Matchers.containsString("PNG")));

        // Size guard: 2 MB + 1 byte rejected with a clear 400.
        byte[] oversize = new byte[2 * 1024 * 1024 + 1];
        apiMultipart(owner, ws, repId, "big.png", "image/png", oversize)
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isBadRequest())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .jsonPath("$.message").value(
                                org.hamcrest.Matchers.containsString("2 MB")));

        // Cross-tenant: outsiders get 404, not bytes.
        Account outsider = register();
        long otherWs = uniqueWorkspace(outsider, "Photo Other Co");
        long foreignRep = repoRep(otherWs, "Not Yours");
        apiGet(owner, ws, "/api/reps/" + foreignRep + "/photo")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isNotFound());

        // hasPhoto flips once an upload landed.
        JsonNode page = getReps(owner, ws, "");
        assertTrue(page.get("items").get(0).get("hasPhoto").asBoolean());
    }

    private org.springframework.test.web.servlet.ResultActions apiMultipart(
            Account actor, long ws, long repId, String filename, String contentType,
            byte[] bytes) throws Exception {
        return mockMvc.perform(MockMvcRequestBuilders
                .multipart("/api/reps/" + repId + "/photo")
                .file(new MockMultipartFile("file", filename, contentType, bytes))
                .header("Authorization", bearer(actor))
                .header("X-Workspace", String.valueOf(ws)));
    }

    // ------------------------------------------------------------- role matrix

    @Test
    void phase6EndpointsFollowTheFourRoleMatrix() throws Exception {
        Account owner = register("p6-owner");
        long ws = uniqueWorkspace(owner, "Matrix Co");
        long repId = repoRep(ws, "Matrix Rep Row");
        long client = repoClient(ws, "Matrix Client");
        long offerId = repoOffer(ws, client, "Matrix Offer", 3);

        Account admin = register("p6-admin");
        addMember(ws, admin.userId(), WorkspaceRole.ADMIN);
        Account manager = register("p6-manager");
        addMember(ws, manager.userId(), WorkspaceRole.MANAGER);
        Account rep = register("p6-rep");
        addMember(ws, rep.userId(), WorkspaceRole.REP);

        // Lookup reads are open to every member (all four roles).
        for (Account actor : new Account[]{owner, admin, manager, rep}) {
            apiGet(actor, ws, "/api/skills")
                    .andExpect(status().isOk());
            apiGet(actor, ws, "/api/languages")
                    .andExpect(status().isOk());
        }

        // Suggestions + photo + profile writes are manager+; rep is 403.
        for (Account actor : new Account[]{owner, admin, manager}) {
            apiGet(actor, ws, "/api/offers/" + offerId + "/suggested")
                    .andExpect(status().isOk());
            apiPut(actor, ws, "/api/reps/" + repId,
                            "{\"name\":\"Matrix Renamed\",\"skills\":[\"RoleSkill\"],"
                                    + "\"languages\":[\"English\"],"
                                    + "\"timezone\":\"UTC\",\"hoursPerWeek\":40}")
                    .andExpect(status().isOk());
            apiMultipart(actor, ws, repId, "role.png", "image/png",
                            new byte[]{1, 2, 3, 4})
                    .andExpect(status().isCreated());
            apiGet(actor, ws, "/api/reps/" + repId + "/photo")
                    .andExpect(status().isOk());
            apiMultipart(actor, ws, repId, "role.png", "image/png",
                            new byte[]{5, 6, 7, 8})
                    .andExpect(status().isCreated()); // replace allowed
        }

        apiGet(rep, ws, "/api/offers/" + offerId + "/suggested")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        apiMultipart(rep, ws, repId, "role.png", "image/png", new byte[]{1, 2, 3})
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        apiGet(rep, ws, "/api/reps/" + repId + "/photo")
                .andExpect(status().isForbidden());
        apiPut(rep, ws, "/api/reps/" + repId, "{\"name\":\"Rep Edits Self\"}")
                .andExpect(status().isForbidden());

        // Non-member (no membership anywhere) cannot reach the workspace at all.
        Account stranger = register("p6-stranger");
        apiGet(stranger, ws, "/api/skills")
                .andExpect(status().isForbidden());
    }

    // -------------------------------------------------------------- audit trail

    @Test
    void profileAndTagChangesAreAudited() throws Exception {
        Account owner = register();
        long ws = uniqueWorkspace(owner, "Audit Co");

        createRepViaApi(owner, ws,
                "{\"name\":\"Audited Rep\",\"skills\":[\"Audited Skill\"]}");

        JsonNode feed = read(apiGet(owner, ws, "/api/audit?size=100")
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .status().isOk())
                .andReturn());
        boolean sawTag = false;
        boolean sawRepCreate = false;
        for (JsonNode entry : feed.get("items")) {
            if ("skill_tag".equals(entry.get("entityType").asText())) {
                sawTag = true;
                assertTrue(entry.get("details").asText().contains("Audited Skill"));
            }
            if ("rep".equals(entry.get("entityType").asText())
                    && "CREATE".equals(entry.get("action").asText())) {
                sawRepCreate = true;
            }
        }
        assertTrue(sawTag, "skill tag creation is audited");
        assertTrue(sawRepCreate, "the triggering rep create is audited");
    }
}