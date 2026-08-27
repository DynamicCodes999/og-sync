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
