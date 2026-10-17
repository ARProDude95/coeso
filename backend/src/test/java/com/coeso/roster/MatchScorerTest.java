package com.coeso.roster;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.coeso.roster.match.MatchScorer;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Phase 6 — the match score is a pure unit: transparent weighted rules,
 * a per-factor breakdown, 0–100 for every input.
 *
 * <p>Weights: vertical 20, skills 24, experience 16, language 8, timezone 8,
 * availability 16, performance 8 (no data until Phase 7 → excluded from both
 * sides of the ratio, so an ordinary candidate maxes at 92/92 = 100).
 */
class MatchScorerTest {

    /** Fully-qualified ideal candidate; each test degrades one dimension. */
    private MatchScorer.Candidate perfectCandidate() {
        return new MatchScorer.Candidate(
                7L,
                1L,                                  // vertical of the offer
                Set.of(),                            // preferred verticals
                Set.of("Java", "Cold Calling"),      // required skills
                2,                                   // >= required rank
                Set.of("English", "German"),
                60,                                  // UTC+1
                LocalDate.of(2026, 1, 1),
                null);                               // performance: no data yet
    }

    private MatchScorer.OfferNeeds fullNeeds() {
        return new MatchScorer.OfferNeeds(
                1L,
                Set.of("Java", "Cold Calling"),
                1,
                "English",
                0, 720,                              // 00:00–12:00 UTC
                LocalDate.of(2026, 2, 1));
    }

    private MatchScorer.Factor factor(MatchScorer.Score score, String key) {
        return score.factors().stream()
                .filter(f -> f.key().equals(key))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no factor " + key));
    }

    @Test
    void perfectMatchScores100WithEveryFactorFull() {
        MatchScorer.Score score = MatchScorer.score(fullNeeds(), perfectCandidate());

        assertEquals(100, score.percent());
        assertEquals(score.points(), score.maxPoints());
        assertEquals(92, score.maxPoints(), // performance excluded until Phase 7
                "applicable weights are 20+24+16+8+8+16 = 92");
        for (MatchScorer.Factor factor : score.factors()) {
            if (factor.applicable()) {
                assertEquals(factor.weight(), factor.points(),
                        factor.key() + " should be full on a perfect match");
            } else {
                assertEquals("performance", factor.key(),
                        "no data until Phase 7 → the only inapplicable factor");
            }
        }
    }

    @Test
    void noRequirementsAtAllStillScores100AndSaysWhy() {
        MatchScorer.Candidate bare = new MatchScorer.Candidate(
                1L, null, Set.of(), Set.of(), null, Set.of(), null, null, null);
        MatchScorer.Score score = MatchScorer.score(MatchScorer.OfferNeeds.empty(), bare);

        assertEquals(100, score.percent());
        assertTrue(factor(score, "skills").detail().contains("requires no skills"));
        assertTrue(factor(score, "vertical").detail().contains("no vertical"));
        assertTrue(factor(score, "timezone").detail().contains("no timezone"));
        assertTrue(factor(score, "availability").detail().contains("no start date"));
    }

    @Test
    void skillsOverlapIsProratedAndExplainsWhatIsMissing() {
        var needs = new MatchScorer.OfferNeeds(
                1L, Set.of("a", "b", "c", "d"), null, null, null, null, null);
        var partial = new MatchScorer.Candidate(
                1L, 1L, Set.of(), Set.of("A", "b"), null, Set.of(), null, null, null);

        MatchScorer.Score score = MatchScorer.score(needs, partial);

        MatchScorer.Factor skills = factor(score, "skills");
        assertEquals(12, skills.points(), "half of the required skills = 12/24");
        assertTrue(skills.detail().contains("c"), "missing skills are listed");
        assertTrue(skills.detail().contains("2/4"));
        // vertical full (1) + skills 12 + experience full + language full
        // + timezone full + availability full = 80/92 → 87%.
        assertEquals(80, score.points());
        assertEquals(92, score.maxPoints());
        assertEquals(87, score.percent());
    }

    @Test
    void experienceOneLevelBelowPaysHalfAndLowerPaysNothing() {
        MatchScorer.Score at = MatchScorer.score(
                new MatchScorer.OfferNeeds(null, Set.of(), 2, null, null, null, null),
                new MatchScorer.Candidate(1L, null, Set.of(), Set.of(), 2, Set.of(),
                        null, null, null));
        assertEquals(16, factor(at, "experience").points());

        MatchScorer.Score justBelow = MatchScorer.score(
                new MatchScorer.OfferNeeds(null, Set.of(), 2, null, null, null, null),
                new MatchScorer.Candidate(1L, null, Set.of(), Set.of(), 1, Set.of(),
                        null, null, null));
        assertEquals(8, factor(justBelow, "experience").points());

        MatchScorer.Score wayBelow = MatchScorer.score(
                new MatchScorer.OfferNeeds(null, Set.of(), 2, null, null, null, null),
                new MatchScorer.Candidate(1L, null, Set.of(), Set.of(), 0, Set.of(),
                        null, null, null));
        assertEquals(0, factor(wayBelow, "experience").points());

        MatchScorer.Score unsetRep = MatchScorer.score(
                new MatchScorer.OfferNeeds(null, Set.of(), 0, null, null, null, null),
                new MatchScorer.Candidate(1L, null, Set.of(), Set.of(), null, Set.of(),
                        null, null, null));
        assertEquals(0, factor(unsetRep, "experience").points(),
                "no level set cannot satisfy a level requirement");
    }

    @Test
    void languageMatchesCaseInsensitively() {
        var needs = new MatchScorer.OfferNeeds(
                null, Set.of(), null, "English", null, null, null);
        var cand = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of("english"), null, null, null);
        assertEquals(8, factor(MatchScorer.score(needs, cand), "language").points());

        var nope = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of("French"), null, null, null);
        assertEquals(0, factor(MatchScorer.score(needs, nope), "language").points());
    }

    @Test
    void timezoneWindowInsideScoresFullOutsideZeroAndWrapsMidnight() {
        var needs = new MatchScorer.OfferNeeds(
                null, Set.of(), null, null, 1320, 120, null); // 22:00–02:00 UTC

        var insideEarly = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), 60, null, null);             // 01:00 UTC
        var insideLate = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), 1500 - 1440 + 60 /*wraps check set*/, null, null);
        var outside = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), 720, null, null);            // 12:00 UTC
        var unknown = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), null, null, null);

        assertEquals(8, factor(MatchScorer.score(needs, insideEarly), "timezone").points());
        assertEquals(8, factor(MatchScorer.score(needs, insideLate), "timezone").points(),
                "1500-1440+60 = 120 is the window end, still inside");
        assertEquals(0, factor(MatchScorer.score(needs, outside), "timezone").points());
        assertEquals(0, factor(MatchScorer.score(needs, unknown), "timezone").points(),
                "rep without a timezone cannot satisfy a window");
    }

    @Test
    void plainWindowTreatsNegativeOffsetsCorrectly() {
        var needs = new MatchScorer.OfferNeeds(
                null, Set.of(), null, null, 480, 1020, null); // 08:00–17:00 UTC
        var newYork = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), -300, null, null);            // UTC-5 → 19:00 UTC prev day…
        // -300 floorMod 1440 = 1140 (19:00 UTC) → outside 08:00–17:00.
        assertEquals(0, factor(MatchScorer.score(needs, newYork), "timezone").points());

        var berlin = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), 120, null, null);             // 02:00 UTC → outside too
        assertEquals(0, factor(MatchScorer.score(needs, berlin), "timezone").points());

        var utc = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), 480, null, null);             // 08:00 UTC → inside
        assertEquals(8, factor(MatchScorer.score(needs, utc), "timezone").points());
    }

    @Test
    void availabilityMustCoverTheStartDate() {
        var needs = new MatchScorer.OfferNeeds(
                null, Set.of(), null, null, null, null, LocalDate.of(2026, 3, 1));

        var free = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), null, LocalDate.of(2026, 2, 1), null);
        var oneDayLate = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), null, LocalDate.of(2026, 3, 2), null);
        var immediate = new MatchScorer.Candidate(1L, null, Set.of(), Set.of(),
                null, Set.of(), null, null, null);

        assertEquals(16, factor(MatchScorer.score(needs, free), "availability").points());
        assertEquals(0, factor(MatchScorer.score(needs, oneDayLate), "availability").points());
        assertEquals(16, factor(MatchScorer.score(needs, immediate), "availability").points());
    }

    @Test
    void performanceIsExcludedUntilPhase7SuppliesData() {
        MatchScorer.Score without = MatchScorer.score(fullNeeds(), perfectCandidate());
        MatchScorer.Factor perf = factor(without, "performance");
        assertFalse(perf.applicable(), "no data yet → factor not applicable");
        assertEquals(92, without.maxPoints(), "its 8 points leave the ratio");

        var withData = new MatchScorer.Candidate(
                7L, 1L, Set.of(), Set.of("Java", "Cold Calling"), 2,
                Set.of("English"), 60, LocalDate.of(2026, 1, 1), 50.0);
        MatchScorer.Score scored = MatchScorer.score(fullNeeds(), withData);
        MatchScorer.Factor applicable = factor(scored, "performance");
        assertTrue(applicable.applicable());
        assertEquals(4, applicable.points(), "half credit at 50/100");
        assertEquals(100, scored.maxPoints(), "50% + 8 weighted in");
        assertEquals(96, scored.percent());   // 92/100 (95 full −4… 91 = 95-… see below)
    }

    @Test
    void preferredVerticalsCountAsAVerticalMatch() {
        var needs = new MatchScorer.OfferNeeds(
                9L, Set.of(), null, null, null, null, null);
        var pref = new MatchScorer.Candidate(1L, 3L, Set.of(9L), Set.of(),
                null, Set.of(), null, null, null);
        var nope = new MatchScorer.Candidate(1L, 3L, Set.of(4L), Set.of(),
                null, Set.of(), null, null, null);

        assertEquals(20, factor(MatchScorer.score(needs, pref), "vertical").points());
        assertEquals(0, factor(MatchScorer.score(needs, nope), "vertical").points());
    }

    @Test
    void breakdownHasSevenUniqueFactorsWithLabelsAndDetails() {
        MatchScorer.Score score = MatchScorer.score(fullNeeds(), perfectCandidate());
        assertEquals(7, score.factors().size());
        List<String> keys = score.factors().stream().map(MatchScorer.Factor::key).toList();
        assertEquals(keys.size(), Set.copyOf(keys).size(), "factor keys are unique");
        Set<String> expected = Set.of("vertical", "skills", "experience", "language",
                "timezone", "availability", "performance");
        assertEquals(expected, Set.copyOf(keys));
        for (MatchScorer.Factor factor : score.factors()) {
            assertFalse(factor.label().isBlank(), "label present for the UI");
            assertFalse(factor.detail().isBlank(), "why present for the UI");
            assertTrue(factor.points() >= 0 && factor.points() <= factor.weight());
        }
    }

    @Test
    void everyScoreStaysWithinZeroToOneHundred() {
        Integer[] offsets = {null, -720, -60, 0, 60, 1439};
        Double[] performances = {null, 0.0, 49.9, 100.0};
        for (int i = 0; i < offsets.length; i++) {
            for (Double perf : performances) {
                var cand = new MatchScorer.Candidate(
                        (long) i, (long) (i % 2), Set.of((long) (i + 3)),
                        i % 2 == 0 ? Set.of() : Set.of("java"),
                        i % 3 == 0 ? null : i,
                        Set.of(), offsets[i], LocalDate.of(2026, 1, 1 + i), perf);
                MatchScorer.Score score = MatchScorer.score(fullNeeds(), cand);
                assertTrue(score.percent() >= 0 && score.percent() <= 100,
                        "score out of range: " + score.percent());
            }
        }
    }

    @Test
    void aBetterCandidateOutranksAWeakerOne() {
        MatchScorer.Score best = MatchScorer.score(fullNeeds(), perfectCandidate());
        var weaker = new MatchScorer.Candidate(
                8L, 2L, Set.of(), Set.of("Unrelated"), 0, Set.of("French"),
                900, LocalDate.of(2026, 12, 31), null);
        MatchScorer.Score worst = MatchScorer.score(fullNeeds(), weaker);

        assertTrue(best.percent() > worst.percent(),
                best.percent() + " should beat " + worst.percent());
        assertEquals(0, factor(worst, "timezone").points(),
                "UTC+15:00 is outside 00:00–12:00");
        assertEquals(8, factor(worst, "experience").points(),
                "one level below always pays half");
        assertEquals(9, worst.percent(), "only that half experience credit survives (8/92)");
    }
}