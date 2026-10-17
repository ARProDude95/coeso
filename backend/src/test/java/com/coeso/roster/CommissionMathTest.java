package com.coeso.roster;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.coeso.roster.commission.CommissionMath;
import com.coeso.roster.commission.CommissionMath.Tier;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Phase 7 — commission math for each rule type, integer minor units only.
 * Percent rates are basis points; tiered is marginal (each band's rate applies
 * only to the slice of revenue inside it).
 */
class CommissionMathTest {

    @Test
    void percentAppliesBasisPointsAndRoundsHalfUp() {
        assertEquals(25_000, CommissionMath.computePercent(100_000, 2_500));
        assertEquals(500, CommissionMath.computePercent(1_999, 2_500),
                "499.75 rounds up to 500 minor units");
        assertEquals(500, CommissionMath.computePercent(1_998, 2_500),
                "499.50 is exactly half and rounds up to 500");
        assertEquals(1, CommissionMath.computePercent(1, 10_000), "whole of 1 bp");
        assertEquals(0, CommissionMath.computePercent(0, 2_500), "no revenue, no commission");
        assertEquals(0, CommissionMath.computePercent(100_000, null), "no rate, no commission");
        assertEquals(0, CommissionMath.computePercent(100_000, 0));
    }

    @Test
    void flatPaysTheConfiguredAmountPerEntry() {
        assertEquals(750, CommissionMath.computeFlat(750L));
        assertEquals(0, CommissionMath.computeFlat(0L));
        assertEquals(0, CommissionMath.computeFlat(null));
        assertEquals(0, CommissionMath.computeFlat(-5L), "negative flats are rejected upstream");
    }

    @Test
    void tieredIsMarginalAcrossBands() {
        List<Tier> tiers = List.of(
                new Tier(100_000L, 500),   // first 1000.00 at 5%
                new Tier(null, 2_000));    // the rest at 20%

        assertEquals(0, CommissionMath.computeTiered(0, tiers));
        assertEquals(50, CommissionMath.computeTiered(999, tiers),
                "999 × 5% = 49.95 → 50, entirely inside band 1");
        assertEquals(2_500, CommissionMath.computeTiered(50_000, tiers));
        assertEquals(5_000, CommissionMath.computeTiered(100_000, tiers),
                "exactly on the band boundary: band 1 only");
        assertEquals(15_000, CommissionMath.computeTiered(150_000, tiers),
                "5% of the first 100000 + 20% of the next 50000");
        assertEquals(0, CommissionMath.computeTiered(-1, tiers), "guards negative revenue");
        assertEquals(0, CommissionMath.computeTiered(100_000, List.of()),
                "no tiers, no commission");
    }

    @Test
    void tieredWithFiniteTopBandStopsThere() {
        List<Tier> tiers = List.of(
                new Tier(10_000L, 1_000),
                new Tier(20_000L, 5_000)); // capped: revenue above 200.00 earns nothing more

        assertEquals(1_000, CommissionMath.computeTiered(10_000, tiers));
        assertEquals(2_000, CommissionMath.computeTiered(12_000, tiers),
                "10% of 10000 + 50% of the next 2000");
        assertEquals(6_000, CommissionMath.computeTiered(30_000, tiers),
                "capped above the last ceiling: 1000 + 50% of the 10000 band = 6000");
    }

    @Test
    void roundingNeverLosesOrInventsMinorUnits() {
        // 3333 × 3333 bp = 1110.888… minor units → 1111.
        assertEquals(1_111, CommissionMath.computePercent(3_333, 3_333));
        // exactly half a percent basis: 1000 × 5000bp (50%) = 500.
        assertEquals(500, CommissionMath.computePercent(1_000, 5_000));
    }
}