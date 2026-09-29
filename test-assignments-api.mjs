import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAssignments, normalizeMaterials } from "./api/assignments.mjs";

test("agent cache validates detailed assignments and class materials", () => {
  const [assignment] = normalizeAssignments([{
    title: "  Unit test  ",
    class: "Chemistry",
    due: "2026-09-30",
    status: "open",
    teacherInstructions: "Review flame colors.",
    resources: [{ name: "Lab guide", url: "https://example.com/lab.pdf", kind: "file" }],
    ignored: "not exposed"
  }]);
  assert.equal(assignment.title, "Unit test");
  assert.equal(assignment.teacherInstructions, "Review flame colors.");
  assert.deepEqual(assignment.resources, [{ name: "Lab guide", url: "https://example.com/lab.pdf", kind: "file" }]);
  assert.deepEqual(normalizeMaterials([{ title: "Unit review", class: "Chemistry", url: "https://classroom.google.com/material", resources: [] }]), [{ title: "Unit review", class: "Chemistry", description: "", url: "https://classroom.google.com/material", resources: [] }]);
  assert.throws(() => normalizeAssignments([{ title: "Bad", class: "Chemistry", due: "", status: "unknown" }]), /Invalid assignment/);
  assert.throws(() => normalizeMaterials([{ title: "Bad", class: "Chemistry", resources: [{ name: "Unsafe", url: "http://example.com" }] }]), /Invalid URL/);
});
