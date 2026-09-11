const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeImported, classKey, migrateState } = require("./sync.js");

function workspace() {
  return {
    profile: { name: "" },
    courses: [{ id: "algebra-2", name: "Algebra 2", teacher: "", room: "", color: "#ddd5f4", schedule: [] }],
    tasks: [],
    sessions: [],
    gradeItems: [],
    courseGrades: {}
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
      { sourceId: "g-course:g-work", courseSourceId: "g-course", courseName: "Algebra II - Period 1", title: "Chapter 4 Review!", due: "2026-09-01", time: "10:00", type: "Assignment", description: "Show every step.", attachments: [{ id: "google-guide", name: "Review guide", url: "https://docs.google.com/document/d/guide/edit" }] },
      { sourceId: "g-course:g-work", courseSourceId: "g-course", courseName: "Algebra II - Period 1", title: "Chapter 4 Review!", due: "2026-09-01", time: "10:00", type: "Assignment" }
    ]
  };
  mergeImported(state, google, ids);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.courses.length, 1);
  assert.equal(state.tasks[0].teacherInstructions, "Show every step.");
  assert.deepEqual(state.tasks[0].attachments, [{ id: "google-guide", name: "Review guide", url: "https://docs.google.com/document/d/guide/edit" }]);
  state.tasks[0].attachments.push({ id: "manual-notes", name: "My notes", url: "https://example.com/notes" });
  state.tasks[0].completed = true;

  mergeImported(state, google, ids);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].completed, true);
  assert.equal(state.tasks[0].attachments.length, 2);

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

test("decodes HTML entities in imported assignment titles", () => {
  const state = workspace();
  mergeImported(state, {
    provider: "blackbaud",
    courses: [{ sourceId: "chemistry", name: "Algebra 2" }],
    assignments: [{ sourceId: "work-1", courseSourceId: "chemistry", title: "Electron Configuration (long&amp;short)", due: "2026-09-21" }]
  }, () => "1");
  assert.equal(state.tasks[0].title, "Electron Configuration (long&short)");
});

test("automatic grades update without duplicates and keep Blackbaud's official total", () => {
  const state = workspace();
  let id = 0;
  const ids = () => String(++id);
  const payload = {
    provider: "blackbaud",
    syncedAt: "2026-09-11T22:00:00Z",
    courses: [{ sourceId: "section-8", name: "Algebra 2" }],
    assignments: [],
    grades: [{ sourceId: "grade-11", courseSourceId: "section-8", course: "Algebra 2", title: "Unit quiz", score: 18, pointsPossible: 20, date: "2026-09-10", type: "Quiz" }],
    courseGrades: [{ courseSourceId: "section-8", course: "Algebra 2", percent: 84.48, period: "1st Semester", calculationMethod: 3 }]
  };

  const first = mergeImported(state, payload, ids);
  payload.grades[0].score = 19;
  payload.courseGrades[0].percent = 86.2;
  payload.syncedAt = "2026-09-11T22:05:00Z";
  const second = mergeImported(state, payload, ids);

  assert.equal(first.gradesImported, 1);
  assert.equal(second.gradesUpdated, 1);
  assert.equal(state.gradeItems.length, 1);
  assert.equal(state.gradeItems[0].score, 19);
  assert.equal(state.courseGrades["algebra-2"].percent, 86.2);
  assert.equal(state.courseGrades["algebra-2"].calculationMethod, 3);
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
