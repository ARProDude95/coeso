package com.coeso.roster.discord;

/** Thrown when "Login with Discord" is called but the OAuth client is not configured. */
public class DiscordUnavailableException extends RuntimeException {

    public DiscordUnavailableException(String message) {
        super(message);
    }
}
