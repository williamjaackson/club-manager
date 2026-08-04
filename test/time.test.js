import assert from "node:assert/strict";
import test from "node:test";
import { parseDurationSeconds } from "../dist/time.js";

test("parses single-unit hold durations within sane bounds", () => {
  assert.equal(parseDurationSeconds("30m", "Hold"), 1_800);
  assert.equal(parseDurationSeconds("12h", "Hold"), 43_200);
  assert.equal(parseDurationSeconds("2d", "Hold"), 172_800);
  assert.throws(
    () => parseDurationSeconds("4m", "Hold"),
    /between 5 minutes and 14 days/,
  );
  assert.throws(
    () => parseDurationSeconds("15d", "Hold"),
    /between 5 minutes and 14 days/,
  );
  assert.throws(() => parseDurationSeconds("soon", "Hold"), /must look like/);
  assert.throws(() => parseDurationSeconds("1h30m", "Hold"), /must look like/);
});
