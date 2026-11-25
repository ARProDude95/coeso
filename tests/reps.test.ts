import assert from "node:assert/strict";
import { test } from "node:test";
import {
  averageRating,
  canConfirmDeal,
  earningsVisible,
  handleFromEmail,
  slugifyHandle,
  summariseDeals,
  uniqueHandle,
} from "../src/lib/reps";

const deal = (
  id: string,
  dealsClosed: number,
  earningsMin: number | null,
  earningsMax: number | null,
  confirmed = false,
) => ({
  id,
  dealsClosed,
  earningsMin,
  earningsMax,
  partnerConfirmedAt: confirmed ? "2026-02-01T00:00:00.000Z" : null,
});

test("profile handles are lowercase, URL-safe and never empty", () => {
  assert.equal(slugifyHandle("Marcus Reed"), "marcus-reed");
  assert.equal(slugifyHandle("  Ana  María  "), "ana-maria");
  assert.equal(slugifyHandle("Top Closer!"), "top-closer");
  assert.equal(slugifyHandle("a"), "rep-a");
  assert.equal(slugifyHandle("***"), "rep-user");
  assert.equal(slugifyHandle("X".repeat(40)).length, 24);
});

test("handles come from the email local part", () => {
  assert.equal(handleFromEmail("marcus.reed@coeso.com"), "marcus.reed");
  assert.equal(handleFromEmail("no-at-sign"), "no-at-sign");
});

test("a taken handle gets a deterministic numeric suffix", () => {
  assert.equal(uniqueHandle("Marcus Reed", []), "marcus-reed");
  assert.equal(uniqueHandle("Marcus Reed", ["marcus-reed"]), "marcus-reed-2");
  assert.equal(
    uniqueHandle("Marcus Reed", ["marcus-reed", "marcus-reed-2"]),
    "marcus-reed-3",
  );
});

test("earnings are hidden from strangers but never from the rep or admins", () => {
  const rep = { id: "u-rep", isAdmin: false };
  const other = { id: "u-other", isAdmin: false };
  const admin = { id: "u-admin", isAdmin: true };

  assert.equal(earningsVisible(true, rep, "u-rep"), true);
  assert.equal(earningsVisible(true, admin, "u-rep"), true);
  assert.equal(earningsVisible(true, other, "u-rep"), false);
  // A rep who leaves earnings visible shares them with the board.
  assert.equal(earningsVisible(false, other, "u-rep"), true);
});

test("deal totals add up and count confirmations", () => {
  const totals = summariseDeals([
    deal("d1", 3, 3000, 5000, true),
    deal("d2", 2, null, null),
    deal("d3", 1, 1000, 1500),
  ]);

  assert.equal(totals.totalDeals, 6);
  assert.equal(totals.offersWorked, 3);
  assert.equal(totals.confirmedDeals, 1);
  assert.equal(totals.earningsMin, 4000);
  assert.equal(totals.earningsMax, 6500);
});

test("an empty profile and a profile with no earnings range both report null", () => {
  assert.deepEqual(summariseDeals([]), {
    totalDeals: 0,
    offersWorked: 0,
    confirmedDeals: 0,
    earningsMin: null,
    earningsMax: null,
  });

  const noRange = summariseDeals([deal("d1", 4, null, null)]);
  assert.equal(noRange.totalDeals, 4);
  assert.equal(noRange.earningsMin, null);
  assert.equal(noRange.earningsMax, null);
});

test("average rating is one decimal and null with no ratings", () => {
  assert.equal(averageRating([5, 4, 4]), 4.3);
  assert.equal(averageRating([5]), 5);
  assert.equal(averageRating([]), null);
});

test("only the owning partner or an admin confirms a deal", () => {
  const partner = { id: "u-p1", isAdmin: false, roles: ["partner"] };
  const otherPartner = { id: "u-p2", isAdmin: false, roles: ["partner"] };
  const admin = { id: "u-admin", isAdmin: true, roles: [] };
  const member = { id: "u-m", isAdmin: false, roles: [] };
  const offer = { partnerId: "u-p1" };

  assert.equal(canConfirmDeal(partner, offer), true);
  assert.equal(canConfirmDeal(admin, offer), true);
  assert.equal(canConfirmDeal(otherPartner, offer), false);
  assert.equal(canConfirmDeal(member, offer), false);
  assert.equal(canConfirmDeal(partner, { partnerId: null }), false);
});
