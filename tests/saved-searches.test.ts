import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  keywordsMatch,
  matchesOffer,
  minCommissionMatches,
  offerFacts,
  roleFilterMatches,
  type OfferFacts,
  type SearchFilter,
} from "../src/lib/matching";

const offer: OfferFacts = {
  roleType: "closer",
  tier: "pro",
  title: "Senior Closer — Enterprise SaaS",
  company: "Northwind Growth",
  description: "Two-call close on a $2.4k/mo retention platform.",
  commissionAmount: 1500,
  status: "open",
};

const anySearch: SearchFilter = {
  roleType: "all",
  tier: "all",
  keywords: "",
  minCommission: null,
};

describe("role filter", () => {
  it('"all" matches every role', () => {
    assert.equal(roleFilterMatches("all", "setter"), true);
    assert.equal(roleFilterMatches("all", "closer"), true);
  });

  it('a "both" offer satisfies a single-side search', () => {
    assert.equal(roleFilterMatches("setter", "both"), true);
    assert.equal(roleFilterMatches("closer", "both"), true);
    // …but a search for both-sides roles wants a both offer specifically.
    assert.equal(roleFilterMatches("both", "setter"), false);
    assert.equal(roleFilterMatches("both", "both"), true);
  });

  it("otherwise requires the exact role", () => {
    assert.equal(roleFilterMatches("setter", "closer"), false);
    assert.equal(roleFilterMatches("closer", "closer"), true);
  });
});

describe("keyword filter", () => {
  it("is case-insensitive and requires every token", () => {
    assert.equal(keywordsMatch("senior saas", offer), true);
    assert.equal(keywordsMatch("SENIOR northwind", offer), true);
    assert.equal(keywordsMatch("senior dentist", offer), false);
    assert.equal(keywordsMatch("", offer), true);
    assert.equal(keywordsMatch("   ", offer), true);
  });
});

describe("minimum commission filter", () => {
  it("compares against the numeric amount", () => {
    assert.equal(minCommissionMatches(null, offer), true);
    assert.equal(minCommissionMatches(1000, offer), true);
    assert.equal(minCommissionMatches(1500, offer), true);
    assert.equal(minCommissionMatches(1501, offer), false);
  });

  it("never matches an offer with no amount", () => {
    assert.equal(
      minCommissionMatches(1, { commissionAmount: null }),
      false,
    );
  });
});

describe("matchesOffer", () => {
  it("matches an open offer against an unrestricted search", () => {
    assert.equal(matchesOffer(anySearch, offer), true);
  });

  it("only matches open offers", () => {
    assert.equal(
      matchesOffer(anySearch, { ...offer, status: "paused" }),
      false,
    );
    assert.equal(
      matchesOffer(anySearch, { ...offer, status: "closed" }),
      false,
    );
  });

  it("combines all four filters", () => {
    const search: SearchFilter = {
      roleType: "closer",
      tier: "pro",
      keywords: "saas",
      minCommission: 1000,
    };
    assert.equal(matchesOffer(search, offer), true);
    assert.equal(matchesOffer(search, { ...offer, tier: "free" }), false);
    assert.equal(
      matchesOffer(search, { ...offer, roleType: "setter" }),
      false,
    );
    assert.equal(
      matchesOffer(search, {
        ...offer,
        title: "Retail closer",
        company: "ShopCo",
        description: "In-store sales, commission per sale.",
      }),
      false,
    );
    assert.equal(
      matchesOffer(search, { ...offer, commissionAmount: 10 }),
      false,
    );
  });
});

describe("offerFacts", () => {
  it("projects an Offer down to matchable facts", () => {
    const facts = offerFacts({
      id: "o1",
      title: "Closer",
      company: "Acme",
      description: "desc",
      roleType: "closer",
      commission: "$500",
      commissionAmount: 500,
      payType: "Commission only",
      requirements: "",
      status: "open",
      expiresAt: null,
      featured: false,
      requiredRole: null,
      tier: "pro",
      partnerId: null,
      approvalStatus: "approved",
      createdBy: "u1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(facts, {
      roleType: "closer",
      tier: "pro",
      title: "Closer",
      company: "Acme",
      description: "desc",
      commissionAmount: 500,
      status: "open",
    });
  });
});
