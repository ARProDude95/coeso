package com.coeso.roster.commission;

import java.util.List;

/**
 * Pure commission math for one revenue amount, in integer minor units — no
 * floats anywhere.
 *
 * <ul>
 *   <li><b>percent</b>: revenue × rateBp ÷ 10000, rounded half-up to a whole
 *       minor unit (2500 bp of 1999 = 500 bp… precisely: 1999×2500/10000 =
 *       499.75 → 500);</li>
 *   <li><b>flat</b>: a fixed amount per revenue entry (per deal);</li>
 *   <li><b>tiered</b>: <em>marginal</em> bands over the revenue — each band's
 *       rate applies only to the slice of revenue that falls inside it, bands
 *       are ascending, a null ceiling means "and above".</li>
 * </ul>
 */
public final class CommissionMath {

    private CommissionMath() {
    }

    /** One tier: {@code [0, upToMinor)} at {@code rateBp}; null = unbounded top. */
    public record Tier(Long upToMinor, Integer rateBp) {
    }

    public static long computePercent(long revenueMinor, Integer rateBp) {
        if (rateBp == null || rateBp <= 0) {
            return 0;
        }
        return roundHalfUp(revenueMinor, rateBp, 10_000L);
    }

    public static long computeFlat(Long flatMinor) {
        return flatMinor == null || flatMinor <= 0 ? 0 : flatMinor;
    }

    /**
     * Marginal tiered commission. Edge cases covered by tests: revenue exactly
     * on a band boundary, revenue below the first band, revenue spanning many
     * bands, and a null top band.
     */
    public static long computeTiered(long revenueMinor, List<Tier> tiers) {
        if (revenueMinor <= 0 || tiers == null || tiers.isEmpty()) {
            return 0;
        }
        long total = 0;
        long floor = 0; // lower edge of the current band, in revenue units
        for (Tier tier : tiers) {
            if (tier == null || tier.rateBp() == null) {
                continue;
            }
            long ceiling = tier.upToMinor() == null
                    ? revenueMinor
                    : Math.min(tier.upToMinor(), revenueMinor);
            if (ceiling > floor) {
                total += roundHalfUp(ceiling - floor, (long) tier.rateBp(), 10_000L);
                floor = ceiling;
            }
            if (revenueMinor <= (tier.upToMinor() == null ? Long.MAX_VALUE : tier.upToMinor())) {
                // revenue fully consumed within (or at the top of) this band
                if (tier.upToMinor() != null && revenueMinor <= tier.upToMinor()) {
                    return total;
                }
            }
            if (tier.upToMinor() == null) {
                return total; // unbounded top band always ends the walk
            }
        }
        return total;
    }

    /** (a × b) ÷ divisor, rounded half-up, overflow-safe enough for money. */
    static long roundHalfUp(long a, long b, long divisor) {
        long product = Math.multiplyExact(a, b);
        long floored = Math.floorDiv(product, divisor);
        long remainder = Math.floorMod(product, divisor);
        return remainder * 2 >= divisor ? floored + 1 : floored;
    }
}