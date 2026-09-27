import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAssignments } from "./api/assignments.mjs";

test("agent cache keeps only the documented assignment fields", () => {
  assert.deepEqual(normalizeAssignments([{
    title: "  Unit test  ",
    class: "Chemistry",
    due: "2026-09-30",
    status: "open",
    ignored: "not exposed"
  }]), [{ title: "Unit test", class: "Chemistry", due: "2026-09-30", status: "open" }]);
  assert.throws(() => normalizeAssignments([{ title: "Bad", class: "Chemistry", due: "", status: "unknown" }]), /Invalid assignment/);
});
