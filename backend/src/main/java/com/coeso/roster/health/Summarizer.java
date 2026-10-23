package com.coeso.roster.health;

import java.util.List;

/**
 * Turns gathered digest facts into the body stored in digest_logs and sent
 * to Discord. The seam exists so an LLM-backed implementation can replace
 * the deterministic template without touching {@link DigestService}.
 */
public interface Summarizer {

    /** One person or thing worth naming in a digest line. */
    record Contributor(String name, int score) {
    }

    /** Everything the digest can say about one workspace week. */
    record Facts(
            String workspaceName,
            java.time.LocalDate weekStart,
            int activeMembers,
            int checkinsThisWeek,
            int newMemberCount,
            List<String> newMemberNames,
            List<Contributor> topContributors,
            int openOffers,
            int bookingsLast7d,
            int pendingIntroRequests) {
    }

    String summarize(Facts facts);
}
