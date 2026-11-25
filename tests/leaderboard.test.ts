import assert from "node:assert/strict";
import { test } from "node:test";
import {
  awardsToRevoke,
  currentMonth,
  isValidMonth,
  monthLabel,
  previousMonth,
  rankEntries,
  shouldAward,
  type Award,
  type LeaderboardEntry,
} from "../src/lib/leaderboard";

const entry = (
  userId: string,
  name: string,
  deals: number,
): LeaderboardEntry => ({
  userId,
  name,
  username: name.toLowerCase().replace(/\s+/g, "-"),
  deals,
});

test("the current month is the UTC calendar month", () => {
  assert.equal(currentMonth(new Date("2026-03-02T23:30:00Z")), "2026-03");
  // Crossing midnight UTC must not leak the previous month.
  assert.equal(currentMonth(new Date("2026-01-01T00:00:00Z")), "2026-01");
});

test("the previous month rolls over the year boundary", () => {
  assert.equal(previousMonth("2026-03"), "2026-02");
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.equal(previousMonth("2025-01"), "2024-12");
});

test("month labels are human-readable", () => {
  assert.equal(monthLabel("2026-03"), "March 2026");
  assert.equal(monthLabel("2025-12"), "December 2025");
});

test("month validation rejects impossible values", () => {
  assert.equal(isValidMonth("2026-03"), true);
  assert.equal(isValidMonth("2026-00"), false);
  assert.equal(isValidMonth("2026-13"), false);
  assert.equal(isValidMonth("26-03"), false);
});

test("ranking is deals descending with a deterministic name tiebreak", () => {
  const ranked = rankEntries([
    entry("u1", "Zoe", 4),
    entry("u2", "Ana", 4),
    entry("u3", "Mia", 9),
    entry("u4", "Ben", 0),
  ]);

  assert.deepEqual(
    ranked.map((row) => row.name),
    ["Mia", "Ana", "Zoe", "Ben"],
  );
});

test("the top three is a stable cut even when the third place ties", () => {
  const ranked = rankEntries([
    entry("u1", "A", 5),
    entry("u2", "B", 5),
    entry("u3", "C", 5),
    entry("u4", "D", 5),
  ]);
  assert.deepEqual(
    ranked.slice(0, 3).map((row) => row.name),
    ["A", "B", "C"],
  );
});

test("awards from earlier months are revoked while the current month is not", () => {
  const awards: Award[] = [
    {
      id: "a1",
      month: "2026-02",
      userId: "u1",
      rank: 1,
      roleGranted: true,
      revokedAt: null,
    },
    {
      id: "a2",
      month: "2026-03",
      userId: "u2",
      rank: 1,
      roleGranted: true,
      revokedAt: null,
    },
    {
      id: "a3",
      month: "2026-01",
      userId: "u3",
      rank: 1,
      roleGranted: true,
      revokedAt: "2026-02-01T00:00:00.000Z",
    },
  ];

  assert.deepEqual(
    awardsToRevoke(awards, "2026-03").map((award) => award.id),
    ["a1"],
  );
  // Reading again after the revoke is a no-op.
  assert.deepEqual(
    awardsToRevoke(awards, "2026-03").map((award) => award.id),
    ["a1"],
  );
});

test("a month is awarded once, and only when somebody has deals", () => {
  assert.equal(shouldAward([], [entry("u1", "A", 3)]), true);
  assert.equal(
    shouldAward(
      [
        {
          id: "a1",
          month: "2026-03",
          userId: "u1",
          rank: 1,
          roleGranted: true,
          revokedAt: null,
        },
      ],
      [entry("u1", "A", 3)],
    ),
    false,
  );
  assert.equal(shouldAward([], []), false);
  assert.equal(shouldAward([], [entry("u1", "A", 0)]), false);
});
