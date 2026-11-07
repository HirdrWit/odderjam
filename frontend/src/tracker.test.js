import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarWeeks, filterQuery, plColor, scaleSeries, NEUTRAL, PROFIT, LOSS } from "./tracker.js";

test("calendarWeeks pads to whole Sun..Sat weeks", () => {
  const weeks = calendarWeeks(2026, 10); // November 2026 starts on a Sunday, 30 days
  assert.equal(weeks[0][0].date, "2026-11-01");
  assert.equal(weeks.length, 5);
  assert.deepEqual(weeks[4].slice(2), Array(5).fill(null)); // Nov 29, 30, then padding
  const feb = calendarWeeks(2026, 1); // Feb 2026 starts on a Sunday too, 28 days
  assert.equal(feb.length, 4);
  assert.equal(calendarWeeks(2026, 0)[0].filter((c) => c === null).length, 4); // Jan 1 2026 is a Thursday
});

test("plColor is gray at zero and the full pole at the max", () => {
  assert.equal(plColor(0, 10), NEUTRAL);
  assert.equal(plColor(5, 0), NEUTRAL);
  assert.equal(plColor(10, 10), PROFIT);
  assert.equal(plColor(-10, 10), LOSS);
  assert.notEqual(plColor(1, 10), PROFIT);
});

test("scaleSeries keeps zero inside the range", () => {
  const { points, zeroY } = scaleSeries([{ cumulative: 10 }, { cumulative: 20 }], 100, 50, 0);
  assert.deepEqual(points, [[0, 25], [100, 0]]);
  assert.equal(zeroY, 50);
  assert.deepEqual(scaleSeries([{ cumulative: -5 }], 100, 50, 0).points, [[50, 50]]);
});

test("filterQuery drops blanks", () => {
  assert.equal(filterQuery({ sport: "NBA", book: "", status: null, date_from: "2026-01-01" }), "sport=NBA&date_from=2026-01-01");
});
