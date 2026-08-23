import { test } from "node:test";
import assert from "node:assert/strict";
import { headroom, isAtLimit, isScorePresetLocked, limitFor, hasFeature } from "./limits.ts";
import { alertScoreCeiling, isAlertScoreLocked, FREE_MAX_ALERT_SCORE } from "./limits.ts";

/**
 * The plan rules, tested directly.
 *
 * These exist because of a bug that charged people and then limited them
 * anyway: PRO's limits are `null` for "unlimited", and a `??` fallback meant
 * for an unknown tier could not tell that from a missing value, so every PRO
 * lookup quietly returned the free number. Nothing failed loudly — the app
 * built, typechecked and rendered; paying accounts were simply told they had
 * reached a limit they did not have.
 *
 * Run with `npm test`.
 */

test("PRO has no limit at any count", () => {
  for (const kind of ["alerts", "saved"] as const) {
    assert.equal(limitFor("pro", kind), null, `${kind} should be unlimited`);
    assert.equal(headroom("pro", kind, 9999), null);
    for (const count of [0, 2, 3, 50, 9999]) {
      assert.equal(isAtLimit("pro", kind, count), false, `${kind} at ${count}`);
    }
  }
});

test("free is limited to 2 active alerts and 3 saved tenders", () => {
  assert.equal(limitFor("free", "alerts"), 2);
  assert.equal(limitFor("free", "saved"), 3);

  assert.equal(isAtLimit("free", "alerts", 1), false);
  assert.equal(isAtLimit("free", "alerts", 2), true);
  assert.equal(isAtLimit("free", "saved", 2), false);
  assert.equal(isAtLimit("free", "saved", 3), true);
});

test("being over the limit is a stable state, not an error", () => {
  // Beta accounts kept everything they had created; they are only blocked from
  // adding. Nothing here may go negative or start deleting.
  assert.equal(isAtLimit("free", "alerts", 5), true);
  assert.equal(headroom("free", "alerts", 5), 0);
  assert.equal(headroom("free", "saved", 99), 0);
});

test("pausing an alert returns headroom", () => {
  assert.equal(headroom("free", "alerts", 2), 0);
  assert.equal(headroom("free", "alerts", 1), 1);
});

test("score presets: 60 is free, above it is PRO", () => {
  assert.equal(isScorePresetLocked("free", 0), false);
  assert.equal(isScorePresetLocked("free", 60), false);
  assert.equal(isScorePresetLocked("free", 80), true);
  assert.equal(isScorePresetLocked("free", 90), true);

  for (const preset of [0, 60, 80, 90]) {
    assert.equal(isScorePresetLocked("pro", preset), false, `PRO should reach ${preset}`);
  }
});

test("gated capabilities belong to PRO only", () => {
  for (const feature of ["score_filter", "premium_calculator"] as const) {
    assert.equal(hasFeature("pro", feature), true);
    assert.equal(hasFeature("free", feature), false);
  }
});

test("alert score: free stops at 79, PRO goes to 99", () => {
  assert.equal(alertScoreCeiling("free"), FREE_MAX_ALERT_SCORE);
  assert.equal(alertScoreCeiling("pro"), 99);

  assert.equal(isAlertScoreLocked("free", undefined), false);
  assert.equal(isAlertScoreLocked("free", 0), false);
  assert.equal(isAlertScoreLocked("free", 79), false);
  assert.equal(isAlertScoreLocked("free", 80), true);
  assert.equal(isAlertScoreLocked("free", 99), true);

  for (const score of [0, 79, 80, 99]) {
    assert.equal(isAlertScoreLocked("pro", score), false, `PRO should reach ${score}`);
  }
});
