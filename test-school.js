const test = require("node:test");
const assert = require("node:assert/strict");
const { rotationForDate, gradeSummary, isAssessment, normalizeFocusPlan, nextFocusPhase, isSyncedMissingWork } = require("./school.js");

test("rotation skips weekends and works before the anchor", () => {
  const settings = { rotationLabels: ["A", "B"], anchorDate: "2026-08-28" };
  assert.equal(rotationForDate(settings, "2026-08-28"), "A");
  assert.equal(rotationForDate(settings, "2026-08-31"), "B");
  assert.equal(rotationForDate(settings, "2026-09-01"), "A");
  assert.equal(rotationForDate(settings, "2026-08-27"), "B");
});

test("grade summary uses earned points", () => {
  const items = [{ score: 45, pointsPossible: 50 }, { score: 40, pointsPossible: 50 }];
  assert.deepEqual(gradeSummary(items), { earned: 85, possible: 100, percent: 85 });
});

test("tests and quizzes are recognized even when an import uses a generic type", () => {
  assert.equal(isAssessment({ title: "Unit 2 Exam", type: "Assignment" }), true);
  assert.equal(isAssessment({ title: "Chapter review", type: "Quiz" }), true);
  assert.equal(isAssessment({ title: "Lab report", type: "Assignment" }), false);
});

test("focus plans are bounded and advance through work and break blocks", () => {
  assert.deepEqual(normalizeFocusPlan({ work: 20, break: 5, blocks: 2 }), { work: 20, break: 5, blocks: 2 });
  assert.deepEqual(normalizeFocusPlan({ work: 0, break: 90, blocks: 20 }), { work: 1, break: 60, blocks: 8 });
  assert.deepEqual(nextFocusPhase("work", 1, 2), { phase: "break", block: 1, complete: false });
  assert.deepEqual(nextFocusPhase("break", 1, 2), { phase: "work", block: 2, complete: false });
  assert.deepEqual(nextFocusPhase("break", 2, 2), { phase: "work", block: 1, complete: true });
});

test("missing-work watchdog only flags overdue synced work", () => {
  const task = { due: "2026-08-26", completed: false, sources: [{ provider: "google", id: "1" }] };
  assert.equal(isSyncedMissingWork(task, "2026-08-27"), true);
  assert.equal(isSyncedMissingWork({ ...task, due: "2026-08-28" }, "2026-08-27"), false);
  assert.equal(isSyncedMissingWork({ ...task, sources: [] }, "2026-08-27"), false);
  assert.equal(isSyncedMissingWork({ ...task, completed: true }, "2026-08-27"), false);
});
