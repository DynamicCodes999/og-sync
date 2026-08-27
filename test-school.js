const test = require("node:test");
const assert = require("node:assert/strict");
const { rotationForDate, gradeSummary, scoreNeeded, isAssessment } = require("./school.js");

test("rotation skips weekends and works before the anchor", () => {
  const settings = { rotationLabels: ["A", "B"], anchorDate: "2026-08-28" };
  assert.equal(rotationForDate(settings, "2026-08-28"), "A");
  assert.equal(rotationForDate(settings, "2026-08-31"), "B");
  assert.equal(rotationForDate(settings, "2026-09-01"), "A");
  assert.equal(rotationForDate(settings, "2026-08-27"), "B");
});

test("grade summary and needed-score math use earned points", () => {
  const items = [{ score: 45, pointsPossible: 50 }, { score: 40, pointsPossible: 50 }];
  assert.deepEqual(gradeSummary(items), { earned: 85, possible: 100, percent: 85 });
  assert.deepEqual(scoreNeeded(items, 90, 100), { points: 95, percent: 95, possible: true });
  assert.equal(scoreNeeded(items, 100, 10).possible, false);
});

test("tests and quizzes are recognized even when an import uses a generic type", () => {
  assert.equal(isAssessment({ title: "Unit 2 Exam", type: "Assignment" }), true);
  assert.equal(isAssessment({ title: "Chapter review", type: "Quiz" }), true);
  assert.equal(isAssessment({ title: "Lab report", type: "Assignment" }), false);
});
