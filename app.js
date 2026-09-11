const STORE_KEY = "daymark-state-v2";
const CLOUD_KEY_STORE = "daymark-cloud-key-v1";
const FOCUS_PLAN_STORE = "daymark-focus-plan-v1";
const THEME_STORE = "og-sync-theme-v1";
const TIMER_ALERT_STORE = "og-sync-timer-alert-v1";
const DAY = 86_400_000;
const HOSTED = !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

const icons = {
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
  bellOff: '<svg viewBox="0 0 24 24"><path d="m3 3 18 18M18 8a6 6 0 0 0-9.3-5M6 8c0 7-3 7-3 9h14M10 21h4"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>'
};

let theme = localStorage.getItem(THEME_STORE) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
if (!["light", "dark"].includes(theme)) theme = "light";
document.documentElement.dataset.theme = theme;
let timerAlerts = localStorage.getItem(TIMER_ALERT_STORE) !== "off";
let timerAudio;

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(amount, from = new Date()) {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + amount, 12);
  return dateKey(next);
}

function defaultState() {
  return {
    profile: { name: "" },
    courses: [
      { id: "algebra-2", name: "Algebra 2", teacher: "", room: "", color: "#ddd5f4", schedule: [] },
      { id: "english-10", name: "English 10", teacher: "", room: "", color: "#f2d6a2", schedule: [] },
      { id: "the-church", name: "The Church", teacher: "", room: "", color: "#d9e8c7", schedule: [] },
      { id: "chemistry", name: "Chemistry", teacher: "", room: "", color: "#cae8d7", schedule: [] },
      { id: "german-1", name: "German 1", teacher: "", room: "", color: "#f3d6dc", schedule: [] },
      { id: "western-civ", name: "Western Civ", teacher: "", room: "", color: "#cfe1f4", schedule: [] },
      { id: "band", name: "Band", teacher: "", room: "", color: "#d7dded", schedule: [] }
    ],
    tasks: [],
    sessions: [],
    gradeItems: [],
    courseGrades: {},
    schoolSchedule: { rotationLabels: ["A", "B"], anchorDate: "" },
    sync: {},
    tombstones: { tasks: {}, courses: {}, sessions: {}, grades: {}, sources: {} }
  };
}

function ensureTombstones(target) {
  target.sync ||= {};
  target.gradeItems ||= [];
  target.courseGrades ||= {};
  delete target.gradeGoals;
  target.schoolSchedule ||= { rotationLabels: ["A", "B"], anchorDate: "" };
  target.tombstones ||= {};
  for (const key of ["tasks", "courses", "sessions", "grades", "sources"]) target.tombstones[key] ||= {};
  for (const task of target.tasks || []) {
    task.notes ||= "";
    task.teacherInstructions ||= task.description || "";
    task.subtasks ||= [];
    task.attachments ||= [];
  }
  return target;
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
    if (validState(parsed)) {
      ensureTombstones(parsed);
      let changed = window.DaymarkSync.migrateState(parsed) > 0;
      if (!parsed.courses.some(course => /^(?:concert\s+)?band$/i.test(course.name.trim()))) {
        parsed.courses.push({ id: "band", name: "Band", teacher: "", room: "", color: "#d7dded", schedule: [] });
        changed = true;
      }
      if (changed) localStorage.setItem(STORE_KEY, JSON.stringify(parsed));
      return parsed;
    }
  } catch (_) {}
  return defaultState();
}

function validState(data) {
  const id = value => typeof value === "string" && /^[\w-]{1,64}$/.test(value);
  const text = (value, max) => typeof value === "string" && value.length <= max;
  const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDate(value).getTime());
  const time = value => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const optionalText = (value, max) => value === undefined || text(value, max);
  const sources = value => value === undefined || (Array.isArray(value) && value.length <= 10 && value.every(source => source && /^[a-z0-9-]{1,30}$/.test(source.provider) && text(source.id, 200)));
  if (!data || !text(data.profile?.name, 30) || !Array.isArray(data.courses) || data.courses.length > 30 || !Array.isArray(data.tasks) || data.tasks.length > 5000 || !Array.isArray(data.sessions) || data.sessions.length > 5000) return false;
  if (!data.courses.every(course => id(course.id) && text(course.name, 80) && text(course.teacher, 80) && text(course.room, 40) && /^#[0-9a-f]{6}$/i.test(course.color) && sources(course.sources) && Array.isArray(course.schedule) && course.schedule.length <= 20 && course.schedule.every(slot => Number.isInteger(slot.day) && slot.day >= 0 && slot.day <= 6 && time(slot.start) && time(slot.end) && optionalText(slot.period, 20) && optionalText(slot.rotation, 10)))) return false;
  const courseIds = new Set(data.courses.map(course => course.id));
  if (!data.tasks.every(task => id(task.id) && text(task.title, 100) && (courseIds.has(task.courseId) || task.courseId === "personal") && (task.due === "" || date(task.due)) && time(task.time) && text(task.type, 30) && Number.isFinite(task.estimate) && task.estimate >= 0 && task.estimate <= 1440 && ["low", "normal", "high"].includes(task.priority) && typeof task.completed === "boolean" && sources(task.sources) && (task.url === undefined || task.url === "" || (text(task.url, 2000) && /^https:\/\//.test(task.url))) && optionalText(task.description, 5000) && optionalText(task.notes, 5000) && optionalText(task.teacherInstructions, 10000) && (task.subtasks === undefined || (Array.isArray(task.subtasks) && task.subtasks.length <= 100 && task.subtasks.every(item => id(item.id) && text(item.title, 120) && typeof item.completed === "boolean"))) && (task.attachments === undefined || (Array.isArray(task.attachments) && task.attachments.length <= 20 && task.attachments.every(item => id(item.id) && text(item.name, 120) && text(item.url, 2000) && /^https:\/\//.test(item.url)))))) return false;
  if (!data.sessions.every(session => id(session.id) && date(session.date) && Number.isFinite(session.minutes) && session.minutes >= 0 && session.minutes <= 1440 && text(session.label, 100))) return false;
  if (data.gradeItems !== undefined && (!Array.isArray(data.gradeItems) || data.gradeItems.length > 1000 || !data.gradeItems.every(item => id(item.id) && courseIds.has(item.courseId) && text(item.title, 100) && Number.isFinite(item.score) && item.score >= 0 && item.score <= 100000 && Number.isFinite(item.pointsPossible) && item.pointsPossible > 0 && item.pointsPossible <= 100000 && (item.date === "" || date(item.date)) && optionalText(item.type, 30) && optionalText(item.syncedAt, 40) && sources(item.sources)))) return false;
  if (data.courseGrades !== undefined && (!data.courseGrades || typeof data.courseGrades !== "object" || Array.isArray(data.courseGrades) || Object.keys(data.courseGrades).length > 30 || !Object.entries(data.courseGrades).every(([courseId, grade]) => courseIds.has(courseId) && grade && Number.isFinite(grade.percent) && grade.percent >= 0 && grade.percent <= 200 && text(grade.period, 80) && /^[a-z0-9-]{1,30}$/.test(grade.provider) && Number.isFinite(Date.parse(grade.syncedAt)) && Number.isFinite(grade.calculationMethod)))) return false;
  if (data.schoolSchedule !== undefined && (!data.schoolSchedule || !Array.isArray(data.schoolSchedule.rotationLabels) || data.schoolSchedule.rotationLabels.length !== 2 || !data.schoolSchedule.rotationLabels.every(label => text(label, 10) && label.trim()) || !(data.schoolSchedule.anchorDate === "" || date(data.schoolSchedule.anchorDate)))) return false;
  const validMap = value => value === undefined || (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= 5000 && Object.entries(value).every(([key, stamp]) => key.length <= 300 && Number.isFinite(Date.parse(stamp))));
  return data.tombstones === undefined || (data.tombstones && ["tasks", "courses", "sessions", "grades", "sources"].every(key => validMap(data.tombstones[key])));
}

let state = loadState();
let plannerView = "open";
let plannerCourse = "all";
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDate = dateKey();
let toastTimer;
let savedFocusPlan;
try { savedFocusPlan = JSON.parse(localStorage.getItem(FOCUS_PLAN_STORE) || "{}"); } catch { savedFocusPlan = {}; }
const focusPlan = window.DaymarkSchool.normalizeFocusPlan(savedFocusPlan);
const timer = { phase: "work", plan: focusPlan, block: 1, total: focusPlan.work * 60, remaining: focusPlan.work * 60, running: false, deadline: 0, interval: null, taskId: "" };

const app = document.querySelector("#app-content");
const taskModal = document.querySelector("#task-modal");
const searchModal = document.querySelector("#search-modal");
const profileModal = document.querySelector("#profile-modal");
const classModal = document.querySelector("#class-modal");
const taskDetailModal = document.querySelector("#task-detail-modal");
const scheduleModal = document.querySelector("#schedule-modal");
const cloudModal = document.querySelector("#cloud-modal");
let detailDraft;
const cloud = {
  key: HOSTED ? localStorage.getItem(CLOUD_KEY_STORE) || "" : "",
  revision: null,
  ready: !HOSTED,
  dirty: false,
  saving: false,
  timer: null,
  retryTimer: null
};
if (cloud.key) cloud.ready = true;

function save() {
  ensureTombstones(state);
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (HOSTED && cloud.ready && cloud.key) {
    cloud.dirty = true;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(pushCloudState, 500);
  }
}

function e(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function courseFor(id) {
  return state.courses.find(course => course.id === id) || { name: "Personal", color: "#d9ddd5", teacher: "", room: "" };
}

function parseDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dueTimestamp(task) {
  if (!task.due) return Number.POSITIVE_INFINITY;
  return new Date(`${task.due}T${task.time || "23:59"}:00`).getTime();
}

function sortTasks(tasks) {
  const priority = { high: 0, normal: 1, low: 2 };
  return [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || dueTimestamp(a) - dueTimestamp(b) || priority[a.priority] - priority[b.priority]);
}

function isAssessment(task) {
  return window.DaymarkSchool.isAssessment(task);
}

function relativeDate(key) {
  if (!key) return "No due date";
  const delta = Math.round((parseDate(key) - parseDate(dateKey())) / DAY);
  if (delta === -1) return "Yesterday";
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta > 1 && delta < 7) return parseDate(key).toLocaleDateString(undefined, { weekday: "long" });
  return parseDate(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(value) {
  if (!value || value === "23:59") return "End of day";
  const [hour, minute] = value.split(":").map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function updateThemeButton() {
  const button = document.querySelector("#theme-button");
  if (!button) return;
  const nextTheme = theme === "dark" ? "light" : "dark";
  button.innerHTML = theme === "dark" ? icons.sun : icons.moon;
  button.setAttribute("aria-label", `Use ${nextTheme} mode`);
  button.title = `Use ${nextTheme} mode`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#111310" : "#f7f7f3");
}

function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORE, theme);
  updateThemeButton();
}

function prepareTimerAudio() {
  if (!timerAlerts) return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  timerAudio ||= new AudioContext();
  if (timerAudio.state === "suspended") timerAudio.resume().catch(() => {});
  return timerAudio;
}

function playTimerBell() {
  const context = prepareTimerAudio();
  if (!context) return;
  const start = context.currentTime;
  [0, .16].forEach((delay, index) => {
    const tone = context.createOscillator();
    const volume = context.createGain();
    tone.type = "sine";
    tone.frequency.value = index ? 880 : 660;
    volume.gain.setValueAtTime(0.0001, start + delay);
    volume.gain.exponentialRampToValueAtTime(.2, start + delay + .015);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + delay + .22);
    tone.connect(volume).connect(context.destination);
    tone.start(start + delay);
    tone.stop(start + delay + .23);
  });
}

function announceTimerTransition(title, body) {
  if (!timerAlerts) return;
  playTimerBell();
  if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification(title, { body, icon: "./OG_Sync.svg" });
}

async function toggleTimerAlerts() {
  timerAlerts = !timerAlerts;
  localStorage.setItem(TIMER_ALERT_STORE, timerAlerts ? "on" : "off");
  if (timerAlerts) {
    prepareTimerAudio();
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission().catch(() => {});
  }
  if (currentPage() === "focus") renderFocus();
  showToast(timerAlerts ? "Timer bell is on." : "Timer bell is off.");
}

function cloudHeaders() {
  return { Accept: "application/json", Authorization: `Bearer ${cloud.key}`, "Content-Type": "application/json" };
}

function setCloudLabel(message) {
  const label = document.querySelector(".profile-button small");
  if (label) label.textContent = HOSTED ? message : "Local workspace";
}

function newestTombstones(first = {}, second = {}) {
  const result = { ...first };
  for (const [key, value] of Object.entries(second)) {
    if (!result[key] || Date.parse(value) > Date.parse(result[key])) result[key] = value;
  }
  return result;
}

function mergeById(remote, local) {
  const merged = new Map(remote.map(item => [item.id, structuredClone(item)]));
  for (const item of local) merged.set(item.id, structuredClone(item));
  return [...merged.values()];
}

function mergeCourseGrades(remote = {}, local = {}) {
  const merged = structuredClone(remote);
  for (const [courseId, grade] of Object.entries(local)) {
    if (!merged[courseId] || Date.parse(grade.syncedAt) >= Date.parse(merged[courseId].syncedAt)) merged[courseId] = structuredClone(grade);
  }
  return merged;
}

function applyTombstones(target) {
  ensureTombstones(target);
  const deleted = target.tombstones;
  target.tasks = target.tasks.filter(task => !deleted.tasks[task.id] && !(task.sources || []).some(source => deleted.sources[window.DaymarkSync.sourceKey(source.provider, source.id)]));
  target.sessions = target.sessions.filter(session => !deleted.sessions[session.id]);
  target.gradeItems = target.gradeItems.filter(item => !deleted.grades[item.id]);
  const usedCourses = new Set([...target.tasks.map(task => task.courseId), ...target.gradeItems.map(item => item.courseId), ...Object.keys(target.courseGrades)]);
  target.courses = target.courses.filter(course => !deleted.courses[course.id] || usedCourses.has(course.id));
  return target;
}

function mergeCloudConflict(remoteInput, localInput) {
  const remote = ensureTombstones(structuredClone(remoteInput));
  const local = ensureTombstones(structuredClone(localInput));
  const sync = { ...remote.sync };
  for (const [provider, result] of Object.entries(local.sync)) {
    const remoteTime = Date.parse(sync[provider]?.lastSyncedAt || "") || 0;
    const localTime = Date.parse(result?.lastSyncedAt || "") || 0;
    if (localTime >= remoteTime) sync[provider] = result;
  }
  const merged = {
    profile: local.profile,
    courses: mergeById(remote.courses, local.courses),
    tasks: mergeById(remote.tasks, local.tasks),
    sessions: mergeById(remote.sessions, local.sessions),
    gradeItems: mergeById(remote.gradeItems, local.gradeItems),
    courseGrades: mergeCourseGrades(remote.courseGrades, local.courseGrades),
    schoolSchedule: structuredClone(local.schoolSchedule),
    sync,
    tombstones: {}
  };
  for (const key of ["tasks", "courses", "sessions", "grades", "sources"]) merged.tombstones[key] = newestTombstones(remote.tombstones[key], local.tombstones[key]);
  return applyTombstones(merged);
}

function tombstone(kind, item) {
  ensureTombstones(state);
  const stamp = new Date().toISOString();
  state.tombstones[kind][item.id] = stamp;
  for (const source of item.sources || []) state.tombstones.sources[window.DaymarkSync.sourceKey(source.provider, source.id)] = stamp;
}

function showCloudSignIn(message = "") {
  if (!HOSTED || !cloudModal) return;
  document.querySelector("#cloud-key-error").textContent = message;
  document.querySelector("#cloud-key").value = cloud.key;
  if (!cloudModal.open) cloudModal.showModal();
  setTimeout(() => document.querySelector("#cloud-key").focus(), 50);
}

async function pullCloud({ quiet = false } = {}) {
  if (!HOSTED || !cloud.key || cloud.saving || cloud.dirty) return false;
  setCloudLabel("Syncing cloud…");
  try {
    const response = await fetch("/api/state", { headers: cloudHeaders(), cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      cloud.ready = false;
      showCloudSignIn("That sync key was not accepted.");
      throw new Error("Invalid OG Sync key");
    }
    if (!response.ok || !validState(result.state)) throw new Error(result.error || "Cloud sync failed");
    state = ensureTombstones(result.state);
    const migrated = window.DaymarkSync.migrateState(state);
    cloud.revision = result.revision || null;
    cloud.ready = true;
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (migrated) {
      cloud.dirty = true;
      clearTimeout(cloud.timer);
      cloud.timer = setTimeout(pushCloudState, 0);
    }
    setCloudLabel("Cloud synced");
    render();
    return true;
  } catch (error) {
    setCloudLabel("Cloud offline · saved here");
    if (!quiet && error.message !== "Invalid OG Sync key") showToast(error.message);
    return false;
  }
}

async function pushCloudState() {
  if (!HOSTED || !cloud.ready || !cloud.key || cloud.saving || !cloud.dirty) return;
  cloud.saving = true;
  clearTimeout(cloud.retryTimer);
  cloud.retryTimer = null;
  setCloudLabel("Saving to cloud…");
  try {
    for (let attempt = 0; attempt < 3 && cloud.dirty; attempt++) {
      cloud.dirty = false;
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: cloudHeaders(),
        body: JSON.stringify({ state, revision: cloud.revision })
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 409 && validState(result.state)) {
        state = mergeCloudConflict(result.state, state);
        cloud.revision = result.revision || null;
        cloud.dirty = true;
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        continue;
      }
      if (response.status === 401) {
        cloud.ready = false;
        showCloudSignIn("That sync key was not accepted.");
        throw new Error("Invalid OG Sync key");
      }
      if (!response.ok) throw new Error(result.error || "Could not save to cloud");
      cloud.revision = result.revision || null;
    }
    setCloudLabel(cloud.dirty ? "Cloud retry needed" : "Cloud synced");
  } catch (error) {
    cloud.dirty = true;
    setCloudLabel("Cloud offline · saved here");
    if (error.message !== "Invalid OG Sync key") showToast(`${error.message}. Your changes are saved on this device.`);
    cloud.retryTimer = setTimeout(pushCloudState, 30_000);
  } finally {
    cloud.saving = false;
    if (cloud.dirty && cloud.ready && !cloud.retryTimer) cloud.timer = setTimeout(pushCloudState, 500);
  }
}

function taskRows(tasks, actions = false, grouped = false) {
  if (!tasks.length) return '<div class="empty-state"><span class="empty-icon">✓</span><h3>No tasks here</h3><p>This list is empty.</p></div>';
  return `<div class="task-list">${tasks.map(task => {
    const course = courseFor(task.courseId);
    const overdue = !task.completed && dueTimestamp(task) < Date.now() && task.due !== dateKey();
    const steps = task.subtasks || [];
    const stepText = steps.length ? ` · ${steps.filter(item => item.completed).length}/${steps.length} steps` : "";
    const assessment = isAssessment(task);
    return `<div class="task-row ${task.completed ? "done" : ""} ${assessment ? "assessment" : ""}">
      <input class="task-check" type="checkbox" data-toggle-task="${task.id}" ${task.completed ? "checked" : ""} aria-label="Mark ${e(task.title)} complete" />
      <div><p class="task-title"><button class="task-title-button" data-task-detail="${task.id}">${e(task.title)}</button>${assessment ? '<span class="assessment-badge">Assessment</span>' : ""}${task.url ? `<a class="source-arrow" href="${e(task.url)}" target="_blank" rel="noreferrer" aria-label="Open ${e(task.title)} on the school site">↗</a>` : ""}</p><div class="task-meta">${grouped ? "" : `<span class="course-dot" style="--course-color:${course.color}"></span>${e(course.name)} · `}${e(task.type)} · ${task.estimate || 25} min${stepText}</div></div>
      <div style="display:flex;align-items:center"><div class="task-due ${overdue ? "overdue" : ""}"><strong>${overdue ? "Overdue" : relativeDate(task.due)}</strong><span>${formatTime(task.time)}</span></div>${actions ? `<div class="task-actions"><button class="mini-action" data-delete-task="${task.id}" aria-label="Delete ${e(task.title)}">${icons.trash}</button></div>` : ""}</div>
    </div>`;
  }).join("")}</div>`;
}

function rotationForDate(key) {
  return window.DaymarkSchool.rotationForDate(state.schoolSchedule, key);
}

function slotMatchesDate(slot, date) {
  if (slot.day !== date.getDay()) return false;
  const rotation = rotationForDate(dateKey(date));
  return !slot.rotation || !rotation || slot.rotation === rotation;
}

function scheduleForDate(date = new Date()) {
  const items = [];
  for (const course of state.courses) {
    for (const slot of course.schedule || []) if (slotMatchesDate(slot, date)) items.push({ course, slot });
  }
  return items.sort((a, b) => a.slot.start.localeCompare(b.slot.start));
}

function nextClass() {
  const now = new Date();
  const candidates = [];
  for (let offset = 0; offset < 8; offset++) {
    const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    for (const course of state.courses) {
      for (const slot of course.schedule || []) {
        if (!slotMatchesDate(slot, dayDate)) continue;
        const [hour, minute] = slot.start.split(":").map(Number);
        const starts = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour, minute);
        if (starts > now) candidates.push({ course, slot, starts, offset });
      }
    }
  }
  return candidates.sort((a, b) => a.starts - b.starts)[0];
}

function renderDashboard() {
  const today = dateKey();
  const openTasks = sortTasks(state.tasks.filter(task => !task.completed));
  const overdue = openTasks.filter(task => task.due && task.due < today).length;
  const todayTasks = openTasks.filter(task => task.due === today);
  const dueToday = todayTasks.length;
  const dueSoon = openTasks.filter(task => task.due > today && task.due <= addDays(7)).length;
  const assessments = openTasks.filter(isAssessment);
  const approachingTests = assessments.filter(task => task.due >= today && task.due <= addDays(14));
  const regularTasks = openTasks.filter(task => !isAssessment(task));
  const subjectGroups = taskGroupsByCourse(regularTasks);
  const todayClasses = scheduleForDate(new Date());
  const rotation = rotationForDate(today);
  const workload = openTasks.filter(task => task.due && task.due <= today).reduce((sum, task) => sum + (task.estimate || 25), 0);
  const missingWork = openTasks.filter(task => window.DaymarkSchool.isSyncedMissingWork(task, today));
  const next = nextClass();
  const classNames = [...new Set(todayClasses.map(item => item.course.name))];
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const nextClassText = next ? `${next.course.name} · ${next.offset === 0 ? "today" : next.offset === 1 ? "tomorrow" : next.starts.toLocaleDateString(undefined, { weekday: "long" })} ${formatTime(next.slot.start)}` : "No upcoming class scheduled";

  app.innerHTML = `<section class="page home-page">
    <div class="page-heading today-heading"><div><h1>Today</h1><p>${todayLabel}${rotation ? ` · ${e(rotation)} day` : ""}</p></div><span class="today-open-count">${openTasks.length} open</span></div>
    <section class="card today-glance" aria-label="Today at a glance">
      <div><span>School day</span><strong>${classNames.length ? `${classNames.length} ${classNames.length === 1 ? "class" : "classes"}` : "No classes today"}</strong><small>${e(nextClassText)}</small></div>
      <div><span>Due</span><strong>${dueToday} today${overdue ? ` · ${overdue} overdue` : ""}</strong><small>${missingWork.length ? `${missingWork.length} ${missingWork.length === 1 ? "item needs" : "items need"} attention` : "No missing work found"}</small></div>
      <div><span>Next assessment</span><strong>${approachingTests.length ? e(approachingTests[0].title) : "None scheduled"}</strong><small>${approachingTests.length ? relativeDate(approachingTests[0].due) : "Nothing in the next 14 days"}</small></div>
      <div><span>Workload</span><strong>${workload} min</strong><small>Due or overdue today</small></div>
    </section>
    ${missingWork.length ? `<aside class="missing-watchdog" role="status"><span class="missing-watchdog-mark">!</span><div><strong>${missingWork.length} overdue ${missingWork.length === 1 ? "item" : "items"}</strong><p>${e(missingWork[0].title)}${missingWork.length > 1 ? ` and ${missingWork.length - 1} more` : ""} ${missingWork.length === 1 ? "is" : "are"} still marked incomplete.</p></div><button class="text-link" data-go="planner">Review →</button></aside>` : ""}
    <article class="card today-work"><div class="card-header"><div><h2>Your work</h2><p>Tests and quizzes appear first. Other work is grouped by class.</p></div><button class="text-link" data-go="planner">Open planner →</button></div>
      ${assessments.length ? `<section class="today-assessments"><div class="today-section-title"><h3>Tests & quizzes</h3><span>${assessments.length}</span></div>${taskRows(assessments.slice(0, 4))}</section>` : ""}
      ${subjectGroups.length ? `<div class="today-subject-grid">${subjectGroups.map(group => `<section class="today-subject"><div class="home-subject-heading"><div><span class="course-dot" style="--course-color:${group.course.color}"></span><h3>${e(group.course.name)}</h3></div><span>${group.items.length}</span></div>${taskRows(group.items.slice(0, 3), false, true)}${group.items.length > 3 ? `<button class="home-subject-more" data-go="planner">+${group.items.length - 3} more</button>` : ""}</section>`).join("")}</div>` : assessments.length ? "" : '<div class="empty-state"><span class="empty-icon">✓</span><h3>All caught up</h3><p>You do not have any open assignments.</p></div>'}
      <footer class="today-work-footer"><span>${overdue} overdue · ${dueToday} due today · ${dueSoon} in the next 7 days</span>${openTasks[0] ? `<button class="text-link" data-focus-task="${openTasks[0].id}">Focus on the next task →</button>` : ""}</footer>
    </article>
  </section>`;
}

function calendarCells() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstDay.getDay(), 12);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index, 12);
    const key = dateKey(date);
    const items = sortTasks(state.tasks.filter(task => task.due === key));
    return `<button class="calendar-day ${date.getMonth() !== month ? "outside" : ""} ${key === dateKey() ? "today" : ""} ${key === selectedDate ? "selected" : ""}" data-calendar-date="${key}">
      <span class="day-number">${date.getDate()}</span>
      ${items.slice(0, 3).map(item => `<span class="calendar-item" style="--item-color:${courseFor(item.courseId).color}">${e(item.title)}</span>`).join("")}
      ${items.length > 3 ? `<span class="more-items">+${items.length - 3} more</span>` : ""}
    </button>`;
  }).join("");
}

function renderCalendar() {
  const selectedTasks = sortTasks(state.tasks.filter(task => task.due === selectedDate));
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><span class="eyebrow">Everything in one place</span><h1>Calendar</h1><p>See what is due and when.</p></div><button class="button button-dark" data-open-task>+ Add item</button></div>
    <div class="calendar-layout">
      <article class="card calendar-card">
        <div class="calendar-toolbar"><h2>${calendarCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><div class="toolbar-group"><button class="button button-quiet" data-calendar-nav="today">Today</button><button class="icon-button" data-calendar-nav="prev" aria-label="Previous month">${icons.left}</button><button class="icon-button" data-calendar-nav="next" aria-label="Next month">${icons.right}</button></div></div>
        <div class="weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => `<span>${day}</span>`).join("")}</div>
        <div class="calendar-grid">${calendarCells()}</div>
      </article>
      <aside class="card agenda-card"><div class="agenda-date"><span class="eyebrow">Selected day</span><strong>${parseDate(selectedDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</strong></div><div class="agenda-list">${selectedTasks.length ? selectedTasks.map(task => `<div class="agenda-item" style="--item-color:${courseFor(task.courseId).color}"><strong>${e(task.title)}</strong><span>${e(courseFor(task.courseId).name)} · ${formatTime(task.time)}</span></div>`).join("") : '<div class="empty-state"><h3>No due dates</h3><p>Nothing is due on this day.</p></div>'}</div></aside>
    </div>
  </section>`;
}

function taskGroupsByCourse(tasks) {
  const courseIds = [...state.courses.map(course => course.id), "personal"];
  return courseIds.map(courseId => {
    const items = sortTasks(tasks.filter(task => task.courseId === courseId));
    items.sort((a, b) => Number(isAssessment(b)) - Number(isAssessment(a)));
    return { course: courseFor(courseId), items };
  }).filter(group => group.items.length);
}

function renderPlanner() {
  let tasks = state.tasks.filter(task => plannerCourse === "all" || task.courseId === plannerCourse);
  if (plannerView === "open") tasks = tasks.filter(task => !task.completed);
  if (plannerView === "today") tasks = tasks.filter(task => task.due && task.due <= dateKey() && !task.completed);
  if (plannerView === "week") tasks = tasks.filter(task => task.due >= dateKey() && task.due <= addDays(7) && !task.completed);
  if (plannerView === "done") tasks = tasks.filter(task => task.completed);
  const groups = taskGroupsByCourse(tasks);
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><h1>Planner</h1><p>Browse work by class and due date. Tests and quizzes appear first.</p></div><button class="button button-dark" data-open-task>+ Add task</button></div>
    <div class="planner-toolbar"><div class="segmented">${[["open","Open"],["today","Today"],["week","Next 7 days"],["done","Completed"]].map(([value,label]) => `<button class="segment ${plannerView === value ? "active" : ""}" data-planner-view="${value}">${label}</button>`).join("")}</div><select class="filter-select" id="planner-course" aria-label="Filter by class"><option value="all">All classes</option>${state.courses.map(course => `<option value="${course.id}" ${plannerCourse === course.id ? "selected" : ""}>${e(course.name)}</option>`).join("")}</select></div>
    ${groups.length ? `<div class="card planner-board">${groups.map(group => `<section class="planner-course"><div class="planner-group-title"><div><span class="course-dot" style="--course-color:${group.course.color}"></span><h2>${e(group.course.name)}</h2></div><span>${group.items.length} ${group.items.length === 1 ? "item" : "items"}</span></div>${taskRows(group.items, true, true)}</section>`).join("")}</div>` : '<article class="card empty-state"><span class="empty-icon">✓</span><h3>No tasks match this view</h3><p>Try a different filter or add a task.</p></article>'}
  </section>`;
}

function streak() {
  const focusedDays = new Set(state.sessions.filter(session => session.minutes >= 5).map(session => session.date));
  let count = 0;
  let cursor = new Date();
  if (!focusedDays.has(dateKey(cursor))) cursor = parseDate(addDays(-1));
  while (focusedDays.has(dateKey(cursor))) {
    count++;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1, 12);
  }
  return count;
}

function renderFocus() {
  const totalToday = state.sessions.filter(session => session.date === dateKey()).reduce((sum, session) => sum + session.minutes, 0);
  const open = sortTasks(state.tasks.filter(task => !task.completed));
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><h1>Focus</h1><p>Set the work time, break time, and number of blocks.</p></div><button class="button button-quiet timer-alert-button" data-timer-alert aria-pressed="${timerAlerts}">${timerAlerts ? icons.bell : icons.bellOff}<span>${timerAlerts ? "Bell on" : "Bell off"}</span></button></div>
    <div class="focus-layout">
      <article class="card timer-card"><div class="timer-inner">
        <div class="timer-plan" aria-label="Focus cycle settings">
          <label><span>Work</span><span><input data-timer-setting="work" type="number" min="1" max="180" value="${timer.plan.work}" aria-label="Work minutes" /> min</span></label>
          <label><span>Break</span><span><input data-timer-setting="break" type="number" min="1" max="60" value="${timer.plan.break}" aria-label="Break minutes" /> min</span></label>
          <label><span>Blocks</span><select data-timer-setting="blocks" aria-label="Number of focus blocks">${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}" ${timer.plan.blocks === index + 1 ? "selected" : ""}>${index + 1}</option>`).join("")}</select></label>
        </div>
        <div class="timer-ring ${timer.phase}" id="timer-ring"><div class="timer-display"><strong id="timer-time">${timerText()}</strong><span id="timer-label">${timerPhaseText()}</span></div></div>
        <div class="timer-controls"><button class="button button-dark" id="timer-start" data-timer-start>${timerButtonText()}</button><button class="button button-quiet" data-timer-reset>Reset cycle</button></div>
        <select class="focus-task-select" id="focus-task" aria-label="Task for this focus session"><option value="">General focus</option>${open.map(task => `<option value="${task.id}" ${timer.taskId === task.id ? "selected" : ""}>${e(task.title)} · ${e(courseFor(task.courseId).name)}</option>`).join("")}</select>
      </div></article>
      <aside class="focus-side">
        <article class="card stat-card"><span class="eyebrow">Focused today</span><strong class="big-stat">${totalToday}<small> min</small></strong><span class="stat-caption">${totalToday >= 50 ? "Nice work today." : "Finish a session to get started."}</span></article>
        <article class="card stat-card"><span class="eyebrow">Current streak</span><strong class="big-stat">${streak()}<small> days</small></strong><span class="stat-caption">5+ minutes counts</span></article>
        <article class="card"><div class="card-header"><div><h3>Recent sessions</h3><p>Completed focus blocks</p></div></div><div class="session-list">${state.sessions.length ? state.sessions.slice().sort((a,b) => parseDate(b.date) - parseDate(a.date)).slice(0,5).map(session => `<div class="session-item"><span class="session-icon">${icons.clock}</span><div><strong>${e(session.label || "General focus")}</strong><span>${relativeDate(session.date)}</span></div><span class="session-minutes">${session.minutes} min</span></div>`).join("") : '<div class="empty-state"><p>Completed sessions will appear here.</p></div>'}</div></article>
      </aside>
    </div>
  </section>`;
  updateTimerDisplay();
}

function scheduleText(course) {
  const days = [...new Set((course.schedule || []).map(slot => slot.day))];
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayText = days.length === 5 && days.every(day => day >= 1 && day <= 5) ? "Weekdays" : days.map(day => labels[day]).join(", ");
  const rotations = [...new Set((course.schedule || []).map(slot => slot.rotation).filter(Boolean))];
  return `${dayText}${rotations.length ? ` · ${rotations.join("/")}` : ""}` || "No schedule";
}

function renderClasses() {
  const today = new Date();
  const rotation = rotationForDate(dateKey(today));
  const todayItems = scheduleForDate(today);
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><span class="eyebrow">Your school day</span><h1>Classes & schedule</h1><p>Check today’s classes, times, rooms, and rotation.</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="button button-quiet" data-configure-schedule>Configure A/B cycle</button><button class="button button-dark" data-add-class>+ Add class</button></div></div>
    <article class="card school-day-card"><div class="school-day-heading"><div><span class="eyebrow">${today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span><h2>Today’s schedule</h2></div>${rotation ? `<span class="rotation-badge">${e(rotation)} day</span>` : '<span class="status-pill">No rotation set</span>'}</div>
      ${todayItems.length ? `<div class="schedule-timeline">${todayItems.map(({ course, slot }) => `<div class="schedule-row"><span class="schedule-time">${formatTime(slot.start)}</span><span class="schedule-line" style="--schedule-color:${course.color}"></span><div><strong>${e(course.name)}</strong><span>${e([slot.period, course.room, course.teacher].filter(Boolean).join(" · ") || `Ends ${formatTime(slot.end)}`)}</span></div><small>${formatTime(slot.end)}</small></div>`).join("")}</div>` : '<div class="empty-state"><h3>No classes scheduled today</h3><p>Edit each class to add meeting days, times, room, period, and rotation.</p></div>'}
    </article>
    ${state.courses.length ? `<div class="classes-grid">${state.courses.map(course => {
      const tasks = sortTasks(state.tasks.filter(task => task.courseId === course.id && !task.completed));
      const slot = course.schedule?.[0];
      const details = [course.teacher, course.room].filter(Boolean).map(e).join(" · ");
      return `<article class="card class-card"><div class="class-color" style="--class-bg:${course.color}"><span class="eyebrow">${tasks.length} open ${tasks.length === 1 ? "item" : "items"}</span><h2>${e(course.name)}</h2><p>${details || "No teacher or room added"}</p></div><div class="class-details"><div class="class-detail-row"><span>Schedule</span><strong>${scheduleText(course)}${slot ? ` · ${e(slot.period || formatTime(slot.start))}` : ""}</strong></div><div class="class-detail-row"><span>Next due</span><strong>${tasks[0] ? `${relativeDate(tasks[0].due)} · ${e(tasks[0].title)}` : "All clear"}</strong></div><div style="display:flex;align-items:center;justify-content:space-between;margin-top:15px"><button class="text-link" data-course-work="${course.id}">View class work →</button><div style="display:flex"><button class="mini-action" data-edit-class="${course.id}" aria-label="Edit ${e(course.name)}">✎</button><button class="mini-action" data-delete-class="${course.id}" aria-label="Delete ${e(course.name)}">${icons.trash}</button></div></div></div></article>`;
    }).join("")}</div>` : '<article class="card empty-state"><span class="empty-icon">＋</span><h3>Add your first class</h3><p>Add a class to start organizing assignments and your schedule.</p><button class="button button-dark" data-add-class style="margin-top:16px">Add class</button></article>'}
  </section>`;
}

function formatPoints(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function renderGrades() {
  const coursesWithGrades = state.courses.filter(course => state.courseGrades[course.id] || state.gradeItems.some(item => item.courseId === course.id));
  const refreshButton = HOSTED
    ? '<button class="button button-quiet" data-cloud-refresh>Refresh cloud</button>'
    : '<button class="button button-dark" data-sync-provider="blackbaud">Sync grades</button>';
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><h1>Grades</h1><p>View your latest published grades from My Oak Grove.</p></div>${refreshButton}</div>
    <aside class="card grade-note"><span class="integration-logo">%</span><div><h3>Current totals from My Oak Grove</h3><p>These are the percentages reported by Blackbaud, including any category weights your teachers use. The Mac helper checks for updates while it is running.</p></div></aside>
    ${coursesWithGrades.length ? `<div class="grades-grid">${coursesWithGrades.map(course => {
      const items = state.gradeItems.filter(item => item.courseId === course.id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const summary = window.DaymarkSchool.gradeSummary(items);
      const official = state.courseGrades[course.id];
      const percent = official ? official.percent : summary.percent === null ? null : Math.round(summary.percent * 10) / 10;
      const lastSynced = official?.syncedAt ? new Date(official.syncedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Previous local data";
      return `<article class="card grade-card" style="--grade-color:${course.color}">
        <div class="grade-card-head"><div><h2>${e(course.name)}</h2><span>${e(official?.period || "Imported grade history")} · ${items.length} published ${items.length === 1 ? "item" : "items"}</span></div><strong class="grade-percent">${percent === null ? "—" : `${formatPoints(percent)}%`}</strong></div>
        <div class="grade-progress"><span style="width:${Math.max(0, Math.min(100, percent || 0))}%"></span></div>
        <p class="grade-points">${official ? `Synced ${e(lastSynced)}` : `${formatPoints(summary.earned)} of ${formatPoints(summary.possible)} points`}</p>
        ${items.length ? `<div class="grade-items">${items.slice(0, 8).map(item => `<div class="grade-item"><div><strong>${e(item.title)}</strong><span>${e([item.type, item.date ? relativeDate(item.date) : "No date"].filter(Boolean).join(" · "))}</span></div><span>${formatPoints(item.score)} / ${formatPoints(item.pointsPossible)}</span></div>`).join("")}</div>` : '<p class="grade-empty">No individual scores have been published for this marking period.</p>'}
        ${official?.calculationMethod ? '<p class="grade-method">Blackbaud calculates this total using your teacher’s gradebook rules.</p>' : ""}
      </article>`;
    }).join("")}</div>` : `<article class="card grades-empty"><div class="grades-empty-mark">%</div><div><h2>No grades found</h2><p>Keep the Mac helper running and signed in to My Oak Grove. New grades will appear after the next sync.</p></div></article>`}
  </section>`;
}

function renderSync() {
  if (HOSTED) {
    app.innerHTML = `<section class="page">
      <div class="page-heading"><div class="sync-intro"><span class="eyebrow">Available anywhere</span><h1>Cloud sync</h1><p>Use your OG Sync key to load the same assignments and grades on this device. Your Mac sends school updates to this private workspace.</p></div><button class="button button-quiet" data-cloud-refresh>Refresh now</button></div>
      <div class="sync-grid">
        ${cloudProviderCard("google", "G", "Google Classroom")}
        ${cloudProviderCard("blackbaud", "B", "My Oak Grove · Blackbaud")}
        <article class="card integration-card"><div class="integration-top"><span class="integration-logo">☁</span><span class="status-pill connected">Connected</span></div><h2>OG Sync cloud</h2><p>Planner changes from this device are saved to your Vercel storage. Google and Blackbaud sign-in data stays on your Mac.</p><button class="button button-quiet" data-cloud-disconnect>Change sync key</button></article>
        <article class="card integration-card"><div class="integration-top"><span class="integration-logo">↕</span><span class="status-pill">Backup</span></div><h2>Export or restore</h2><p>Download a JSON backup, or restore one to this cloud workspace.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="button button-dark" data-export>Export data</button><button class="button button-quiet" data-import>Import backup</button></div></article>
        <article class="card integration-card"><div class="integration-top"><span class="integration-logo">⌫</span><span class="status-pill">All devices</span></div><h2>Clear assignments & history</h2><p>Delete every task and focus session from OG Sync. Your classes and profile will stay.</p><button class="button button-quiet danger-link" data-clear-work>Clear work data</button></article>
        <aside class="card privacy-card"><span class="integration-logo">${icons.shield}</span><div><h3>School sign-in stays on your Mac.</h3><p>The helper keeps Google and Blackbaud sessions in .data/scraper-profile. It sends only classes, assignments, published grades, and sync times to Vercel.</p></div></aside>
      </div>
    </section>`;
    return;
  }
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div class="sync-intro"><span class="eyebrow">Bring school into focus</span><h1>Browser import</h1><p>Sign in to Google Classroom and My Oak Grove in the browser window opened by OG Sync. Each sync updates matching assignments, so it will not create copies.</p></div></div>
    <div class="sync-grid">
      ${integrationCard("google", "G", "Google Classroom", "Import assignments from Classroom’s To-do pages with your saved browser session.")}
      ${integrationCard("blackbaud", "B", "My Oak Grove · Blackbaud", "Import assignments and grades from My Day and the gradebook with your saved browser session.")}
      <article class="card integration-card"><div class="integration-top"><span class="integration-logo">↕</span><span class="status-pill">Works now</span></div><h2>Backup & transfer</h2><p>Download a JSON backup, or restore one on this device.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="button button-dark" data-export>Export data</button><button class="button button-quiet" data-import>Import backup</button></div></article>
      <article class="card integration-card"><div class="integration-top"><span class="integration-logo">⌫</span><span class="status-pill">Local data</span></div><h2>Clear assignments & history</h2><p>Delete every task and focus session. Your classes and profile will stay.</p><button class="button button-quiet danger-link" data-clear-work>Clear work data</button></article>
      <aside class="card privacy-card"><span class="integration-logo">${icons.shield}</span><div><h3>School passwords stay on the sign-in pages.</h3><p>The helper saves its signed-in browser session in .data/scraper-profile. It does not collect or save your Google or Blackbaud password.</p></div></aside>
    </div>
  </section>`;
  refreshSyncStatus();
}

function cloudProviderCard(provider, mark, title) {
  const result = state.sync?.[syncStateKeys[provider]];
  const connected = Number.isFinite(Date.parse(result?.lastSyncedAt || ""));
  return `<article class="card integration-card"><div class="integration-top"><span class="integration-logo ${provider}">${mark}</span><span class="status-pill ${connected ? "connected" : ""}">${connected ? "Synced by Mac" : "Waiting for Mac"}</span></div><h2>${title}</h2><p>${connected ? lastSyncText(provider) : "Run the OG Sync helper on your Mac to send this school data to the cloud."}</p></article>`;
}

function integrationCard(provider, mark, title, description) {
  return `<article class="card integration-card" id="sync-${provider}-card"><div class="integration-top"><span class="integration-logo ${provider}">${mark}</span><span class="status-pill" id="sync-${provider}-status">Checking…</span></div><h2>${title}</h2><p>${description}</p><div class="integration-actions" id="sync-${provider}-actions"><button class="button button-quiet" disabled>Checking connection…</button></div><div class="sync-detail" id="sync-${provider}-detail" aria-live="polite"></div></article>`;
}

const syncProviderNames = { google: "Google Classroom", blackbaud: "My Oak Grove" };
const syncStateKeys = { google: "google-classroom", blackbaud: "blackbaud" };
const syncBusy = new Set();
let syncServerStatus;

function lastSyncText(provider) {
  const result = state.sync?.[syncStateKeys[provider]];
  const value = result?.lastSyncedAt;
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "Ready for the first sync.";
  const checked = Number(result.updated || 0) + Number(result.merged || 0);
  const grades = provider === "blackbaud" ? ` Grades: ${Number(result.gradesImported || 0)} new, ${Number(result.gradesUpdated || 0)} updated.` : "";
  return `Last result: ${Number(result.imported || 0)} new, ${checked} existing assignments.${grades} Synced ${new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`;
}

function paintSyncProvider(provider, status = syncServerStatus, error = "") {
  const pill = document.querySelector(`#sync-${provider}-status`);
  const actions = document.querySelector(`#sync-${provider}-actions`);
  const detail = document.querySelector(`#sync-${provider}-detail`);
  if (!pill || !actions || !detail) return;
  pill.className = "status-pill";
  if (error) {
    pill.textContent = "Unavailable";
    pill.classList.add("error");
    actions.innerHTML = '<button class="button button-quiet" data-retry-sync-status>Retry</button>';
    detail.textContent = error;
    return;
  }
  if (syncBusy.has(provider)) {
    pill.textContent = "Syncing…";
    actions.innerHTML = '<button class="button button-quiet" disabled>Syncing…</button>';
    detail.textContent = "Fetching and checking for duplicates.";
    return;
  }
  if (!status?.scraper?.available) {
    pill.textContent = "Unavailable";
    pill.classList.add("error");
    actions.innerHTML = '<button class="button button-quiet" data-retry-sync-status>Retry</button>';
    detail.textContent = "The local scraper service is unavailable.";
    return;
  }
  const page = status.scraper.pages?.[provider];
  if (!page?.open) {
    pill.textContent = "Browser closed";
    actions.innerHTML = `<button class="button button-dark" data-open-scraper="${provider}">Open sign-in browser</button>`;
    detail.textContent = `Open the dedicated browser. A saved ${provider === "google" ? "Google Classroom" : "My Oak Grove"} session will be reused when available.`;
    return;
  }
  if (!page.signedIn) {
    pill.textContent = "Sign-in open";
    actions.innerHTML = `<button class="button button-dark" data-open-scraper="${provider}">Show sign-in browser</button>`;
    detail.textContent = `Finish signing in on ${provider === "google" ? "Google Classroom" : "My Oak Grove"}; the password remains on that site.`;
    return;
  }
  pill.textContent = "Signed in";
  pill.classList.add("connected");
  actions.innerHTML = `<button class="button button-dark" data-sync-provider="${provider}">Import now</button><button class="button button-quiet" data-open-scraper="${provider}">Show browser</button>`;
  detail.textContent = `${provider === "blackbaud" ? "OG Sync reads your signed-in Assignment Center. " : "OG Sync checks Assigned, Missing, and Done views. "}${lastSyncText(provider)}`;
}

async function readSyncStatus() {
  if (HOSTED) throw new Error("School imports run on your trusted Mac.");
  const response = await fetch("/api/status", { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error("The OG Sync server is not running. Start it with npm start.");
  const next = await response.json();
  if (!next?.scraper) throw new Error("The sync server returned an invalid status.");
  syncServerStatus = next;
  return next;
}

async function refreshSyncStatus() {
  try {
    const status = await readSyncStatus();
    for (const provider of Object.keys(syncProviderNames)) paintSyncProvider(provider, status);
  } catch (error) {
    for (const provider of Object.keys(syncProviderNames)) paintSyncProvider(provider, null, error.message);
  }
}

async function openScraperBrowser(provider) {
  if (!syncProviderNames[provider]) return;
  try {
    const response = await fetch(`/api/scrape/open/${provider}`, { method: "POST", headers: { Accept: "application/json" } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not open the sign-in browser.");
    showToast(`Sign into ${syncProviderNames[provider]} in the browser window, then return here and press Import now.`);
    await refreshSyncStatus();
  } catch (error) { showToast(error.message); }
}

async function runSync(provider, { silent = false } = {}) {
  if (!syncProviderNames[provider] || syncBusy.has(provider)) return;
  syncBusy.add(provider);
  paintSyncProvider(provider);
  let failure = "";
  try {
    const response = await fetch(`/api/sync/${provider}`, { method: "POST", headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `${syncProviderNames[provider]} sync failed.`);
    const counts = window.DaymarkSync.mergeImported(state, payload);
    save();
    if (currentPage() === "sync") renderSync();
    else render();
    if (payload.cloud?.error) showToast(`Assignments imported here, but cloud upload failed: ${payload.cloud.error}`);
    else if (!silent || counts.imported) {
      const existing = counts.updated + counts.merged;
      const gradeText = provider === "blackbaud" ? ` ${counts.gradesImported} new grades; ${counts.gradesUpdated} grades updated.` : "";
      showToast(`${counts.imported} new assignments; ${existing} existing checked.${gradeText}`);
    }
  } catch (error) {
    failure = error.message;
    if (!silent) showToast(error.message);
  } finally {
    syncBusy.delete(provider);
    if (currentPage() === "sync") {
      if (failure) paintSyncProvider(provider, syncServerStatus, failure);
      else refreshSyncStatus();
    }
  }
}

async function autoSync() {
  if (HOSTED) {
    if (!document.hidden && cloud.key && cloud.ready && !cloud.dirty) await pullCloud({ quiet: true });
    return;
  }
  if (document.hidden || syncBusy.size) return;
  try {
    const status = await readSyncStatus();
    for (const provider of Object.keys(syncProviderNames)) {
      if (!status.scraper?.pages?.[provider]?.open) continue;
      const last = Date.parse(state.sync?.[syncStateKeys[provider]]?.lastSyncedAt || "");
      if (!Number.isFinite(last) || Date.now() - last >= 15 * 60_000) await runSync(provider, { silent: true });
    }
  } catch (_) {}
}

function currentPage() {
  const value = location.hash.slice(1);
  return ["dashboard", "calendar", "planner", "focus", "classes", "grades", "sync"].includes(value) ? value : "dashboard";
}

function render() {
  const page = currentPage();
  document.querySelectorAll(".nav-item[data-page]").forEach(item => item.classList.toggle("active", item.dataset.page === page));
  document.querySelector("#planner-count").textContent = state.tasks.filter(task => !task.completed).length;
  document.querySelector(".profile-button strong").textContent = state.profile.name || "Your workspace";
  document.querySelector(".avatar").textContent = (state.profile.name || "S").trim()[0].toUpperCase();
  document.querySelector("#topbar-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  updateThemeButton();
  ({ dashboard: renderDashboard, calendar: renderCalendar, planner: renderPlanner, focus: renderFocus, classes: renderClasses, grades: renderGrades, sync: renderSync })[page]();
  app.focus({ preventScroll: true });
}

function timerText() {
  const minutes = Math.floor(timer.remaining / 60);
  const seconds = timer.remaining % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function timerPhaseText() {
  return `${timer.phase === "break" ? "Break" : "Work"} · Block ${timer.block} of ${timer.plan.blocks}`;
}

function timerButtonText() {
  if (timer.running) return "Pause";
  return timer.remaining < timer.total ? "Resume" : "Start cycle";
}

function updateTimerDisplay() {
  const display = document.querySelector("#timer-time");
  const ring = document.querySelector("#timer-ring");
  const label = document.querySelector("#timer-label");
  const button = document.querySelector("#timer-start");
  if (display) display.textContent = timerText();
  if (ring) {
    ring.classList.toggle("break", timer.phase === "break");
    ring.classList.toggle("work", timer.phase === "work");
    ring.style.setProperty("--progress", `${(1 - timer.remaining / timer.total) * 360}deg`);
  }
  if (label) label.textContent = timerPhaseText();
  if (button) button.textContent = timerButtonText();
  document.querySelectorAll("[data-timer-setting], #focus-task").forEach(control => { control.disabled = timer.running; });
  document.title = timer.running ? `${timerText()} · OG Sync` : "OG Sync — School planner";
}

function tickTimer() {
  if (!timer.running) return;
  timer.remaining = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000));
  updateTimerDisplay();
  if (timer.remaining > 0) return;
  if (timer.phase === "work") {
    const task = state.tasks.find(item => item.id === timer.taskId);
    state.sessions.push({ id: crypto.randomUUID(), date: dateKey(), minutes: Math.round(timer.total / 60), label: task?.title || "General focus" });
    save();
  }
  const finishedPhase = timer.phase;
  const next = window.DaymarkSchool.nextFocusPhase(timer.phase, timer.block, timer.plan.blocks);
  if (next.complete) {
    clearInterval(timer.interval);
    Object.assign(timer, { phase: "work", block: 1, total: timer.plan.work * 60, remaining: timer.plan.work * 60, running: false, deadline: 0, interval: null });
    announceTimerTransition("Focus cycle complete", `You finished ${timer.plan.blocks} ${timer.plan.blocks === 1 ? "block" : "blocks"}.`);
    showToast(`Cycle complete. ${timer.plan.blocks} ${timer.plan.blocks === 1 ? "block" : "blocks"} finished.`);
  } else {
    const minutes = next.phase === "work" ? timer.plan.work : timer.plan.break;
    Object.assign(timer, { phase: next.phase, block: next.block, total: minutes * 60, remaining: minutes * 60, deadline: Date.now() + minutes * 60_000 });
    announceTimerTransition(finishedPhase === "work" ? "Break started" : `Focus block ${timer.block} started`, finishedPhase === "work" ? `${timer.plan.break} minutes to reset.` : `${timer.plan.work} minutes of focused work.`);
    showToast(finishedPhase === "work" ? `Block ${timer.block} complete. Break started.` : `Break complete. Block ${timer.block} started.`);
  }
  if (currentPage() === "focus") renderFocus();
  else updateTimerDisplay();
}

function toggleTimer() {
  if (timer.running) {
    timer.remaining = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000));
    timer.running = false;
    clearInterval(timer.interval);
  } else {
    if (!timer.remaining) timer.remaining = timer.total;
    timer.taskId = document.querySelector("#focus-task")?.value || timer.taskId;
    prepareTimerAudio();
    timer.running = true;
    timer.deadline = Date.now() + timer.remaining * 1000;
    timer.interval = setInterval(tickTimer, 250);
  }
  updateTimerDisplay();
}

function resetTimer() {
  clearInterval(timer.interval);
  Object.assign(timer, { phase: "work", block: 1, total: timer.plan.work * 60, remaining: timer.plan.work * 60, running: false, deadline: 0, interval: null });
  updateTimerDisplay();
}

function updateFocusPlan() {
  if (timer.running) return;
  timer.plan = window.DaymarkSchool.normalizeFocusPlan({
    work: document.querySelector('[data-timer-setting="work"]')?.value,
    break: document.querySelector('[data-timer-setting="break"]')?.value,
    blocks: document.querySelector('[data-timer-setting="blocks"]')?.value
  });
  localStorage.setItem(FOCUS_PLAN_STORE, JSON.stringify(timer.plan));
  resetTimer();
}

function openTaskModal() {
  const select = document.querySelector("#task-course");
  select.innerHTML = state.courses.map(course => `<option value="${course.id}">${e(course.name)}</option>`).join("") + '<option value="personal">Personal</option>';
  document.querySelector("#task-date").value = addDays(1);
  taskModal.showModal();
  setTimeout(() => document.querySelector("#task-title").focus(), 50);
}

function renderDetailLists() {
  document.querySelector("#subtask-list").innerHTML = detailDraft.subtasks.length ? detailDraft.subtasks.map(item => `<div class="detail-list-row"><input type="checkbox" data-detail-subtask="${item.id}" ${item.completed ? "checked" : ""} /><span class="${item.completed ? "done" : ""}">${e(item.title)}</span><button class="mini-action" type="button" data-remove-subtask="${item.id}" aria-label="Remove ${e(item.title)}">${icons.trash}</button></div>`).join("") : '<p class="detail-empty">No subtasks yet.</p>';
  document.querySelector("#attachment-list").innerHTML = detailDraft.attachments.length ? detailDraft.attachments.map(item => `<div class="detail-list-row"><span class="attachment-mark">↗</span><a href="${e(item.url)}" target="_blank" rel="noreferrer">${e(item.name)}</a><button class="mini-action" type="button" data-remove-attachment="${item.id}" aria-label="Remove ${e(item.name)}">${icons.trash}</button></div>`).join("") : '<p class="detail-empty">No attachment links yet.</p>';
}

function openTaskDetails(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  detailDraft = {
    id: task.id,
    notes: task.notes || "",
    teacherInstructions: task.teacherInstructions || task.description || "",
    subtasks: structuredClone(task.subtasks || []),
    attachments: structuredClone(task.attachments || [])
  };
  document.querySelector("#task-detail-id").value = task.id;
  document.querySelector("#task-detail-title").textContent = task.title;
  document.querySelector("#task-detail-course").textContent = `${courseFor(task.courseId).name} · ${task.type} · ${relativeDate(task.due)}`;
  document.querySelector("#task-teacher-instructions").value = detailDraft.teacherInstructions;
  document.querySelector("#task-notes").value = detailDraft.notes;
  document.querySelector("#subtask-title").value = "";
  document.querySelector("#attachment-name").value = "";
  document.querySelector("#attachment-url").value = "";
  const source = document.querySelector("#task-source-link");
  source.classList.toggle("hidden", !task.url);
  if (task.url) source.href = task.url;
  renderDetailLists();
  taskDetailModal.showModal();
}

function openScheduleModal() {
  const [labelA, labelB] = state.schoolSchedule.rotationLabels;
  document.querySelector("#rotation-label-a").value = labelA;
  document.querySelector("#rotation-label-b").value = labelB;
  document.querySelector("#rotation-anchor").value = state.schoolSchedule.anchorDate || dateKey();
  scheduleModal.showModal();
}

function openClassModal(id = "") {
  const form = document.querySelector("#class-form");
  form.reset();
  document.querySelector("#class-id").value = id;
  document.querySelector("#class-modal-title").textContent = id ? "Edit class" : "Add a class";
  document.querySelector("#class-color").value = ["#ddd5f4", "#f2d6a2", "#d9e8c7", "#cae8d7", "#f3d6dc", "#cfe1f4"][state.courses.length % 6];
  const rotation = document.querySelector("#class-rotation");
  rotation.innerHTML = '<option value="">Every rotation day</option>' + state.schoolSchedule.rotationLabels.map(label => `<option value="${e(label)}">${e(label)} day only</option>`).join("");
  if (id) {
    const course = state.courses.find(item => item.id === id);
    if (!course) return;
    document.querySelector("#class-name").value = course.name;
    document.querySelector("#class-teacher").value = course.teacher;
    document.querySelector("#class-room").value = course.room;
    document.querySelector("#class-color").value = course.color;
    document.querySelector("#class-start").value = course.schedule[0]?.start || "";
    document.querySelector("#class-end").value = course.schedule[0]?.end || "";
    document.querySelector("#class-period").value = course.schedule[0]?.period || "";
    rotation.value = course.schedule[0]?.rotation || "";
    const days = new Set(course.schedule.map(slot => String(slot.day)));
    form.querySelectorAll('input[name="days"]').forEach(input => { input.checked = days.has(input.value); });
  }
  classModal.showModal();
  setTimeout(() => document.querySelector("#class-name").focus(), 50);
}

function renderSearch(query = "") {
  const q = query.trim().toLowerCase();
  const tasks = q ? state.tasks.filter(task => task.title.toLowerCase().includes(q) || courseFor(task.courseId).name.toLowerCase().includes(q)).slice(0, 8) : sortTasks(state.tasks.filter(task => !task.completed)).slice(0, 5);
  const courses = q ? state.courses.filter(course => course.name.toLowerCase().includes(q) || course.teacher.toLowerCase().includes(q)).slice(0, 5) : [];
  const results = tasks.map(task => `<div class="search-result" data-search-result="${task.id}"><span class="course-dot" style="--course-color:${courseFor(task.courseId).color}"></span><div><strong>${e(task.title)}</strong><small>${e(courseFor(task.courseId).name)} · ${task.due ? `due ${relativeDate(task.due).toLowerCase()}` : "no due date"}</small></div><small>${task.completed ? "Done" : task.type}</small></div>`).join("") + courses.map(course => `<div class="search-result" data-search-course="${course.id}"><span class="course-dot" style="--course-color:${course.color}"></span><div><strong>${e(course.name)}</strong><small>${e([course.teacher, course.room].filter(Boolean).join(" · ") || "Class details")}</small></div><small>Class</small></div>`).join("");
  document.querySelector("#search-results").innerHTML = results || '<div class="empty-state"><p>No matches.</p></div>';
}

document.addEventListener("click", event => {
  const openTask = event.target.closest("[data-open-task]");
  if (openTask) return openTaskModal();

  const taskDetail = event.target.closest("[data-task-detail]");
  if (taskDetail) openTaskDetails(taskDetail.dataset.taskDetail);

  const go = event.target.closest("[data-go]");
  if (go) location.hash = go.dataset.go;

  const focusTask = event.target.closest("[data-focus-task]");
  if (focusTask) {
    location.hash = "focus";
    setTimeout(() => { const select = document.querySelector("#focus-task"); if (select) select.value = focusTask.dataset.focusTask; }, 0);
  }

  const calendarNav = event.target.closest("[data-calendar-nav]");
  if (calendarNav) {
    if (calendarNav.dataset.calendarNav === "today") calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    else calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + (calendarNav.dataset.calendarNav === "next" ? 1 : -1), 1);
    renderCalendar();
  }

  const calendarDate = event.target.closest("[data-calendar-date]");
  if (calendarDate) { selectedDate = calendarDate.dataset.calendarDate; renderCalendar(); }

  const plannerButton = event.target.closest("[data-planner-view]");
  if (plannerButton) { plannerView = plannerButton.dataset.plannerView; renderPlanner(); }

  const deleteButton = event.target.closest("[data-delete-task]");
  if (deleteButton && confirm("Delete this task?")) {
    const task = state.tasks.find(item => item.id === deleteButton.dataset.deleteTask);
    if (task) tombstone("tasks", task);
    state.tasks = state.tasks.filter(task => task.id !== deleteButton.dataset.deleteTask);
    save(); render(); showToast("Task deleted.");
  }

  const courseWork = event.target.closest("[data-course-work]");
  if (courseWork) { plannerCourse = courseWork.dataset.courseWork; plannerView = "open"; location.hash = "planner"; }

  if (event.target.closest("[data-add-class]")) openClassModal();
  if (event.target.closest("[data-configure-schedule]")) openScheduleModal();
  const editClass = event.target.closest("[data-edit-class]");
  if (editClass) openClassModal(editClass.dataset.editClass);
  const deleteClass = event.target.closest("[data-delete-class]");
  if (deleteClass) {
    const course = state.courses.find(item => item.id === deleteClass.dataset.deleteClass);
    const taskCount = state.tasks.filter(task => task.courseId === course?.id).length;
    const gradeCount = state.gradeItems.filter(item => item.courseId === course?.id).length;
    if (taskCount || gradeCount) showToast(`Remove the linked ${taskCount ? `${taskCount} ${taskCount === 1 ? "task" : "tasks"}` : ""}${taskCount && gradeCount ? " and " : ""}${gradeCount ? `${gradeCount} grade ${gradeCount === 1 ? "item" : "items"}` : ""} first.`);
    else if (course && confirm(`Delete ${course.name}?`)) { tombstone("courses", course); state.courses = state.courses.filter(item => item.id !== course.id); save(); renderClasses(); showToast("Class deleted."); }
  }

  if (event.target.id === "add-subtask") {
    const input = document.querySelector("#subtask-title");
    const title = input.value.trim();
    if (title && detailDraft.subtasks.length < 100) {
      detailDraft.subtasks.push({ id: crypto.randomUUID(), title, completed: false });
      input.value = ""; renderDetailLists(); input.focus();
    }
  }
  const removeSubtask = event.target.closest("[data-remove-subtask]");
  if (removeSubtask) { detailDraft.subtasks = detailDraft.subtasks.filter(item => item.id !== removeSubtask.dataset.removeSubtask); renderDetailLists(); }
  if (event.target.id === "add-attachment") {
    const nameInput = document.querySelector("#attachment-name");
    const urlInput = document.querySelector("#attachment-url");
    const name = nameInput.value.trim();
    let url;
    try { url = new URL(urlInput.value.trim()); } catch {}
    if (!name || url?.protocol !== "https:") showToast("Add a name and a secure https:// link.");
    else if (detailDraft.attachments.length < 20) {
      detailDraft.attachments.push({ id: crypto.randomUUID(), name, url: url.href });
      nameInput.value = ""; urlInput.value = ""; renderDetailLists();
    }
  }
  const removeAttachment = event.target.closest("[data-remove-attachment]");
  if (removeAttachment) { detailDraft.attachments = detailDraft.attachments.filter(item => item.id !== removeAttachment.dataset.removeAttachment); renderDetailLists(); }

  if (event.target.closest("[data-timer-start]")) toggleTimer();
  if (event.target.closest("[data-timer-reset]")) resetTimer();
  if (event.target.closest("[data-timer-alert]")) toggleTimerAlerts();
  if (event.target.closest("#theme-button")) toggleTheme();

  if (event.target.closest("[data-export]")) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: `og-sync-backup-${dateKey()}.json` });
    link.click(); URL.revokeObjectURL(url); showToast("Backup exported.");
  }
  if (event.target.closest("[data-import]")) document.querySelector("#import-input").click();
  if (event.target.closest("[data-clear-work]") && confirm(`Delete every assignment and focus session${HOSTED ? " from all connected devices" : " from this browser"}?`)) {
    for (const task of state.tasks) tombstone("tasks", task);
    for (const session of state.sessions) tombstone("sessions", session);
    state.tasks = [];
    state.sessions = [];
    save(); render(); showToast("Assignments and focus history cleared.");
  }

  if (event.target.closest("[data-cloud-refresh]")) {
    if (cloud.dirty) pushCloudState();
    else pullCloud();
  }
  if (event.target.closest("[data-cloud-disconnect]")) {
    cloud.ready = false;
    cloud.revision = null;
    localStorage.removeItem(CLOUD_KEY_STORE);
    showCloudSignIn();
  }

  const openScraper = event.target.closest("[data-open-scraper]");
  if (openScraper) openScraperBrowser(openScraper.dataset.openScraper);
  const syncProvider = event.target.closest("[data-sync-provider]");
  if (syncProvider) runSync(syncProvider.dataset.syncProvider);
  if (event.target.closest("[data-retry-sync-status]")) refreshSyncStatus();

  const searchResult = event.target.closest("[data-search-result]");
  if (searchResult) { searchModal.close(); plannerView = "open"; plannerCourse = "all"; location.hash = "planner"; }
  if (event.target.closest("[data-search-course]")) { searchModal.close(); location.hash = "classes"; }
});

document.addEventListener("change", event => {
  if (event.target.closest("[data-timer-setting]")) updateFocusPlan();
  const toggle = event.target.closest("[data-toggle-task]");
  if (toggle) {
    const task = state.tasks.find(item => item.id === toggle.dataset.toggleTask);
    if (task) { task.completed = toggle.checked; save(); render(); showToast(toggle.checked ? "Task completed." : "Task reopened."); }
  }
  const subtask = event.target.closest("[data-detail-subtask]");
  if (subtask && detailDraft) {
    const item = detailDraft.subtasks.find(entry => entry.id === subtask.dataset.detailSubtask);
    if (item) { item.completed = subtask.checked; renderDetailLists(); }
  }
  if (event.target.id === "planner-course") { plannerCourse = event.target.value; renderPlanner(); }
});

document.querySelector("#task-form").addEventListener("submit", event => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return taskModal.close();
  const data = new FormData(event.currentTarget);
  state.tasks.push({ id: crypto.randomUUID(), title: data.get("title").trim(), courseId: data.get("course"), due: data.get("date"), time: data.get("time") || "23:59", type: data.get("type"), estimate: Number(data.get("estimate")), priority: data.get("priority"), completed: false, notes: "", teacherInstructions: "", subtasks: [], attachments: [] });
  save(); event.currentTarget.reset(); taskModal.close(); render(); showToast("Task added to your plan.");
});

document.querySelector("#task-detail-form").addEventListener("submit", event => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return taskDetailModal.close();
  const task = state.tasks.find(item => item.id === detailDraft?.id);
  if (!task) return taskDetailModal.close();
  const data = new FormData(event.currentTarget);
  task.teacherInstructions = data.get("teacherInstructions").trim();
  task.notes = data.get("notes").trim();
  task.subtasks = detailDraft.subtasks;
  task.attachments = detailDraft.attachments;
  save(); taskDetailModal.close(); render(); showToast("Assignment details saved.");
});

document.querySelector("#profile-button").addEventListener("click", () => {
  document.querySelector("#profile-name").value = state.profile.name;
  profileModal.showModal();
});

document.querySelector("#profile-form").addEventListener("submit", event => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return profileModal.close();
  state.profile.name = new FormData(event.currentTarget).get("name").trim() || "Student";
  save(); profileModal.close(); render(); showToast("Workspace updated.");
});

document.querySelector("#schedule-form").addEventListener("submit", event => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return scheduleModal.close();
  const data = new FormData(event.currentTarget);
  const labels = [data.get("labelA").trim(), data.get("labelB").trim()];
  if (!labels[0] || !labels[1] || labels[0].toLowerCase() === labels[1].toLowerCase()) return showToast("Use two different rotation names.");
  const previous = state.schoolSchedule.rotationLabels;
  for (const course of state.courses) for (const slot of course.schedule) {
    const index = previous.indexOf(slot.rotation);
    if (index >= 0) slot.rotation = labels[index];
  }
  state.schoolSchedule = { rotationLabels: labels, anchorDate: data.get("anchorDate") };
  save(); scheduleModal.close(); renderClasses(); showToast("School rotation updated.");
});

document.querySelector("#cloud-form").addEventListener("submit", async event => {
  event.preventDefault();
  const key = new FormData(event.currentTarget).get("key").trim();
  if (key.length < 32) return showCloudSignIn("Use the 43-character OG Sync key created during deployment.");
  cloud.key = key;
  cloud.revision = null;
  cloud.ready = true;
  cloud.dirty = false;
  document.querySelector("#cloud-key-error").textContent = "Connecting…";
  if (await pullCloud()) {
    localStorage.setItem(CLOUD_KEY_STORE, key);
    cloudModal.close();
    showToast("OG Sync cloud connected.");
  }
});

cloudModal.addEventListener("cancel", event => {
  if (!cloud.ready) event.preventDefault();
});

document.querySelector("#class-form").addEventListener("submit", event => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return classModal.close();
  const data = new FormData(event.currentTarget);
  const name = data.get("name").trim();
  const start = data.get("start");
  const end = data.get("end");
  const days = data.getAll("days").map(Number);
  if (!name) return showToast("Give the class a name.");
  if ((start || end || days.length) && (!start || !end || !days.length)) return showToast("A schedule needs meeting days, a start, and an end time.");
  if (start && start >= end) return showToast("End time must be after start time.");
  const id = data.get("id") || `course-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const existing = state.courses.findIndex(item => item.id === id);
  const course = { id, name, teacher: data.get("teacher").trim(), room: data.get("room").trim(), color: data.get("color"), schedule: days.map(day => ({ day, start, end, period: data.get("period").trim(), rotation: data.get("rotation") })), ...(existing >= 0 && state.courses[existing].sources ? { sources: state.courses[existing].sources } : {}) };
  if (existing >= 0) state.courses[existing] = course;
  else state.courses.push(course);
  save(); classModal.close(); renderClasses(); showToast(existing >= 0 ? "Class updated." : "Class added.");
});

document.querySelector("#search-button").addEventListener("click", () => {
  document.querySelector("#global-search").value = "";
  renderSearch(); searchModal.showModal();
  setTimeout(() => document.querySelector("#global-search").focus(), 50);
});
document.querySelector("#global-search").addEventListener("input", event => renderSearch(event.target.value));

document.querySelector("#import-input").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!validState(data)) throw new Error("Invalid backup");
    state = ensureTombstones(data); window.DaymarkSync.migrateState(state); applyTombstones(state); save(); render(); showToast("Backup imported.");
  } catch (_) { showToast("That file is not a valid OG Sync backup."); }
  event.target.value = "";
});

window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { tickTimer(); autoSync(); } });
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
if (!location.hash) history.replaceState(null, "", "#dashboard");
render();
if (HOSTED && !cloud.key) showCloudSignIn();
else setTimeout(autoSync, 1_500);
setInterval(autoSync, HOSTED ? 15_000 : 60_000);
