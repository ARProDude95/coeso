package com.coeso.roster.health;

import java.util.List;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Deterministic, template-based digest renderer. Plain text only — it is
 * stored in {@code digest_logs.body} and pasted into Discord as-is, so it must
 * stay readable without markdown rendering and well under Discord's message
 * limit.
 */
@Component
public class TemplateSummarizer implements Summarizer {

    /** New members and contributors named per line (the rest become "+N"). */
    private static final int MAX_NEW_NAMES = 8;
    private static final int MAX_CONTRIBUTORS = 5;

    @Override
    public String summarize(Facts facts) {
        // TODO: plug an LLM in here — swap this template for a prompt over the
        // same Facts (interface seam exists exactly for that); keep the output
        // plain text and the failure mode "fall back to this template".
        StringBuilder out = new StringBuilder();
        out.append("Weekly digest — ").append(facts.workspaceName()).append('\n');
        out.append("Week of ").append(facts.weekStart()).append('\n');
        out.append("Activity: ").append(plural(facts.activeMembers(), "active member"))
                .append(" · ").append(plural(facts.checkinsThisWeek(), "pod check-in"))
                .append('\n');
        out.append("New members: ").append(names(facts.newMemberNames())).append('\n');
        out.append("Top contributors: ").append(contributors(facts.topContributors())).append('\n');
        out.append("Pipeline: ")
                .append(plural(facts.openOffers(), "open offer"))
                .append(" · ").append(plural(facts.bookingsLast7d(), "booking")).append(" (last 7d)")
                .append(" · ").append(plural(facts.pendingIntroRequests(), "pending intro request"))
                .append('\n');
        return out.toString();
    }

    /** "3 active members" / "1 active member" / "0 active members". */
    private String plural(int count, String singular) {
        if (count == 1) {
            return "1 " + singular;
        }
        return count + " " + singular + "s";
    }

    private String names(List<String> names) {
        if (names.isEmpty()) {
            return "none yet";
        }
        if (names.size() <= MAX_NEW_NAMES) {
            return String.join(", ", names);
        }
        return String.join(", ", names.subList(0, MAX_NEW_NAMES))
                + ", +" + (names.size() - MAX_NEW_NAMES);
    }

    private String contributors(List<Contributor> contributors) {
        if (contributors.isEmpty()) {
            return "none yet";
        }
        return contributors.stream()
                .limit(MAX_CONTRIBUTORS)
                .map(c -> c.name() + " (" + c.score() + ")")
                .collect(Collectors.joining(", "));
    }
}
