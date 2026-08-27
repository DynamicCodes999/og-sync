import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blackbaudAssignments, visibleAssignments } from "./scraper.mjs";

test("scraper extracts real classes, dates, and stable IDs", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`<base href="https://classroom.google.com"><main><article>
      <a href="/c/course-1/a/work-1/details">Chapter 4 Review!</a>
      <span>Algebra II</span><span>Due Aug 29, 2026 at 10:00 AM</span>
    </article></main>`);
    const google = await visibleAssignments(page, "google");
    assert.deepEqual(google.map(({ sourceId, course, title, due, time }) => ({ sourceId, course, title, due, time })), [{
      sourceId: "course-1:work-1",
      course: "Algebra 2",
      title: "Chapter 4 Review!",
      due: "2026-08-29",
      time: "10:00"
    }]);

    await page.setContent(`<table>
      <tr class="assignment-row"><td>Chemistry</td><td><a href="https://oakgrovelutheran.myschoolapp.com/lms-assignment/assignment/assignment-student-view/7788">Lab Safety Test</a></td><td>Due: 8/30/2026 1:30 PM</td></tr>
      <tr class="assignment-row"><td>Concert Band Ensemble - 6</td><td><a href="https://oakgrovelutheran.myschoolapp.com/lms-assignment/assignment/assignment-student-view/8899">Practice scales</a></td><td>Due: 8/31/2026</td></tr>
    </table>`);
    const blackbaud = await visibleAssignments(page, "blackbaud");
    assert.equal(blackbaud.length, 2);
    assert.equal(blackbaud[0].sourceId, "7788");
    assert.equal(blackbaud[0].course, "Chemistry");
    assert.equal(blackbaud[0].due, "2026-08-30");
    assert.equal(blackbaud[0].time, "13:30");
    assert.equal(blackbaud[1].course, "Band");
  } finally { await browser.close(); }
});

test("Blackbaud API parsing includes future Band work", () => {
  const items = blackbaudAssignments({ DueAfterNextWeek: [{
    GroupName: "Concert Band - 2", SectionId: 90275949, AssignmentIndexId: 17070595,
    ShortDescription: "Syllabus", DateDue: "9/14/2026 11:20 AM", AssignmentType: "Participation",
    AssignmentStatusType: -1, StudentStatus: -2147483648
  }] });
  assert.deepEqual(items.map(({ sourceId, courseSourceId, course, title, due, time, completed }) => ({ sourceId, courseSourceId, course, title, due, time, completed })), [{
    sourceId: "17070595", courseSourceId: "90275949", course: "Band", title: "Syllabus", due: "2026-09-14", time: "11:20", completed: false
  }]);
});
