package com.coeso.roster.discord;

import com.coeso.roster.common.UnauthorizedException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

/**
 * Real Discord REST calls ({@code https://discord.com/api}). All three methods
 * are best-effort against Discord's public endpoints; OAuth errors surface as
 * 401 (bad/expired code), while a missing bot token just yields no role ids.
 */
@Component
public class HttpDiscordApiClient implements DiscordApiClient {

    private static final Logger log = LoggerFactory.getLogger(HttpDiscordApiClient.class);

    private final String clientId;
    private final String clientSecret;
    private final String redirectUri;
    private final String botToken;
    private final String apiBase;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public HttpDiscordApiClient(
            @Value("${app.discord.client-id:}") String clientId,
            @Value("${app.discord.client-secret:}") String clientSecret,
            @Value("${app.discord.redirect-uri:}") String redirectUri,
            @Value("${app.discord.bot-token:}") String botToken,
            @Value("${app.discord.api-base:https://discord.com/api}") String apiBase,
            ObjectMapper objectMapper) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
        this.botToken = botToken;
        this.apiBase = apiBase;
        this.objectMapper = objectMapper;
        this.restClient = RestClient.builder().baseUrl(apiBase).build();
    }

    @Override
    public boolean configured() {
        return !clientId.isBlank() && !clientSecret.isBlank();
    }

    @Override
    public String authorizeUrl() {
        if (!configured()) {
            return null;
        }
        return "https://discord.com/oauth2/authorize"
                + "?client_id=" + url(clientId)
                + "&response_type=code"
                + "&scope=identify%20email"
                + "&redirect_uri=" + url(redirectUri);
    }

    @Override
    public String exchangeCode(String code) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret);
        form.add("grant_type", "authorization_code");
        form.add("code", code);
        form.add("redirect_uri", redirectUri);
        try {
            String body = restClient.post()
                    .uri("/oauth2/token")
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class);
            JsonNode node = objectMapper.readTree(body);
            String token = node.path("access_token").asText("");
            if (token.isEmpty()) {
                throw new UnauthorizedException("Discord did not return an access token");
            }
            return token;
        } catch (UnauthorizedException e) {
            throw e;
        } catch (Exception e) {
            log.debug("Discord token exchange failed: {}", e.toString());
            throw new UnauthorizedException("Discord authorization code is invalid or expired");
        }
    }

    @Override
    public DiscordProfile fetchProfile(String accessToken) {
        try {
            String body = restClient.get()
                    .uri("/users/@me")
                    .header("Authorization", "Bearer " + accessToken)
                    .retrieve()
                    .body(String.class);
            JsonNode node = objectMapper.readTree(body);
            String id = node.path("id").asText("");
            String email = node.path("email").asText("");
            String name = node.hasNonNull("global_name") && !node.get("global_name").isNull()
                    ? node.get("global_name").asText()
                    : node.path("username").asText("");
            if (id.isEmpty()) {
                throw new UnauthorizedException("Discord profile is missing an id");
            }
            if (email.isEmpty()) {
                throw new UnauthorizedException(
                        "Discord did not return an email; the email scope is required");
            }
            return new DiscordProfile(id, email.toLowerCase(), name);
        } catch (UnauthorizedException e) {
            throw e;
        } catch (Exception e) {
            log.debug("Discord profile fetch failed: {}", e.toString());
            throw new UnauthorizedException("Could not fetch the Discord profile");
        }
    }

    @Override
    public List<String> memberRoleIds(String guildId, String discordUserId) {
        if (botToken.isBlank()) {
            return List.of();
        }
        try {
            String body = restClient.get()
                    .uri("/guilds/{guild}/members/{user}", guildId, discordUserId)
                    .header("Authorization", "Bot " + botToken)
                    .retrieve()
                    .body(String.class);
            JsonNode roles = objectMapper.readTree(body).path("roles");
            if (!roles.isArray()) {
                return List.of();
            }
            return objectMapper.convertValue(roles,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (Exception e) {
            // 404 = the member is not in the guild; any failure means "no
            // mapped roles", which simply leaves the membership unchanged.
            log.debug("Discord member role fetch failed for guild {}: {}", guildId, e.toString());
            return List.of();
        }
    }

    private static String url(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }

    /** Exposed for the settings endpoint's "connected" echo. */
    public Map<String, Object> describe() {
        return Map.of("configured", configured(), "botTokenConfigured", !botToken.isBlank());
    }
}
