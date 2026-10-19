package com.coeso.roster.discord;

/**
 * Workspace -> Discord notification surface. Implementations must never throw
 * to the caller: a broken bot or unreachable guild can never fail the
 * placement / offer / request that triggered the notification (asserted by
 * tests with a throwing stub).
 */
public interface DiscordNotifier {

    /** A rep was placed on an offer. */
    void repPlaced(Long workspaceId, String repName, String offerTitle);

    /** A new offer was opened. */
    void offerOpened(Long workspaceId, String offerTitle, String clientName);

    /** A rep asked to join an offer. */
    void placementRequest(Long workspaceId, String repName, String offerTitle);

    /** Someone asked a member for an intro (smart intros, phase 9). */
    void introRequested(Long workspaceId, String fromName, String toName);

    /** A member accepted an intro request. */
    void introAccepted(Long workspaceId, String fromName, String toName);
}
