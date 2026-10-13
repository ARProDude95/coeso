package com.coeso.roster.discord;

import com.coeso.roster.auth.AuthService;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Discord OAuth endpoints (unauthenticated):
 * <ul>
 *   <li>{@code GET /api/auth/discord/url} — the authorization URL to redirect
 *       the browser to (503 when Discord is not configured),</li>
 *   <li>{@code POST /api/auth/discord} — exchanges the returned code for a
 *       Roster JWT, linking or creating the user account.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/auth/discord")
public class DiscordController {

    private final DiscordApiClient discordApi;
    private final DiscordLoginService discordLoginService;

    public DiscordController(DiscordApiClient discordApi,
                             DiscordLoginService discordLoginService) {
        this.discordApi = discordApi;
        this.discordLoginService = discordLoginService;
    }

    @GetMapping("/url")
    public Map<String, String> url() {
        String url = discordApi.authorizeUrl();
        if (url == null) {
            throw new DiscordUnavailableException(
                    "Discord login is not configured; set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET");
        }
        return Map.of("url", url);
    }

    @PostMapping
    public AuthService.AuthResponse login(@Valid @RequestBody DiscordLoginService.LoginRequest request) {
        return discordLoginService.login(request);
    }
}
