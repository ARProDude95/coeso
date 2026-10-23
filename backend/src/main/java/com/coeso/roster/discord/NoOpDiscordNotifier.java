package com.coeso.roster.discord;

import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Component;

/**
 * Default notifier when no bot token is configured: notifications are dropped.
 * Exactly one of this and {@link JdaDiscordNotifier} is registered, chosen by
 * the presence of {@code app.discord.bot-token}.
 */
@Component
@ConditionalOnExpression("'${app.discord.bot-token:}' == ''")
public class NoOpDiscordNotifier implements DiscordNotifier {

    @Override
    public void repPlaced(Long workspaceId, String repName, String offerTitle) {
        // no bot configured: nothing to do
    }

    @Override
    public void offerOpened(Long workspaceId, String offerTitle, String clientName) {
        // no bot configured: nothing to do
    }

    @Override
    public void placementRequest(Long workspaceId, String repName, String offerTitle) {
        // no bot configured: nothing to do
    }

    @Override
    public void introRequested(Long workspaceId, String fromName, String toName) {
        // no bot configured: nothing to do
    }

    @Override
    public void introAccepted(Long workspaceId, String fromName, String toName) {
        // no bot configured: nothing to do
    }

    @Override
    public void weeklyDigest(Long workspaceId, String body) {
        // no bot configured: nothing to do (digest_logs keeps the record)
    }

    @Override
    public void engagementNudge(Long workspaceId, String memberName, String reason) {
        // no bot configured: nothing to do
    }
}
