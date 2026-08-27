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

async function browserContext() {
  if (context) return context;
  await mkdir(PROFILE_DIR, { recursive: true, mode: 0o700 });
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ["--start-maximized"]
  });
  context.on("close", () => { context = undefined; pages.clear(); });
  return context;
}

function livePage(provider) {
  const page = pages.get(provider);
  return page && !page.isClosed() ? page : undefined;
}

function signedIn(provider, page) {
  const url = page?.url() || "";
  return provider === "google"
    ? /^https:\/\/classroom\.google\.com\//i.test(url)
    : /oakgrovelutheran\.myschoolapp\.com/i.test(url) && !/#login(?:\/|$|\?)/i.test(url);
}

export async function openScraper(provider, { foreground = true } = {}) {
  validProvider(provider);
  const browser = await browserContext();
  let page = livePage(provider);
  if (!page) {
    page = browser.pages().find(candidate => !candidate.isClosed());
    if (!page) page = await browser.newPage();
    pages.clear();
    pages.set(provider, page);
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

function payload(provider, items) {
  const canonical = provider === "google" ? "google-classroom" : "blackbaud";
  const unique = new Map();
  for (const item of items) {
    if (!item.title || !item.course) continue;
    const rawId = String(item.sourceId || "");
    const id = rawId && rawId.length <= 180 && /^[\w:.-]+$/.test(rawId) ? rawId : createHash("sha256").update(rawId || `${item.course}|${item.title}|${item.due}`).digest("hex").slice(0, 20);
    unique.set(String(id), { ...item, sourceId: String(id), courseSourceId: String(item.courseSourceId || item.course), courseName: item.course });
  }
  const courses = [...new Map([...unique.values()].map(item => [item.courseSourceId, { sourceId: item.courseSourceId, name: item.course }])).values()];
  return { provider: canonical, syncedAt: new Date().toISOString(), courses, assignments: [...unique.values()] };
}

export function blackbaudAssignments(data) {
  const courseFrom = name => [
    ["Algebra 2", /\balgebra\s*(?:2|ii)\b/i], ["English 10", /\benglish\s*10\b/i],
    ["The Church", /\bthe\s+church\b/i], ["Chemistry", /\bchemistry\b/i],
    ["German 1", /\bgerman\s*(?:1|i)\b/i], ["Western Civ", /\bwestern\s+civ(?:ilization)?\b/i],
    ["Band", /\b(?:concert\s+band(?:\s+ensemble)?|band)\b/i]
  ].find(([, matcher]) => matcher.test(String(name || "")))?.[0] || "";
  const dateAndTime = value => {
    const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return { due: "", time: "23:59" };
    let hour = Number(match[4]) % 12;
    if (match[6].toUpperCase() === "PM") hour += 12;
    return { due: `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`, time: `${String(hour).padStart(2, "0")}:${match[5]}` };
  };
  const output = [];
  for (const group of Object.values(data || {})) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const sourceId = String(item?.AssignmentIndexId || "");
      const title = String(item?.ShortDescription || "").trim();
      const course = courseFrom(item?.GroupName);
      if (!sourceId || !title || !course) continue;
      output.push({
        sourceId,
        courseSourceId: String(item.SectionId || item.GroupName),
        course,
        title,
        ...dateAndTime(item.DateDue),
        type: String(item.AssignmentType || "Assignment"),
        completed: Number(item.AssignmentStatusType) === 1 || Number(item.StudentStatus) === 1 || Boolean(item.CollectedInd || item.ExemptInd || item.HasGrade),
        url: `https://oakgrovelutheran.myschoolapp.com/lms-assignment/assignment/assignment-student-view/${sourceId}`
      });
    }
  }
  return output;
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
  return payload("google", items);
}

async function scrapeBlackbaud(page) {
  if (!/oakgrovelutheran\.myschoolapp\.com/i.test(page.url())) throw new Error("Finish signing into My Oak Grove, then try again.");
  const data = await page.evaluate(async () => {
    const response = await fetch("/api/assignment2/StudentAssignmentCenterGet?displayByDueDate=true");
    if (!response.ok) throw new Error(`Blackbaud returned HTTP ${response.status}`);
    return response.json();
  });
  const items = blackbaudAssignments(data);
  return payload("blackbaud", items);
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
