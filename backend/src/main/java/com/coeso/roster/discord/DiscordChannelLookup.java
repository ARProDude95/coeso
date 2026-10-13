package com.coeso.roster.discord;

import com.coeso.roster.repo.Repositories.WorkspaceDiscordRepository;
import org.springframework.stereotype.Component;

/**
 * Resolves a workspace's configured notification channel id. Split out of the
 * notifier so the JDA bot (which must not touch the tenant filter on request
 * threads) and tests share one lookup path.
 */
@Component
public class DiscordChannelLookup {

    private final WorkspaceDiscordRepository workspaceDiscord;

    public DiscordChannelLookup(WorkspaceDiscordRepository workspaceDiscord) {
        this.workspaceDiscord = workspaceDiscord;
    }

    /** Channel id, or null when the workspace has no Discord connection. */
    public String notificationChannelId(Long workspaceId) {
        return workspaceDiscord.findByWorkspaceId(workspaceId)
                .map(connection -> connection.getNotificationChannelId())
                .orElse(null);
    }
}
