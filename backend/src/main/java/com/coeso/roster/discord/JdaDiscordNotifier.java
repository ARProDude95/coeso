package com.coeso.roster.discord;

import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.entities.channel.concrete.TextChannel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Component;

/**
 * JDA-based notifier. JDA runs inside this JVM (one line of justification:
 * no separate Node service to deploy, monitor or scale — the bot shares the
 * backend's lifecycle and config). The gateway connection is built lazily on
 * the first notification and only when a bot token is configured; messages go
 * to the workspace's configured notification channel. Every failure is logged
 * and swallowed — the primary request never sees it.
 */
@Component
@ConditionalOnExpression("'${app.discord.bot-token:}' != ''")
public class JdaDiscordNotifier implements DiscordNotifier {

    private static final Logger log = LoggerFactory.getLogger(JdaDiscordNotifier.class);

    private final String botToken;
    private final DiscordChannelLookup channelLookup;
    private volatile JDA jda;

    public JdaDiscordNotifier(
            @org.springframework.beans.factory.annotation.Value("${app.discord.bot-token:}")
            String botToken,
            DiscordChannelLookup channelLookup) {
        this.botToken = botToken;
        this.channelLookup = channelLookup;
    }

    @Override
    public void repPlaced(Long workspaceId, String repName, String offerTitle) {
        send(workspaceId, "📌 **" + repName + "** was placed on *" + offerTitle + "*");
    }

    @Override
    public void offerOpened(Long workspaceId, String offerTitle, String clientName) {
        send(workspaceId, "🟢 New offer: *" + offerTitle + "*"
                + (clientName == null || clientName.isBlank() ? "" : " for " + clientName));
    }

    @Override
    public void placementRequest(Long workspaceId, String repName, String offerTitle) {
        send(workspaceId, "📨 **" + repName + "** asked to join *" + offerTitle + "*");
    }

    @Override
    public void introRequested(Long workspaceId, String fromName, String toName) {
        send(workspaceId, "🤝 **" + fromName + "** asked **" + toName
                + "** for an intro — respond on the intros page");
    }

    @Override
    public void introAccepted(Long workspaceId, String fromName, String toName) {
        send(workspaceId, "👋 **" + toName + "** accepted an intro with **"
                + fromName + "*");
    }

    private void send(Long workspaceId, String message) {
        try {
            JDA instance = jda();
            if (instance == null) {
                return;
            }
            String channelId = channelLookup.notificationChannelId(workspaceId);
            if (channelId == null || channelId.isBlank()) {
                return;
            }
            TextChannel channel = instance.getTextChannelById(channelId);
            if (channel == null) {
                log.warn("Discord notification channel {} not found for workspace {}",
                        channelId, workspaceId);
                return;
            }
            channel.sendMessage(message).queue(
                    null,
                    error -> log.warn("Discord notification failed for workspace {}: {}",
                            workspaceId, error.getMessage()));
        } catch (RuntimeException e) {
            log.warn("Discord notification failed for workspace {}: {}", workspaceId, e.toString());
        }
    }

    /** Builds the gateway connection once, on first use. */
    private JDA jda() {
        JDA local = jda;
        if (local == null) {
            synchronized (this) {
                if (jda == null) {
                    try {
                        jda = JDABuilder.createDefault(botToken).build();
                    } catch (RuntimeException e) {
                        log.warn("Could not start the Discord bot: {}", e.toString());
                        return null;
                    }
                }
                local = jda;
            }
        }
        return local;
    }
}
