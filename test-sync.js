const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeImported, classKey, migrateState } = require("./sync.js");

function workspace() {
  return {
    profile: { name: "" },
    courses: [{ id: "algebra-2", name: "Algebra 2", teacher: "", room: "", color: "#ddd5f4", schedule: [] }],
    tasks: [],
    sessions: []
  };
}

test("normalizes class names without collapsing different classes", () => {
  assert.equal(classKey("Algebra II - Period 1"), "algebra 2");
  assert.equal(classKey("Western Civilization"), classKey("Western Civ"));
  assert.notEqual(classKey("German I"), classKey("Algebra I"));
});

test("sync is idempotent and merges the same assignment across providers", () => {
  const state = workspace();
  let id = 0;
  const ids = () => String(++id);
  const google = {
    provider: "google-classroom",
    syncedAt: "2026-08-27T12:00:00Z",
    courses: [{ sourceId: "g-course", name: "Algebra II - Period 1" }],
    assignments: [
      { sourceId: "g-course:g-work", courseSourceId: "g-course", courseName: "Algebra II - Period 1", title: "Chapter 4 Review!", due: "2026-09-01", time: "10:00", type: "Assignment" },
      { sourceId: "g-course:g-work", courseSourceId: "g-course", courseName: "Algebra II - Period 1", title: "Chapter 4 Review!", due: "2026-09-01", time: "10:00", type: "Assignment" }
    ]
  };
  mergeImported(state, google, ids);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.courses.length, 1);
  state.tasks[0].completed = true;

  mergeImported(state, google, ids);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].completed, true);

  mergeImported(state, {
    provider: "blackbaud",
    syncedAt: "2026-08-27T12:05:00Z",
    courses: [{ sourceId: "bb-section", name: "Algebra 2" }],
    assignments: [{ sourceId: "bb-section:bb-work", courseSourceId: "bb-section", courseName: "Algebra 2", title: "Chapter 4 Review", due: "2026-09-01", time: "10:00", type: "Homework" }]
  }, ids);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].sources.length, 2);

  mergeImported(state, {
    provider: "blackbaud",
    syncedAt: "2026-08-27T12:10:00Z",
    courses: [{ sourceId: "bb-section", name: "Algebra 2" }],
    assignments: [{ sourceId: "bb-section:second", courseSourceId: "bb-section", courseName: "Algebra 2", title: "Chapter 4 Review", due: "2026-09-02", time: "10:00", type: "Homework" }]
  }, ids);
  assert.equal(state.tasks.length, 2);
});

test("a provider ID survives due-date edits while different classes stay separate", () => {
  const state = workspace();
  let id = 0;
  const ids = () => String(++id);
  const payload = {
    provider: "google-classroom",
    courses: [
      { sourceId: "algebra", name: "Algebra 2" },
      { sourceId: "chemistry", name: "Chemistry" }
    ],
    assignments: [
      { sourceId: "algebra:review", courseSourceId: "algebra", courseName: "Algebra 2", title: "Unit review", due: "2026-09-01" },
      { sourceId: "chemistry:review", courseSourceId: "chemistry", courseName: "Chemistry", title: "Unit review", due: "2026-09-01" }
    ]
  };
  mergeImported(state, payload, ids);
  assert.equal(state.tasks.length, 2);
  payload.assignments[0].due = "2026-09-03";
  mergeImported(state, payload, ids);
  assert.equal(state.tasks.length, 2);
  assert.equal(state.tasks.find(task => task.sources.some(source => source.id === "algebra:review")).due, "2026-09-03");
});

test("removes the one corrupt Blackbaud import without touching real work", () => {
  const state = workspace();
  state.tasks = [
    { id: "bad", sources: [{ provider: "blackbaud", id: "4b261956b94e2c1ea180" }] },
    { id: "good", sources: [{ provider: "blackbaud", id: "17070595" }] }
  ];
  assert.equal(migrateState(state), 1);
  assert.deepEqual(state.tasks.map(task => task.id), ["good"]);
});
