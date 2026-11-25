import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvedOffersClause,
  canApproveOffers,
  canManageOffer,
  canViewOfferApproval,
  isPartnerRole,
  PARTNER_ROLE,
  toApprovalStatus,
} from "../src/lib/partners";

/**
 * Partner data isolation (feature 4). These are the rules the routes rely on:
 * a partner may only see and manage their own offers, and only an approved
 * offer ever reaches the public board.
 */

const admin = { id: "u-admin", isAdmin: true, roles: [] };
const partnerA = { id: "u-a", isAdmin: false, roles: [PARTNER_ROLE] };
const partnerB = { id: "u-b", isAdmin: false, roles: [PARTNER_ROLE] };
const member = { id: "u-member", isAdmin: false, roles: [] };

const offerA = { partnerId: "u-a", approvalStatus: "approved" as const };
const offerB = { partnerId: "u-b", approvalStatus: "approved" as const };
const adminOffer = { partnerId: null, approvalStatus: "approved" as const };
const pendingA = { partnerId: "u-a", approvalStatus: "pending" as const };

test("admin can manage every offer, including other partners'", () => {
  assert.equal(canManageOffer(admin, offerA), true);
  assert.equal(canManageOffer(admin, offerB), true);
  assert.equal(canManageOffer(admin, adminOffer), true);
});

test("a partner can manage only offers they submitted", () => {
  assert.equal(canManageOffer(partnerA, offerA), true);
  assert.equal(canManageOffer(partnerA, offerB), false);
  assert.equal(canManageOffer(partnerA, adminOffer), false);
});

test("a partner who lost the role loses access to their old offers", () => {
  const demoted = { id: "u-a", isAdmin: false, roles: [] };
  assert.equal(canManageOffer(demoted, offerA), false);
});

test("ordinary members never manage offers", () => {
  assert.equal(canManageOffer(member, adminOffer), false);
  assert.equal(canManageOffer(member, offerA), false);
});

test("approved offers are visible to everyone", () => {
  assert.equal(canViewOfferApproval(member, offerA), true);
  assert.equal(canViewOfferApproval(partnerB, offerA), true);
});

test("pending and rejected offers are visible only to admins and their owner", () => {
  assert.equal(canViewOfferApproval(member, pendingA), false);
  assert.equal(canViewOfferApproval(partnerB, pendingA), false);
  assert.equal(canViewOfferApproval(partnerA, pendingA), true);
  assert.equal(canViewOfferApproval(admin, pendingA), true);

  const rejected = { partnerId: "u-a", approvalStatus: "rejected" as const };
  assert.equal(canViewOfferApproval(member, rejected), false);
  assert.equal(canViewOfferApproval(partnerA, rejected), true);
});

test("only admins approve submissions", () => {
  assert.equal(canApproveOffers(admin), true);
  assert.equal(canApproveOffers(partnerA), false);
  assert.equal(canApproveOffers(member), false);
});

test("only the partner role counts as partner access", () => {
  assert.equal(isPartnerRole([PARTNER_ROLE]), true);
  assert.equal(isPartnerRole(["partner ", "closer"]), false);
  assert.equal(isPartnerRole(["closer-vip"]), false);
  assert.equal(isPartnerRole([]), false);
});

test("missing or unknown approval values fall back to approved (legacy rows)", () => {
  assert.equal(toApprovalStatus(null), "approved");
  assert.equal(toApprovalStatus(undefined), "approved");
  assert.equal(toApprovalStatus("weird"), "approved");
  assert.equal(toApprovalStatus("pending"), "pending");
  assert.equal(toApprovalStatus("rejected"), "rejected");
});

test("the public SQL clause keeps unapproved offers out of list reads", () => {
  assert.match(approvedOffersClause(), /approval_status = 'approved'/);
  assert.match(approvedOffersClause("offers"), /offers\.approval_status/);
});
