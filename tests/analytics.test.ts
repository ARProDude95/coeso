import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptanceRate,
  barPercent,
  buildSeries,
  canViewAnalytics,
  lastNDays,
} from "../src/lib/analytics";

test("the 30-day window ends today and has exactly 30 unique days", () => {
  const days = lastNDays(30, new Date("2026-03-02T15:45:00Z"));
  assert.equal(days.length, 30);
  assert.equal(days[29], "2026-03-02");
  assert.equal(days[0], "2026-02-01");
  assert.equal(new Set(days).size, 30);
});

test("acceptance rate is a one-decimal percentage and null with no applicants", () => {
  assert.equal(acceptanceRate(0, 0), null);
  assert.equal(acceptanceRate(1, 2), 50);
  assert.equal(acceptanceRate(1, 3), 33.3);
  assert.equal(acceptanceRate(3, 3), 100);
});

test("the series fills quiet days with zeros", () => {
  const series = buildSeries(
    ["2026-03-01", "2026-03-02", "2026-03-03"],
    [{ date: "2026-03-02", count: 4 }],
    [
      { date: "2026-03-01", count: 1 },
      { date: "2026-03-03", count: 2 },
    ],
  );

  assert.deepEqual(series, [
    { date: "2026-03-01", views: 0, applications: 1 },
    { date: "2026-03-02", views: 4, applications: 0 },
    { date: "2026-03-03", views: 0, applications: 2 },
  ]);
});

test("bars scale against the busiest day and keep a visible minimum", () => {
  assert.equal(barPercent(10, 10), 100);
  assert.equal(barPercent(5, 10), 50);
  assert.equal(barPercent(1, 100), 2);
  assert.equal(barPercent(0, 100), 0);
  assert.equal(barPercent(0, 0), 0);
});

test("admins see all analytics, partners only their own offers", () => {
  const admin = { id: "u-admin", isAdmin: true, roles: [] };
  const partner = { id: "u-p1", isAdmin: false, roles: ["partner"] };
  const member = { id: "u-m", isAdmin: false, roles: [] };

  assert.equal(canViewAnalytics(admin, { partnerId: "u-p1" }), true);
  assert.equal(canViewAnalytics(admin, { partnerId: null }), true);
  assert.equal(canViewAnalytics(partner, { partnerId: "u-p1" }), true);
  assert.equal(canViewAnalytics(partner, { partnerId: "u-p2" }), false);
  assert.equal(canViewAnalytics(partner, { partnerId: null }), false);
  assert.equal(canViewAnalytics(member, { partnerId: null }), false);
});
