import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  reviewEligibility,
  summariseReviews,
} from "../src/lib/reviews";

describe("review eligibility (feature 2)", () => {
  it("requires an accepted application — of everyone", () => {
    assert.deepEqual(
      reviewEligibility({
        hasAcceptedApplication: false,
        tier: "elite",
        isAdmin: false,
      }),
      { can: false, code: "not_accepted" },
    );
    // Even an admin who never applied cannot review (eligibility is the
    // point of the feature; only the tier gate has an admin bypass).
    assert.deepEqual(
      reviewEligibility({
        hasAcceptedApplication: false,
        tier: "elite",
        isAdmin: true,
      }),
      { can: false, code: "not_accepted" },
    );
  });

  it("requires Elite unless admin", () => {
    assert.deepEqual(
      reviewEligibility({
        hasAcceptedApplication: true,
        tier: "pro",
        isAdmin: false,
      }),
      { can: false, code: "tier_required" },
    );
    assert.deepEqual(
      reviewEligibility({
        hasAcceptedApplication: true,
        tier: "pro",
        isAdmin: true,
      }),
      { can: true, code: "ok" },
    );
  });

  it("lets an Elite applicant with an accepted application through", () => {
    assert.deepEqual(
      reviewEligibility({
        hasAcceptedApplication: true,
        tier: "elite",
        isAdmin: false,
      }),
      { can: true, code: "ok" },
    );
  });
});

describe("review summaries", () => {
  it("returns null with no reviews", () => {
    assert.equal(summariseReviews([]), null);
  });

  it("averages each dimension and rounds to one decimal", () => {
    const summary = summariseReviews([
      { payoutRating: 5, leadRating: 4, supportRating: 3 },
      { payoutRating: 4, leadRating: 4, supportRating: 2 },
    ]);
    assert.deepEqual(summary, {
      count: 2,
      payout: 4.5,
      lead: 4,
      support: 2.5,
      overall: 3.7,
    });
  });

  it("matches a single perfect review", () => {
    assert.deepEqual(
      summariseReviews([{ payoutRating: 5, leadRating: 5, supportRating: 5 }]),
      { count: 1, payout: 5, lead: 5, support: 5, overall: 5 },
    );
  });
});
