package com.coeso.roster.match;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Pure, side-effect-free match scoring: an offer's requirements against one
 * candidate rep profile, 0–100, with a transparent per-factor breakdown so the
 * UI can always explain "why this score".
 *
 * <p>Scoring is weighted over seven factors (weights sum to 100):
 *
 * <table border="1">
 *   <tr><th>factor</th><th>weight</th><th>rule</th></tr>
 *   <tr><td>vertical</td><td>20</td><td>offer vertical equals the rep's primary
 *       vertical or one of the rep's preferred verticals; full marks when the
 *       offer sets no vertical</td></tr>
 *   <tr><td>skills</td><td>24</td><td>pro-rated overlap of the offer's required
 *       skills (case-insensitive); full marks when none are required</td></tr>
 *   <tr><td>experience</td><td>16</td><td>rep level rank ≥ required rank: full;
 *       exactly one rank below: half; otherwise zero (rank = workspace level
 *       order, junior→senior as seeded)</td></tr>
 *   <tr><td>language</td><td>8</td><td>required language among the rep's
 *       languages (case-insensitive); full when none required</td></tr>
 *   <tr><td>timezone</td><td>8</td><td>rep's UTC offset at the start date falls
 *       inside the offer's window (may wrap midnight); zero when the rep has no
 *       timezone and the offer sets a window</td></tr>
 *   <tr><td>availability</td><td>16</td><td>available_from ≤ start date (or
 *       unset = immediately available); full when the offer sets no start date</td></tr>
 *   <tr><td>performance</td><td>8</td><td>past performance from Phase 7; no data
 *       yet, so the factor is <em>not applicable</em> and excluded from the
 *       denominator (weight stays 8 for when Phase 7 lands)</td></tr>
 * </table>
 *
 * <p>A factor with no requirement on the offer scores full and says so in its
 * detail — an unset requirement is not a penalty. The final percent is
 * round(100 × points ÷ applicable weight), so every input scores 0–100.
 */
public final class MatchScorer {

    private MatchScorer() {
    }

    public static final int WEIGHT_VERTICAL = 20;
    public static final int WEIGHT_SKILLS = 24;
    public static final int WEIGHT_EXPERIENCE = 16;
    public static final int WEIGHT_LANGUAGE = 8;
    public static final int WEIGHT_TIMEZONE = 8;
    public static final int WEIGHT_AVAILABILITY = 16;
    public static final int WEIGHT_PERFORMANCE = 8;

    /** The offer's requirements; null / empty anywhere means "no requirement". */
    public record OfferNeeds(
            Long verticalId,
            Set<String> requiredSkills,
            Integer requiredLevelRank,
            String requiredLanguage,
            Integer tzWindowStart,
            Integer tzWindowEnd,
            LocalDate startDate) {

        public static OfferNeeds empty() {
            return new OfferNeeds(null, Set.of(), null, null, null, null, null);
        }
    }

    /** One candidate rep. {@code performanceScore} stays null until Phase 7. */
    public record Candidate(
            Long repId,
            Long verticalId,
            Set<Long> preferredVerticalIds,
            Set<String> skills,
            Integer levelRank,
            Set<String> languages,
            Integer utcOffsetMinutes,
            LocalDate availableFrom,
            Double performanceScore) {
    }

    /** One factor's contribution: points earned out of weight, with the why. */
    public record Factor(String key, String label, int weight, int points,
                         boolean applicable, String detail) {
    }

    /** The full result: factor breakdown plus the normalized 0–100 score. */
    public record Score(int points, int maxPoints, int percent, List<Factor> factors) {
    }

    public static Score score(OfferNeeds needs, Candidate candidate) {
        List<Factor> factors = new ArrayList<>();
        factors.add(verticalFactor(needs, candidate));
        factors.add(skillsFactor(needs, candidate));
        factors.add(experienceFactor(needs, candidate));
        factors.add(languageFactor(needs, candidate));
        factors.add(timezoneFactor(needs, candidate));
        factors.add(availabilityFactor(needs, candidate));
        factors.add(performanceFactor(needs, candidate));

        int points = 0;
        int max = 0;
        for (Factor factor : factors) {
            if (factor.applicable()) {
                points += factor.points();
                max += factor.weight();
            }
        }
        int percent = max == 0 ? 100 : (int) Math.round(100.0 * points / max);
        return new Score(points, max, Math.max(0, Math.min(100, percent)), factors);
    }

    private static Factor verticalFactor(OfferNeeds needs, Candidate candidate) {
        if (needs.verticalId() == null) {
            return applicable("vertical", "Vertical", WEIGHT_VERTICAL, WEIGHT_VERTICAL,
                    "Offer sets no vertical");
        }
        boolean primary = needs.verticalId().equals(candidate.verticalId());
        boolean preferred = candidate.preferredVerticalIds() != null
                && candidate.preferredVerticalIds().contains(needs.verticalId());
        if (primary || preferred) {
            return applicable("vertical", "Vertical", WEIGHT_VERTICAL, WEIGHT_VERTICAL,
                    preferred && !primary ? "Matches a preferred vertical"
                            : "Matches the rep's vertical");
        }
        return applicable("vertical", "Vertical", WEIGHT_VERTICAL, 0,
                "Rep works a different vertical");
    }

    private static Factor skillsFactor(OfferNeeds needs, Candidate candidate) {
        Set<String> required = lowercase(needs.requiredSkills());
        if (required.isEmpty()) {
            return applicable("skills", "Skills", WEIGHT_SKILLS, WEIGHT_SKILLS,
                    "Offer requires no skills");
        }
        Set<String> have = lowercase(candidate.skills());
        Set<String> matched = new LinkedHashSet<>(required);
        matched.retainAll(have);
        Set<String> missing = new LinkedHashSet<>(required);
        missing.removeAll(have);
        int points = (int) Math.round(
                (double) WEIGHT_SKILLS * matched.size() / required.size());
        String detail = missing.isEmpty()
                ? "Has all " + required.size() + " required skill(s)"
                : "Missing: " + String.join(", ", missing)
                        + " (" + matched.size() + "/" + required.size() + ")";
        return applicable("skills", "Skills", WEIGHT_SKILLS, points, detail);
    }

    private static Factor experienceFactor(OfferNeeds needs, Candidate candidate) {
        if (needs.requiredLevelRank() == null) {
            return applicable("experience", "Experience", WEIGHT_EXPERIENCE,
                    WEIGHT_EXPERIENCE, "Offer sets no level requirement");
        }
        if (candidate.levelRank() == null) {
            return applicable("experience", "Experience", WEIGHT_EXPERIENCE, 0,
                    "Rep has no experience level set");
        }
        int required = needs.requiredLevelRank();
        int have = candidate.levelRank();
        if (have >= required) {
            return applicable("experience", "Experience", WEIGHT_EXPERIENCE,
                    WEIGHT_EXPERIENCE, "Meets or exceeds the required level");
        }
        if (have == required - 1) {
            return applicable("experience", "Experience", WEIGHT_EXPERIENCE,
                    WEIGHT_EXPERIENCE / 2, "One level below the requirement");
        }
        return applicable("experience", "Experience", WEIGHT_EXPERIENCE, 0,
                "Below the required experience level");
    }

    private static Factor languageFactor(OfferNeeds needs, Candidate candidate) {
        String required = needs.requiredLanguage();
        if (required == null || required.isBlank()) {
            return applicable("language", "Language", WEIGHT_LANGUAGE, WEIGHT_LANGUAGE,
                    "Offer sets no language requirement");
        }
        Set<String> have = lowercase(candidate.languages());
        if (have.contains(required.trim().toLowerCase(Locale.ROOT))) {
            return applicable("language", "Language", WEIGHT_LANGUAGE, WEIGHT_LANGUAGE,
                    "Speaks " + required.trim());
        }
        return applicable("language", "Language", WEIGHT_LANGUAGE, 0,
                "Does not list " + required.trim());
    }

    private static Factor timezoneFactor(OfferNeeds needs, Candidate candidate) {
        if (needs.tzWindowStart() == null || needs.tzWindowEnd() == null) {
            return applicable("timezone", "Timezone", WEIGHT_TIMEZONE, WEIGHT_TIMEZONE,
                    "Offer sets no timezone window");
        }
        if (candidate.utcOffsetMinutes() == null) {
            return applicable("timezone", "Timezone", WEIGHT_TIMEZONE, 0,
                    "Rep has no timezone set");
        }
        int offset = Math.floorMod(candidate.utcOffsetMinutes(), 1440);
        int start = Math.floorMod(needs.tzWindowStart(), 1440);
        int end = Math.floorMod(needs.tzWindowEnd(), 1440);
        boolean inside = start <= end
                ? offset >= start && offset <= end
                : offset >= start || offset <= end; // window wraps midnight
        String window = minutesToHours(start) + "–" + minutesToHours(end);
        return inside
                ? applicable("timezone", "Timezone", WEIGHT_TIMEZONE, WEIGHT_TIMEZONE,
                        "Works " + window + " UTC")
                : applicable("timezone", "Timezone", WEIGHT_TIMEZONE, 0,
                        "Outside the " + window + " UTC window (UTC"
                                + (candidate.utcOffsetMinutes() >= 0 ? "+" : "")
                                + minutesToHours(candidate.utcOffsetMinutes()) + ")");
    }

    private static Factor availabilityFactor(OfferNeeds needs, Candidate candidate) {
        if (needs.startDate() == null) {
            return applicable("availability", "Availability", WEIGHT_AVAILABILITY,
                    WEIGHT_AVAILABILITY, "Offer sets no start date");
        }
        if (candidate.availableFrom() == null
                || !candidate.availableFrom().isAfter(needs.startDate())) {
            return applicable("availability", "Availability", WEIGHT_AVAILABILITY,
                    WEIGHT_AVAILABILITY,
                    candidate.availableFrom() == null
                            ? "Available immediately"
                            : "Free by " + candidate.availableFrom());
        }
        return applicable("availability", "Availability", WEIGHT_AVAILABILITY, 0,
                "Only free from " + candidate.availableFrom());
    }

    private static Factor performanceFactor(OfferNeeds needs, Candidate candidate) {
        // Phase 7 will feed past performance; until then the factor has no data
        // and is excluded from both sides of the ratio (weight reserved).
        if (candidate.performanceScore() == null) {
            return new Factor("performance", "Performance", WEIGHT_PERFORMANCE, 0,
                    false, "No performance data yet (Phase 7)");
        }
        double clamped = Math.max(0, Math.min(100, candidate.performanceScore()));
        int points = (int) Math.round(WEIGHT_PERFORMANCE * clamped / 100.0);
        boolean tierA = clamped >= 90;
        return applicable("performance", "Performance", WEIGHT_PERFORMANCE, points,
                (tierA ? "Top-tier" : "Tracked") + " past performance ("
                        + Math.round(clamped) + "/100)");
    }

    private static Factor applicable(String key, String label, int weight, int points,
                                     String detail) {
        return new Factor(key, label, weight, Math.max(0, Math.min(weight, points)),
                true, detail);
    }

    private static Set<String> lowercase(Set<String> values) {
        Set<String> result = new LinkedHashSet<>();
        if (values != null) {
            for (String value : values) {
                if (value != null && !value.isBlank()) {
                    result.add(value.trim().toLowerCase(Locale.ROOT));
                }
            }
        }
        return result;
    }

    /** HH:MM in UTC for a minute-of-day offset from UTC. */
    private static String minutesToHours(int minutes) {
        int normalized = Math.floorMod(minutes, 1440);
        return String.format("%02d:%02d", normalized / 60, normalized % 60);
    }
}