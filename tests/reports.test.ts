import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REPORT_THRESHOLD, shouldAutoPause } from "../src/lib/reports";

describe("report threshold", () => {
  it("is 3 unique reports", () => {
    assert.equal(REPORT_THRESHOLD, 3);
  });
});

describe("auto-pause rule (feature 3)", () => {
  it("pauses an open offer at the threshold", () => {
    assert.equal(shouldAutoPause("open", 3), true);
    assert.equal(shouldAutoPause("open", 4), true);
  });

  it("does not pause below the threshold", () => {
    assert.equal(shouldAutoPause("open", 0), false);
    assert.equal(shouldAutoPause("open", 2), false);
  });

  it("never touches an offer that is already paused or closed", () => {
    assert.equal(shouldAutoPause("paused", 5), false);
    assert.equal(shouldAutoPause("closed", 5), false);
  });
});
