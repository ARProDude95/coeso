package com.coeso.roster.intros;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Pure scorer for member-to-member intro suggestions inside one workspace.
 * Rule of the house scorers: it reasons on points with a readable factor
 * breakdown so the UI can explain "why this suggestion".
 *
 * <p>Two members are suggested to each other when one's "looking for" list
 * overlaps the other's "offering" list (either direction), and a shared
 * industry adds weight. Any overlap is required: no-shared-tags profiles
 * never surface, so suggestions are always "why explained".
 */
public final class IntrosScorer {

    /** The two profile halves this scorer reads. */
    public record ProfileView(Long userId, String offeringTagsJson,
                              String lookingForTagsJson, String industry) {
    }

    public record Reason(String headline, List<String> matchedTags) {
    }

    private IntrosScorer() {
    }

    /**
     * Scores A ↷ B: how well B's offerings cover A's asks (and vice versa).
     * Points: 30 per matched pair direction-element, capped; +20 shared
     * industry. Max = 60 (three distinct matched tags) + 20 = 80 raw →
     * normalized to a 0-100 percent.
     */
    public static Result score(ProfileView a, ProfileView b) {
        Set<String> aOffer = tags(a.offeringTagsJson());
        Set<String> aLook = tags(a.lookingForTagsJson());
        Set<String> bOffer = tags(b.offeringTagsJson());
        Set<String> bLook = tags(b.lookingForTagsJson());

        Set<String> matched = new LinkedHashSet<>();
        matched.addAll(intersect(aOffer, bLook));
        matched.addAll(intersect(bOffer, aLook));
        if (matched.isEmpty()) {
            return null; // nothing connects these two profiles
        }

        List<String> matchedList = new ArrayList<>(matched);
        int points = Math.min(matchedList.size(), 3) * 30;
        boolean sameIndustry = a.industry() != null && b.industry() != null
                && a.industry().trim().equalsIgnoreCase(b.industry().trim());
        if (sameIndustry) {
            points += 20;
        }
        int percent = Math.min(100, Math.round(points * 100f / 80f));
        return new Result(percent, matchedList, sameIndustry);
    }

    public record Result(int percent, List<String> matchedTags, boolean sameIndustry) {

        /** The one-line reason the intros page shows. */
        public String reason() {
            StringBuilder sb = new StringBuilder();
            sb.append("Matches on: ").append(String.join(", ", matchedTags));
            if (sameIndustry) {
                sb.append(" · same industry");
            }
            return sb.toString();
        }
    }

    /** Parses the stored JSON array; never throws, empty on anything unreadable. */
    static Set<String> tags(String json) {
        Set<String> out = new LinkedHashSet<>();
        if (json == null || json.isBlank()) {
            return out;
        }
        try {
            JsonNode node = new ObjectMapper().readTree(json);
            if (node.isArray()) {
                node.forEach(n -> {
                    String raw = n.asText("");
                    String tag = raw.trim().toLowerCase(Locale.ROOT);
                    if (!tag.isEmpty() && tag.length() <= 40) {
                        out.add(tag);
                    }
                });
            }
        } catch (Exception ignored) {
            return out;
        }
        return out;
    }

    private static Set<String> intersect(Set<String> a, Set<String> b) {
        Set<String> out = new LinkedHashSet<>(a);
        out.retainAll(b);
        return out;
    }
}
