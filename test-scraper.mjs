import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blackbaudAssignments, googleAssignmentDetails, signedIn, visibleAssignments } from "./scraper.mjs";

test("Blackbaud redirect URLs are not mistaken for signed-in school pages", () => {
  assert.equal(signedIn("blackbaud", { url: () => "https://app.blackbaud.com/signin/?redirectUrl=https%3A%2F%2Foakgrovelutheran.myschoolapp.com" }), false);
  assert.equal(signedIn("blackbaud", { url: () => "https://oakgrovelutheran.myschoolapp.com/app/student" }), true);
});

test("scraper extracts real classes, dates, and stable IDs", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`<base href="https://classroom.google.com"><main>
      <a href="/c/course-1/a/work-1/details"><div>assignment</div><div>Chapter 4 Review!</div><div>Algebra II - 8 - 26-27</div><div>Saturday, Aug 29, 2026 at 10:00 AM</div></a>
      <a href="/c/old-course/a/old-work/details"><div>assignment</div><div>Old scale sheet</div><div>06 BAND</div><div>Posted Monday, May 20, 2024</div></a>
    </main>`);
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

test("Google detail parsing extracts teacher instructions and useful attachments", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`<base href="https://classroom.google.com"><main>
      <h1>Cell Model</h1>
      <div aria-label="Assignment instructions">Build a labeled model. Explain how each organelle helps the cell.</div>
      <a href="https://docs.google.com/document/d/model-guide/edit">Cell model guide</a>
      <a href="https://classroom.google.com/c/course/a/work/details">Cell Model</a>
      <a href="https://accounts.google.com/SignOutOptions">Google Account</a>
    </main>`);
    const details = await googleAssignmentDetails(page, { title: "Cell Model", url: "https://classroom.google.com/c/course/a/work/details" });
    assert.equal(details.description, "Build a labeled model. Explain how each organelle helps the cell.");
    assert.deepEqual(details.attachments.map(({ name, url }) => ({ name, url })), [{ name: "Cell model guide", url: "https://docs.google.com/document/d/model-guide/edit" }]);
    assert.match(details.attachments[0].id, /^google-[a-f0-9]{20}$/);
  } finally { await browser.close(); }
});
