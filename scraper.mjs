import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { chromium } from "playwright";

const PROFILE_DIR = join(new URL(".", import.meta.url).pathname, ".data", "scraper-profile");
const PROVIDERS = {
  google: "https://classroom.google.com/a/not-turned-in/all",
  blackbaud: "https://oakgrovelutheran.myschoolapp.com/lms-assignment/assignment-center/student/?svcid=edu"
};

let context;
const pages = new Map();

function validProvider(provider) {
  if (!PROVIDERS[provider]) throw new Error("Unknown scraper provider");
}

async function createPage(browser) {
  try { return await browser.newPage(); }
  catch (error) {
    const opener = browser.pages().find(page => !page.isClosed());
    if (!opener) throw error;
    const page = browser.waitForEvent("page", { timeout: 5_000 });
    await opener.evaluate(() => window.open("about:blank", "_blank"));
    return page;
  }
}

async function browserContext() {
  if (context) return context;
  await mkdir(PROFILE_DIR, { recursive: true, mode: 0o700 });
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ["--start-maximized"]
  });
  while (context.pages().length < Object.keys(PROVIDERS).length) await createPage(context);
  context.on("close", () => { context = undefined; pages.clear(); });
  return context;
}

function livePage(provider) {
  const page = pages.get(provider);
  return page && !page.isClosed() ? page : undefined;
}

export async function assignProviderPage(provider, browser, registry = pages) {
  validProvider(provider);
  const assigned = new Set([...registry.values()].filter(page => !page.isClosed()));
  const page = browser.pages().find(candidate => !candidate.isClosed() && !assigned.has(candidate)) || await createPage(browser);
  registry.set(provider, page);
  return page;
}

export function signedIn(provider, page) {
  const url = page?.url() || "";
  let hostname = "";
  try { hostname = new URL(url).hostname; } catch {}
  return provider === "google"
    ? hostname === "classroom.google.com"
    : hostname === "oakgrovelutheran.myschoolapp.com" && !/#login(?:\/|$|\?)/i.test(url);
}

export async function openScraper(provider, { foreground = true } = {}) {
  validProvider(provider);
  const browser = await browserContext();
  let page = livePage(provider);
  if (!page) {
    page = await assignProviderPage(provider, browser);
    await page.goto(PROVIDERS[provider], { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  }
  if (foreground) await page.bringToFront();
  return { provider, url: page.url() };
}

export function scraperStatus() {
  return {
    available: true,
    browserOpen: Boolean(context),
    pages: Object.fromEntries(Object.keys(PROVIDERS).map(provider => {
      const page = livePage(provider);
      return [provider, page ? { open: true, signedIn: signedIn(provider, page), url: page.url() } : { open: false, signedIn: false, url: "" }];
    }))
  };
}

export async function closeScraper() {
  if (context) await context.close();
}

async function autoScroll(page) {
  let previous = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const height = await page.evaluate(() => {
      let maximum = document.documentElement.scrollHeight;
      for (const item of document.querySelectorAll('[role="main"], [class*="scroll"], main')) {
        item.scrollTop = item.scrollHeight;
        maximum = Math.max(maximum, item.scrollHeight);
      }
      window.scrollTo(0, document.body.scrollHeight);
      return maximum;
    });
    await page.waitForTimeout(250);
    if (height === previous) break;
    previous = height;
  }
}

export async function visibleAssignments(page, provider, completed = false) {
  return page.evaluate(({ provider, completed }) => {
    const classMatchers = [
      ["Algebra 2", /\balgebra\s*(?:2|ii)\b/i],
      ["English 10", /\benglish\s*10\b/i],
      ["The Church", /\bthe\s+church\b/i],
      ["Chemistry", /\bchemistry\b/i],
      ["German 1", /\bgerman\s*(?:1|i)\b/i],
      ["Western Civ", /\bwestern\s+civ(?:ilization)?\b/i],
      ["Band", /\bconcert\s+band(?:\s+ensemble)?\b/i]
    ];
    const clean = value => String(value || "").replace(/\s+/g, " ").trim();
    const textOf = element => clean([...element.childNodes].map(node => node.nodeType === 3 ? node.textContent : node.innerText).join(" "));
    const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const schoolYear = month => {
      const now = new Date();
      if (now.getMonth() >= 6) return month < 6 ? now.getFullYear() + 1 : now.getFullYear();
      return month >= 6 ? now.getFullYear() - 1 : now.getFullYear();
    };
    const dueFrom = text => {
      const now = new Date();
      const segment = text.match(/(?:due|missing|overdue)(?:\s+date)?\s*[:\-]?\s*([^\n|\u2022]{1,45})/i)?.[1];
      if (!segment || /\bno\s+due\s+date\b/i.test(text)) return "";
      if (/\btoday\b/i.test(segment)) return iso(now);
      if (/\btomorrow\b/i.test(segment)) return iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      if (/\byesterday\b/i.test(segment)) return iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
      const numeric = segment.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
      if (numeric) {
        const month = Number(numeric[1]) - 1;
        let year = numeric[3] ? Number(numeric[3]) : schoolYear(month);
        if (year < 100) year += 2000;
        const date = new Date(year, month, Number(numeric[2]), 12);
        if (!Number.isNaN(date.getTime())) return iso(date);
      }
      const named = segment.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
      if (named) {
        const month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(named[1].slice(0, 3).toLowerCase());
        const date = new Date(named[3] ? Number(named[3]) : schoolYear(month), month, Number(named[2]), 12);
        if (!Number.isNaN(date.getTime())) return iso(date);
      }
      return "";
    };
    const timeFrom = text => {
      const match = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
      if (!match) return "23:59";
      let hour = Number(match[1]) % 12;
      if (match[3].toUpperCase() === "PM") hour += 12;
      return `${String(hour).padStart(2, "0")}:${match[2]}`;
    };
    const courseFrom = text => classMatchers.find(([, matcher]) => matcher.test(text))?.[0] || "";
    const contextFor = element => {
      let current = element;
      let best = textOf(element);
      for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
        const text = textOf(current);
        if (text.length > best.length && text.length <= 1800) best = text;
        if (courseFrom(text) && /\b(due|missing|overdue|submitted|turned in|graded)\b/i.test(text)) return text;
      }
      return best;
    };
    const typeFrom = text => /\b(test|exam|assessment)\b/i.test(text) ? "Test" : /\bquiz\b/i.test(text) ? "Quiz" : /\bproject\b/i.test(text) ? "Project" : "Assignment";
    const output = [];

    if (provider === "google") {
      for (const anchor of document.querySelectorAll('a[href*="/c/"][href*="/a/"]')) {
        const url = anchor.href;
        const match = url.match(/\/c\/([^/]+)\/a\/([^/?#]+)/);
        const lines = String(anchor.innerText || "").split("\n").map(clean).filter(Boolean);
        const title = lines[1] || "";
        if (!match || title.length < 2 || title.length > 180) continue;
        const course = courseFrom(lines[2]);
        if (!course) continue;
        const details = lines.slice(3).join(" ");
        const due = /\bposted\b/i.test(details) ? "" : dueFrom(`Due ${details}`);
        output.push({ sourceId: `${match[1]}:${match[2]}`, course, title, due, time: timeFrom(details), type: typeFrom(title), completed, url });
      }
    } else {
      for (const anchor of document.querySelectorAll('a[href*="/lms-assignment/assignment/"]')) {
        const root = anchor.closest('.month-event, .cell-week-day-view-event, [class*="assignment-card" i], tr, [role="row"], article, li') || anchor.parentElement;
        const context = textOf(root);
        const course = courseFrom(context);
        const title = clean(anchor.innerText || anchor.getAttribute("aria-label"));
        if (!course || !title) continue;
        const url = anchor.href;
        const identity = url.match(/(?:assignment|assessment)[^0-9]*(\d+)/i)?.[1] || clean(`${course}|${title}|${dueFrom(context)}`).toLowerCase();
        let due = dueFrom(context);
        const cell = anchor.closest("mwl-calendar-month-cell");
        const day = Number(clean(cell?.innerText).match(/^\d{1,2}/)?.[0]);
        if (!due && day) {
          const now = new Date();
          let month = now.getMonth();
          if (cell.classList.contains("cal-out-month")) month += day < 15 ? 1 : -1;
          due = iso(new Date(now.getFullYear(), month, day, 12));
        }
        output.push({ sourceId: identity, course, title, due, time: timeFrom(context), type: typeFrom(context), completed: /\b(complete|submitted|turned in|graded)\b/i.test(context), url });
      }
    }
    return output;
  }, { provider, completed });
}

export async function googleAssignmentDetails(page, item) {
  const details = await page.evaluate(({ title, assignmentUrl }) => {
    const clean = value => String(value || "").replace(/\s+/g, " ").trim();
    const root = document.querySelector('main, [role="main"]') || document.body;
    const candidates = [...root.querySelectorAll('p, div, [aria-label]')]
      .filter(element => !element.closest('nav, aside, button, [role="button"]'))
      .map(element => {
        const text = clean(element.innerText);
        const label = clean(element.getAttribute("aria-label"));
        const whiteSpace = getComputedStyle(element).whiteSpace;
        const score = (/instruction|description/i.test(label) ? 100 : 0) + (/pre-wrap|pre-line/.test(whiteSpace) ? 20 : 0) + (element.tagName === "P" ? 10 : 0);
        return { text, score };
      })
      .filter(candidate => candidate.score >= 10 && candidate.text.length >= 2 && candidate.text.length <= 10_000 && candidate.text !== title && !/^(?:due|points?|class comments?|private comments?|your work|turn in|mark as done)\b/i.test(candidate.text))
      .sort((a, b) => b.score - a.score || b.text.length - a.text.length);
    const seen = new Set();
    const attachments = [];
    for (const anchor of root.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(anchor.href); } catch { continue; }
      const name = clean(anchor.innerText || anchor.getAttribute("aria-label") || anchor.title);
      if (url.protocol !== "https:" || url.href === assignmentUrl || !name || name.length > 120 || seen.has(url.href)) continue;
      if (/^(?:home|calendar|settings|google apps|open in new window)$/i.test(name) || /(?:accounts\.google\.com|google\.com\/intl\/)/i.test(url.href)) continue;
      seen.add(url.href);
      attachments.push({ name, url: url.href });
      if (attachments.length === 20) break;
    }
    return { description: candidates[0]?.text || "", attachments };
  }, { title: item.title, assignmentUrl: item.url });
  details.attachments = details.attachments.map(attachment => ({
    id: `google-${createHash("sha256").update(attachment.url).digest("hex").slice(0, 20)}`,
    ...attachment
  }));
  return details;
}

function blackbaudCourseName(name) {
  return [
    ["Algebra 2", /\balgebra\s*(?:2|ii)\b/i], ["English 10", /\benglish\s*10\b/i],
    ["The Church", /\bthe\s+church\b/i], ["Chemistry", /\bchemistry\b/i],
    ["German 1", /\bgerman\s*(?:1|i)\b/i], ["Western Civ", /\bwestern\s+civ(?:ilization)?\b/i],
    ["Band", /\b(?:concert\s+band(?:\s+ensemble)?|band)\b/i]
  ].find(([, matcher]) => matcher.test(String(name || "")))?.[0] || "";
}

function blackbaudDateAndTime(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
  if (!match) return { due: "", time: "23:59" };
  let time = "23:59";
  if (match[4]) {
    let hour = Number(match[4]) % 12;
    if (match[6].toUpperCase() === "PM") hour += 12;
    time = `${String(hour).padStart(2, "0")}:${match[5]}`;
  }
  return { due: `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`, time };
}

function payload(provider, items, extra = {}) {
  const canonical = provider === "google" ? "google-classroom" : "blackbaud";
  const unique = new Map();
  for (const item of items) {
    if (!item.title || !item.course) continue;
    const rawId = String(item.sourceId || "");
    const id = rawId && rawId.length <= 180 && /^[\w:.-]+$/.test(rawId) ? rawId : createHash("sha256").update(rawId || `${item.course}|${item.title}|${item.due}`).digest("hex").slice(0, 20);
    unique.set(String(id), { ...item, sourceId: String(id), courseSourceId: String(item.courseSourceId || item.course), courseName: item.course });
  }
  const allCourseItems = [...unique.values(), ...(extra.grades || []), ...(extra.courseGrades || [])];
  const courses = [...new Map(allCourseItems.filter(item => item.course && item.courseSourceId).map(item => [String(item.courseSourceId), { sourceId: String(item.courseSourceId), name: item.course }])).values()];
  return { provider: canonical, syncedAt: new Date().toISOString(), courses, assignments: [...unique.values()], ...extra };
}

export function blackbaudAssignments(data) {
  const output = [];
  for (const group of Object.values(data || {})) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const sourceId = String(item?.AssignmentIndexId || "");
      const title = String(item?.ShortDescription || "").trim();
      const course = blackbaudCourseName(item?.GroupName);
      if (!sourceId || !title || !course) continue;
      output.push({
        sourceId,
        courseSourceId: String(item.SectionId || item.GroupName),
        course,
        title,
        ...blackbaudDateAndTime(item.DateDue),
        type: String(item.AssignmentType || "Assignment"),
        completed: Number(item.AssignmentStatusType) === 1 || Number(item.StudentStatus) === 1 || Boolean(item.CollectedInd || item.ExemptInd || item.HasGrade),
        url: `https://oakgrovelutheran.myschoolapp.com/lms-assignment/assignment/assignment-student-view/${sourceId}`
      });
    }
  }
  return output;
}

export function blackbaudGrades(data) {
  const grades = [];
  const courseGrades = [];
  const gradebooks = new Map((data?.gradebooks || []).map(item => [String(item.sectionId), item.data]));
  for (const section of data?.classes || []) {
    const sectionId = String(section?.sectionid || section?.SectionId || section?.leadsectionid || section?.LeadSectionId || "");
    const course = blackbaudCourseName(section?.sectionidentifier || section?.SectionIdentifier || section?.groupname || section?.GroupName);
    const book = gradebooks.get(sectionId);
    if (!sectionId || !course || !book) continue;
    const roster = book.Roster?.[0] || {};
    const rawPercent = roster.SectionGrade ?? section.cumgrade ?? section.CumGrade;
    const percent = rawPercent === null || rawPercent === "" || rawPercent === undefined ? Number.NaN : Number(rawPercent);
    if (Number.isFinite(percent)) courseGrades.push({
      courseSourceId: sectionId,
      course,
      percent: Math.round(percent * 100) / 100,
      period: String(section.currentterm || section.CurrentTerm || "Current marking period").slice(0, 80),
      calculationMethod: Number(book.Summary?.CalculationMethod) || 0
    });
    const assignments = new Map((book.Assignments || []).map(item => [String(item.AssignmentId), item]));
    for (const result of roster.AssignmentGrades || []) {
      const assignment = assignments.get(String(result.AssignmentId));
      const score = result.PointsEarned === null || result.PointsEarned === "" || result.PointsEarned === undefined ? Number.NaN : Number(result.PointsEarned);
      const pointsPossible = Number(result.MaxPoints ?? assignment?.MaxPoints);
      if (!assignment || assignment.PublishGrade === false || result.Exempt || !Number.isFinite(score) || !(pointsPossible > 0)) continue;
      const sourceId = String(result.AssignmentIndexId || assignment.AssignmentIndexId || result.AssignmentId || "");
      const title = String(assignment.AssignShort || assignment.AssignmentName || "").trim();
      if (!sourceId || !title) continue;
      grades.push({
        sourceId,
        courseSourceId: sectionId,
        course,
        title,
        score,
        pointsPossible,
        date: blackbaudDateAndTime(assignment.SortDateDue || assignment.DateDue).due,
        type: String(assignment.AssignmentType || result.AssignmentType || "Assignment").slice(0, 30)
      });
    }
  }
  return { grades, courseGrades };
}

async function scrapeGoogle(page) {
  const items = [];
  for (const [path, completed] of [["not-turned-in", false], ["missing", false], ["turned-in", true]]) {
    await page.goto(`https://classroom.google.com/a/${path}/all`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
    if (!page.url().startsWith("https://classroom.google.com/")) throw new Error("Finish signing into Google Classroom in the scraper browser, then try again.");
    await page.waitForTimeout(1_000);
    await autoScroll(page);
    items.push(...await visibleAssignments(page, "google", completed));
  }
  for (const item of new Map(items.filter(item => !item.completed).map(item => [item.sourceId, item])).values()) {
    try {
      await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(600);
      Object.assign(item, await googleAssignmentDetails(page, item));
    } catch {}
  }
  return payload("google", items);
}

async function scrapeBlackbaud(page) {
  if (!/oakgrovelutheran\.myschoolapp\.com/i.test(page.url())) throw new Error("Finish signing into My Oak Grove, then try again.");
  const data = await page.evaluate(async () => {
    const get = async path => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Blackbaud returned HTTP ${response.status}`);
      return response.json();
    };
    const assignments = await get("/api/assignment2/StudentAssignmentCenterGet?displayByDueDate=true");
    const status = await get("/api/webapp/userstatus");
    const userId = status.UserId || status.userId;
    const years = await get("/api/datadirect/StudentGradeLevelList/");
    const currentYear = years.find(item => item.CurrentInd || item.currentInd) || years[0];
    const schoolYear = currentYear?.SchoolYearLabel || currentYear?.schoolYearLabel;
    if (!userId || !schoolYear) return { assignments, grades: { classes: [], gradebooks: [] } };
    const terms = await get(`/api/DataDirect/StudentGroupTermList/?studentUserId=${encodeURIComponent(userId)}&schoolYearLabel=${encodeURIComponent(schoolYear)}&personaId=2`);
    const currentTerm = terms.find(item => item.CurrentInd || item.currentInd) || terms[0];
    const durationId = currentTerm?.DurationId || currentTerm?.durationId;
    if (!durationId) return { assignments, grades: { classes: [], gradebooks: [] } };
    const classes = await get(`/api/datadirect/ParentStudentUserClassesGet?userId=${encodeURIComponent(userId)}&schoolYearLabel=${encodeURIComponent(schoolYear)}&memberLevel=3&persona=2&durationList=${encodeURIComponent(durationId)}&markingPeriodId=`);
    const gradebooks = await Promise.all(classes.map(async section => {
      const sectionId = section.sectionid || section.SectionId || section.leadsectionid || section.LeadSectionId;
      const markingPeriodId = section.markingperiodid || section.MarkingPeriodId || "";
      if (!sectionId) return { sectionId: "", data: null };
      try {
        const book = await get(`/api/gradebook/hydrategradebook?sectionId=${encodeURIComponent(sectionId)}&markingPeriodId=${encodeURIComponent(markingPeriodId)}&sortAssignmentId=null&sortSkillPk=null&sortDesc=null&sortCumulative=null&studentUserId=${encodeURIComponent(userId)}&fromProgress=true`);
        return { sectionId, data: book };
      } catch { return { sectionId, data: null }; }
    }));
    return { assignments, grades: { classes, gradebooks } };
  });
  const items = blackbaudAssignments(data.assignments);
  return payload("blackbaud", items, blackbaudGrades(data.grades));
}

export async function runScraper(provider, { foreground = true } = {}) {
  validProvider(provider);
  const page = livePage(provider);
  if (!page) throw new Error(`Open the ${provider === "google" ? "Google Classroom" : "My Oak Grove"} sign-in browser first.`);
  if (foreground) await page.bringToFront();
  return provider === "google" ? scrapeGoogle(page) : scrapeBlackbaud(page);
}

export async function inspectScraper(provider) {
  validProvider(provider);
  const page = livePage(provider);
  if (!page) throw new Error("The scraper browser is not open");
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    headings: [...document.querySelectorAll("h1, h2, h3")].slice(0, 30).map(item => String(item.innerText || "").trim()).filter(Boolean),
    rows: [...document.querySelectorAll('tr, [role="row"], article, li')].map(item => String(item.innerText || "").replace(/\s+/g, " ").trim()).filter(text => text.length >= 5 && text.length <= 500).slice(0, 80),
    links: [...document.querySelectorAll("a[href]")].map(item => ({
      text: String(item.innerText || item.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
      lines: String(item.innerText || "").split("\n").map(value => value.trim()).filter(Boolean),
      ariaLabel: item.getAttribute("aria-label") || "",
      href: item.href
    })).filter(item => item.text || /classroom\.google\.com|myschoolapp\.com/i.test(item.href)).slice(0, 120)
  }));
}
