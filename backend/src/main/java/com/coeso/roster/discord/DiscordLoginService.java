package com.coeso.roster.discord;

import com.coeso.roster.auth.AuthService;
import com.coeso.roster.auth.JwtTokenProvider;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.UnauthorizedException;
import com.coeso.roster.discord.DiscordApiClient.DiscordProfile;
import com.coeso.roster.entity.User;
import com.coeso.roster.repo.Repositories.UserRepository;
import jakarta.validation.constraints.NotBlank;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * "Login with Discord": exchanges the OAuth code, then links the Discord
 * account to an existing user when the emails match, or creates a new user
 * (no password) otherwise. Finally the member's workspace roles are synced
 * from their Discord guild roles (see {@link DiscordRoleSyncService}).
 */
@Service
public class DiscordLoginService {

    public record LoginRequest(@NotBlank String code) {
    }

    private static final Logger log = LoggerFactory.getLogger(DiscordLoginService.class);

    private final DiscordApiClient discordApi;
    private final DiscordRoleSyncService roleSyncService;
    private final UserRepository users;
    private final JwtTokenProvider jwtTokenProvider;

    public DiscordLoginService(DiscordApiClient discordApi,
                               DiscordRoleSyncService roleSyncService,
                               UserRepository users,
                               JwtTokenProvider jwtTokenProvider) {
        this.discordApi = discordApi;
        this.roleSyncService = roleSyncService;
        this.users = users;
        this.jwtTokenProvider = jwtTokenProvider;
    }

    public AuthService.AuthResponse login(LoginRequest request) {
        if (!discordApi.configured()) {
            throw new DiscordUnavailableException(
                    "Discord login is not configured; set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET");
        }
        String accessToken = discordApi.exchangeCode(request.code());
        DiscordProfile profile = discordApi.fetchProfile(accessToken);

        User user = users.findByDiscordId(profile.id()).orElse(null);
        if (user == null) {
            user = users.findByEmail(normalizeEmail(profile.email())).orElse(null);
            if (user != null) {
                if (user.getDiscordId() != null && !user.getDiscordId().equals(profile.id())) {
                    // Same email on Discord but another Discord account is
                    // already linked: refuse rather than silently re-link.
                    throw new ConflictException(
                            "This email is already linked to a different Discord account");
                }
                user.setDiscordId(profile.id());
                users.save(user);
            }
        }
        if (user == null) {
            user = new User();
            user.setEmail(normalizeEmail(profile.email()));
            user.setDisplayName(profile.displayName() == null || profile.displayName().isBlank()
                    ? profile.email()
                    : profile.displayName());
            user.setDiscordId(profile.id());
            users.save(user);
            log.info("Created user {} through Login with Discord", user.getId());
        }

        // Best-effort guild role sync; failures never block the login itself.
        try {
            roleSyncService.syncRoles(user);
        } catch (RuntimeException e) {
            log.warn("Discord role sync failed during login: {}", e.toString());
        }

        return new AuthService.AuthResponse(jwtTokenProvider.createToken(user.getId()),
                new AuthService.UserResponse(user.getId(), user.getEmail(), user.getDisplayName()));
    }

    private static String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}
