import test from "node:test";
import assert from "node:assert/strict";
import { defaultState, importPayload, mergeForConflict, normalizeState, validState } from "./cloud-core.mjs";

const blackbaud = {
  provider: "blackbaud",
  syncedAt: "2026-08-27T22:00:00.000Z",
  courses: [{ sourceId: "band-section", name: "Band" }],
  assignments: [{ sourceId: "syllabus-1", courseSourceId: "band-section", courseName: "Band", title: "Syllabus", due: "2026-09-14", time: "11:20", type: "Assignment" }]
};

test("default cloud state is valid and includes every real class", () => {
  const state = defaultState();
  assert.equal(validState(state), true);
  assert.deepEqual(state.courses.map(course => course.name), ["Algebra 2", "English 10", "The Church", "Chemistry", "German 1", "Western Civ", "Band"]);
});

test("cloud imports are idempotent", () => {
  let id = 0;
  const ids = () => `task-${++id}`;
  const first = importPayload(defaultState(), blackbaud, ids);
  const second = importPayload(first.state, blackbaud, ids);
  assert.equal(first.counts.imported, 1);
  assert.equal(second.state.tasks.length, 1);
  assert.equal(second.counts.updated, 1);
});

test("deleted school work is not recreated by the next import", () => {
  let state = importPayload(defaultState(), blackbaud, () => "task-1").state;
  const task = state.tasks[0];
  state.tombstones.tasks[task.id] = "2026-08-27T22:05:00.000Z";
  state.tombstones.sources["blackbaud:syllabus-1"] = "2026-08-27T22:05:00.000Z";
  state.tasks = [];
  state = importPayload(state, blackbaud, () => "task-2").state;
  assert.equal(state.tasks.length, 0);
});

test("a stale device merge preserves a fresh import and its own edit", () => {
  const base = defaultState();
  base.tasks.push({ id: "manual-1", title: "Read chapter", courseId: "western-civ", due: "2026-09-01", time: "23:59", type: "Reading", estimate: 25, priority: "normal", completed: false });
  const remote = importPayload(base, blackbaud, () => "band-task").state;
  const local = normalizeState(base);
  local.tasks[0].completed = true;
  const merged = mergeForConflict(remote, local);
  assert.equal(merged.tasks.length, 2);
  assert.equal(merged.tasks.find(task => task.id === "manual-1").completed, true);
  assert.equal(merged.tasks.find(task => task.id === "band-task").title, "Syllabus");
});

test("legacy state gains assignment, grade, and rotation fields without losing work", () => {
  const legacy = defaultState();
  delete legacy.gradeItems;
  delete legacy.gradeGoals;
  delete legacy.schoolSchedule;
  delete legacy.tombstones.grades;
  legacy.tasks.push({ id: "legacy-1", title: "Essay", courseId: "english-10", due: "2026-09-04", time: "15:30", type: "Assignment", estimate: 45, priority: "normal", completed: false, description: "Use MLA format." });

  const state = normalizeState(legacy);

  assert.equal(validState(state), true);
  assert.deepEqual(state.gradeItems, []);
  assert.deepEqual(state.gradeGoals, {});
  assert.deepEqual(state.schoolSchedule, { rotationLabels: ["A", "B"], anchorDate: "" });
  assert.equal(state.tasks[0].teacherInstructions, "Use MLA format.");
  assert.deepEqual(state.tasks[0].subtasks, []);
  assert.deepEqual(state.tasks[0].attachments, []);
});

test("cloud state accepts rich assignment details, rotating periods, and grades", () => {
  const state = defaultState();
  state.schoolSchedule = { rotationLabels: ["Red", "Blue"], anchorDate: "2026-08-27" };
  state.courses[0].teacher = "Ms. Euler";
  state.courses[0].room = "204";
  state.courses[0].schedule = [{ day: 4, start: "08:00", end: "09:00", period: "Block 1", rotation: "Red" }];
  state.tasks.push({
    id: "task-details",
    title: "Lab report",
    courseId: "chemistry",
    due: "2026-08-28",
    time: "16:00",
    type: "Assignment",
    estimate: 45,
    priority: "high",
    completed: false,
    teacherInstructions: "Use CER format.",
    notes: "Check trial 3.",
    subtasks: [{ id: "step-1", title: "Draft claim", completed: true }],
    attachments: [{ id: "link-1", name: "Lab guide", url: "https://example.com/lab-guide" }]
  });
  state.gradeItems.push({ id: "grade-1", courseId: "algebra-2", title: "Quiz 1", score: 45, pointsPossible: 50, date: "2026-08-27" });
  state.gradeGoals["algebra-2"] = 90;

  assert.equal(validState(state), true);
  state.tasks[0].attachments[0].url = "http://example.com/insecure";
  assert.equal(validState(state), false);
});

test("conflict merge preserves grades and honors deleted grade tombstones", () => {
  const remote = defaultState();
  remote.gradeItems.push({ id: "remote-grade", courseId: "chemistry", title: "Lab", score: 18, pointsPossible: 20, date: "2026-08-27" });
  const local = defaultState();
  local.gradeItems.push({ id: "local-grade", courseId: "algebra-2", title: "Quiz", score: 45, pointsPossible: 50, date: "2026-08-27" });
  local.tombstones.grades["remote-grade"] = "2026-08-27T23:00:00.000Z";

  const merged = mergeForConflict(remote, local);

  assert.deepEqual(merged.gradeItems.map(item => item.id), ["local-grade"]);
});

test("a class remains available while a surviving grade still references it", () => {
  const remote = defaultState();
  remote.gradeItems.push({ id: "grade-1", courseId: "chemistry", title: "Lab", score: 18, pointsPossible: 20, date: "2026-08-27" });
  const local = defaultState();
  local.tombstones.courses.chemistry = "2026-08-27T23:00:00.000Z";

  const merged = mergeForConflict(remote, local);

  assert.equal(merged.courses.some(course => course.id === "chemistry"), true);
  assert.equal(validState(merged), true);
});
