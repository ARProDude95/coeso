import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasTier,
  savedSearchLimit,
  tierFilterMatches,
  tierRank,
  viewerCanUse,
} from "../src/lib/tiers";

describe("tier ranking", () => {
  it("orders free < pro < elite", () => {
    assert.ok(tierRank("free") < tierRank("pro"));
    assert.ok(tierRank("pro") < tierRank("elite"));
  });

  it("hasTier is inclusive", () => {
    assert.equal(hasTier("elite", "pro"), true);
    assert.equal(hasTier("pro", "pro"), true);
    assert.equal(hasTier("pro", "elite"), false);
    assert.equal(hasTier("free", "pro"), false);
  });
});

describe("saved search limits (feature 1)", () => {
  it("gives Pro 5, Elite 15, Free none", () => {
    assert.equal(savedSearchLimit("pro"), 5);
    assert.equal(savedSearchLimit("elite"), 15);
    assert.equal(savedSearchLimit("free"), 0);
  });
});

describe("tier filter matching", () => {
  it('treats "all" as a match for every tier', () => {
    assert.equal(tierFilterMatches("all", "free"), true);
    assert.equal(tierFilterMatches("all", "elite"), true);
  });

  it("matches only the exact tier otherwise", () => {
    assert.equal(tierFilterMatches("pro", "pro"), true);
    assert.equal(tierFilterMatches("pro", "elite"), false);
    assert.equal(tierFilterMatches("elite", "pro"), false);
    assert.equal(tierFilterMatches("free", "pro"), false);
  });
});

describe("feature access", () => {
  it("lets admins use everything", () => {
    assert.equal(
      viewerCanUse({ tier: "free", isAdmin: true }, "pro"),
      true,
    );
  });

  it("gates non-admins by tier", () => {
    assert.equal(viewerCanUse({ tier: "free", isAdmin: false }, "pro"), false);
    assert.equal(viewerCanUse({ tier: "pro", isAdmin: false }, "pro"), true);
    assert.equal(viewerCanUse({ tier: "pro", isAdmin: false }, "elite"), false);
    assert.equal(viewerCanUse({ tier: "elite", isAdmin: false }, "elite"), true);
  });
});
