package com.coeso.roster.discord;

import java.util.List;

/**
 * The Discord REST surface Roster touches, behind an interface so tests can
 * substitute a stub instead of reaching out to Discord.
 *
 * <p>Three calls: the OAuth2 authorization-code exchange, the current user's
 * profile, and the member's role ids in a guild (needs the bot token, used for
 * workspace role sync).
 */
public interface DiscordApiClient {

    /** {@code null} when the Discord OAuth client is not configured. */
    String authorizeUrl();

    boolean configured();

    /** Exchanges an authorization code for an access token. */
    String exchangeCode(String code);

    /** The logged-in Discord user's profile for {@code accessToken}. */
    DiscordProfile fetchProfile(String accessToken);

    /**
     * The member's role ids in a guild, via the bot token. Empty when the bot
     * token is not configured (role sync then simply makes no changes).
     */
    List<String> memberRoleIds(String guildId, String discordUserId);

    record DiscordProfile(String id, String email, String displayName) {
    }
}
