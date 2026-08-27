const STORE_KEY = "daymark-state-v2";
const CLOUD_KEY_STORE = "daymark-cloud-key-v1";
const DAY = 86_400_000;
const HOSTED = !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

const icons = {
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>'
};

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
    sync: {},
    tombstones: { tasks: {}, courses: {}, sessions: {}, sources: {} }
  };
}

function ensureTombstones(target) {
  target.sync ||= {};
  target.tombstones ||= {};
  for (const key of ["tasks", "courses", "sessions", "sources"]) target.tombstones[key] ||= {};
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
  const sources = value => value === undefined || (Array.isArray(value) && value.length <= 10 && value.every(source => source && /^[a-z0-9-]{1,30}$/.test(source.provider) && text(source.id, 200)));
  if (!data || !text(data.profile?.name, 30) || !Array.isArray(data.courses) || data.courses.length > 30 || !Array.isArray(data.tasks) || data.tasks.length > 5000 || !Array.isArray(data.sessions) || data.sessions.length > 5000) return false;
  if (!data.courses.every(course => id(course.id) && text(course.name, 80) && text(course.teacher, 80) && text(course.room, 40) && /^#[0-9a-f]{6}$/i.test(course.color) && sources(course.sources) && Array.isArray(course.schedule) && course.schedule.length <= 20 && course.schedule.every(slot => Number.isInteger(slot.day) && slot.day >= 0 && slot.day <= 6 && time(slot.start) && time(slot.end)))) return false;
  const courseIds = new Set(data.courses.map(course => course.id));
  if (!data.tasks.every(task => id(task.id) && text(task.title, 100) && (courseIds.has(task.courseId) || task.courseId === "personal") && (task.due === "" || date(task.due)) && time(task.time) && text(task.type, 30) && Number.isFinite(task.estimate) && task.estimate >= 0 && task.estimate <= 1440 && ["low", "normal", "high"].includes(task.priority) && typeof task.completed === "boolean" && sources(task.sources) && (task.url === undefined || task.url === "" || (text(task.url, 2000) && /^https:\/\//.test(task.url))) && (task.description === undefined || text(task.description, 5000)))) return false;
  if (!data.sessions.every(session => id(session.id) && date(session.date) && Number.isFinite(session.minutes) && session.minutes >= 0 && session.minutes <= 1440 && text(session.label, 100))) return false;
  const validMap = value => value === undefined || (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= 5000 && Object.entries(value).every(([key, stamp]) => key.length <= 300 && Number.isFinite(Date.parse(stamp))));
  return data.tombstones === undefined || (data.tombstones && ["tasks", "courses", "sessions", "sources"].every(key => validMap(data.tombstones[key])));
}

let state = loadState();
let plannerView = "open";
let plannerCourse = "all";
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDate = dateKey();
let toastTimer;
const timer = { mode: "focus", total: 25 * 60, remaining: 25 * 60, running: false, deadline: 0, interval: null };

const app = document.querySelector("#app-content");
const taskModal = document.querySelector("#task-modal");
const searchModal = document.querySelector("#search-modal");
const profileModal = document.querySelector("#profile-modal");
const classModal = document.querySelector("#class-modal");
const cloudModal = document.querySelector("#cloud-modal");
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

function applyTombstones(target) {
  ensureTombstones(target);
  const deleted = target.tombstones;
  target.tasks = target.tasks.filter(task => !deleted.tasks[task.id] && !(task.sources || []).some(source => deleted.sources[window.DaymarkSync.sourceKey(source.provider, source.id)]));
  target.sessions = target.sessions.filter(session => !deleted.sessions[session.id]);
  const usedCourses = new Set(target.tasks.map(task => task.courseId));
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
    sync,
    tombstones: {}
  };
  for (const key of ["tasks", "courses", "sessions", "sources"]) merged.tombstones[key] = newestTombstones(remote.tombstones[key], local.tombstones[key]);
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
      throw new Error("Invalid Daymark sync key");
    }
    if (!response.ok || !validState(result.state)) throw new Error(result.error || "Cloud sync failed");
    state = ensureTombstones(result.state);
    cloud.revision = result.revision || null;
    cloud.ready = true;
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    setCloudLabel("Cloud synced");
    render();
    return true;
  } catch (error) {
    setCloudLabel("Cloud offline · saved here");
    if (!quiet && error.message !== "Invalid Daymark sync key") showToast(error.message);
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
        throw new Error("Invalid Daymark sync key");
      }
      if (!response.ok) throw new Error(result.error || "Could not save to cloud");
      cloud.revision = result.revision || null;
    }
    setCloudLabel(cloud.dirty ? "Cloud retry needed" : "Cloud synced");
  } catch (error) {
    cloud.dirty = true;
    setCloudLabel("Cloud offline · saved here");
    if (error.message !== "Invalid Daymark sync key") showToast(`${error.message}. Your changes are saved on this device.`);
    cloud.retryTimer = setTimeout(pushCloudState, 30_000);
  } finally {
    cloud.saving = false;
    if (cloud.dirty && cloud.ready && !cloud.retryTimer) cloud.timer = setTimeout(pushCloudState, 500);
  }
}

function taskRows(tasks, actions = false) {
  if (!tasks.length) return '<div class="empty-state"><span class="empty-icon">✓</span><h3>Nothing here</h3><p>You have a little breathing room.</p></div>';
  return `<div class="task-list">${tasks.map(task => {
    const course = courseFor(task.courseId);
    const overdue = !task.completed && dueTimestamp(task) < Date.now() && task.due !== dateKey();
    return `<div class="task-row ${task.completed ? "done" : ""}">
      <input class="task-check" type="checkbox" data-toggle-task="${task.id}" ${task.completed ? "checked" : ""} aria-label="Mark ${e(task.title)} complete" />
      <div><p class="task-title">${task.url ? `<a href="${e(task.url)}" target="_blank" rel="noreferrer">${e(task.title)} ↗</a>` : e(task.title)}</p><div class="task-meta"><span class="course-dot" style="--course-color:${course.color}"></span>${e(course.name)} · ${e(task.type)} · ${task.estimate || 25} min</div></div>
      <div style="display:flex;align-items:center"><div class="task-due ${overdue ? "overdue" : ""}"><strong>${overdue ? "Overdue" : relativeDate(task.due)}</strong><span>${formatTime(task.time)}</span></div>${actions ? `<div class="task-actions"><button class="mini-action" data-delete-task="${task.id}" aria-label="Delete ${e(task.title)}">${icons.trash}</button></div>` : ""}</div>
    </div>`;
  }).join("")}</div>`;
}

function nextClass() {
  const now = new Date();
  const candidates = [];
  for (let offset = 0; offset < 8; offset++) {
    const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    for (const course of state.courses) {
      for (const slot of course.schedule || []) {
        if (slot.day !== dayDate.getDay()) continue;
        const [hour, minute] = slot.start.split(":").map(Number);
        const starts = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour, minute);
        if (starts > now) candidates.push({ course, slot, starts, offset });
      }
    }
  }
  return candidates.sort((a, b) => a.starts - b.starts)[0];
}

function weekData() {
  const now = new Date();
  const mondayOffset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset, 12);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index, 12);
    const key = dateKey(date);
    return { key, label: date.toLocaleDateString(undefined, { weekday: "narrow" }), minutes: state.sessions.filter(s => s.date === key).reduce((sum, s) => sum + s.minutes, 0), today: key === dateKey() };
  });
}

function renderDashboard() {
  const todayTasks = sortTasks(state.tasks.filter(task => task.due && task.due <= dateKey())).slice(0, 6);
  const dueToday = state.tasks.filter(task => task.due === dateKey());
  const completed = dueToday.filter(task => task.completed).length;
  const percent = dueToday.length ? Math.round(completed / dueToday.length * 100) : 0;
  const openTasks = state.tasks.filter(task => !task.completed).length;
  const next = nextClass();
  const week = weekData();
  const maxMinutes = Math.max(...week.map(day => day.minutes), 50);
  const focusTask = sortTasks(state.tasks.filter(task => !task.completed))[0];
  const firstName = state.profile.name ? `, ${e(state.profile.name)}` : "";

  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><span class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span><h1>${greeting()}${firstName}.</h1><p>${openTasks ? `You have ${openTasks} open ${openTasks === 1 ? "task" : "tasks"}. Let’s make the next one count.` : "Everything is handled. Enjoy the clear desk."}</p></div></div>
    <div class="hero-strip">
      <article class="card hero-focus"><span class="eyebrow">Suggested focus</span><h2>${focusTask ? e(focusTask.title) : "A clear desk is a good feeling."}</h2><p>${focusTask ? `${e(courseFor(focusTask.courseId).name)} · ${focusTask.estimate || 25} minute estimate · ${focusTask.due ? `due ${relativeDate(focusTask.due).toLowerCase()}` : "no due date"}` : "You have no open assignments right now."}</p>${focusTask ? `<button class="button" data-focus-task="${focusTask.id}">Start a focus session ${icons.arrow}</button>` : ""}</article>
      <article class="card progress-card"><div><span class="eyebrow">Today’s progress</span><h3>${dueToday.length ? `${completed} of ${dueToday.length} complete` : "No work due"}</h3><p>${!dueToday.length ? "Your day is open." : percent === 100 ? "Nicely done." : "One task at a time."}</p></div><div class="progress-ring" style="--value:${percent * 3.6}deg"><strong>${percent}%</strong></div></article>
    </div>
    <div class="dashboard-grid">
      <article class="card"><div class="card-header"><div><h2>Today’s plan</h2><p>Due and overdue work, ordered by urgency</p></div><button class="text-link" data-go="planner">Open planner →</button></div>${taskRows(todayTasks)}</article>
      <div class="dashboard-stack">
        ${next ? `<article class="card next-card"><div class="next-card-top" style="--class-bg:${next.course.color}"><span class="eyebrow">Next class</span><h3>${e(next.course.name)}</h3><p>${e(next.course.teacher)} · ${e(next.course.room)}</p></div><div class="next-card-bottom"><div class="next-time"><strong>${next.offset === 0 ? "Today" : next.offset === 1 ? "Tomorrow" : next.starts.toLocaleDateString(undefined, { weekday: "long" })}, ${formatTime(next.slot.start)}</strong><span>Ends ${formatTime(next.slot.end)}</span></div>${icons.arrow}</div></article>` : ""}
        <article class="card week-stats"><h3>Focus this week</h3><div class="week-bars">${week.map(day => `<div class="day-bar ${day.today ? "today" : ""}"><div class="bar-track" title="${day.minutes} minutes"><span class="bar-fill" style="height:${Math.max(6, day.minutes / maxMinutes * 100)}%"></span></div><span>${day.label}</span></div>`).join("")}</div></article>
      </div>
    </div>
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
    <div class="page-heading"><div><span class="eyebrow">Everything in one place</span><h1>Calendar</h1><p>See assignments, quizzes, projects, and tests before they become emergencies.</p></div><button class="button button-dark" data-open-task>+ Add item</button></div>
    <div class="calendar-layout">
      <article class="card calendar-card">
        <div class="calendar-toolbar"><h2>${calendarCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><div class="toolbar-group"><button class="button button-quiet" data-calendar-nav="today">Today</button><button class="icon-button" data-calendar-nav="prev" aria-label="Previous month">${icons.left}</button><button class="icon-button" data-calendar-nav="next" aria-label="Next month">${icons.right}</button></div></div>
        <div class="weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => `<span>${day}</span>`).join("")}</div>
        <div class="calendar-grid">${calendarCells()}</div>
      </article>
      <aside class="card agenda-card"><div class="agenda-date"><span class="eyebrow">Selected day</span><strong>${parseDate(selectedDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</strong></div><div class="agenda-list">${selectedTasks.length ? selectedTasks.map(task => `<div class="agenda-item" style="--item-color:${courseFor(task.courseId).color}"><strong>${e(task.title)}</strong><span>${e(courseFor(task.courseId).name)} · ${formatTime(task.time)}</span></div>`).join("") : '<div class="empty-state"><h3>No due dates</h3><p>This day is clear.</p></div>'}</div></aside>
    </div>
  </section>`;
}

function plannerGroups(tasks) {
  const groups = [
    { label: "Overdue", test: task => dueTimestamp(task) < Date.now() && task.due !== dateKey() && !task.completed },
    { label: "Today", test: task => task.due === dateKey() && !task.completed },
    { label: "Tomorrow", test: task => task.due === addDays(1) && !task.completed },
    { label: "Later", test: task => task.due && task.due > addDays(1) && !task.completed },
    { label: "No due date", test: task => !task.due && !task.completed },
    { label: "Completed", test: task => task.completed }
  ];
  const used = new Set();
  return groups.map(group => {
    let items = tasks.filter(task => group.test(task) && !used.has(task.id));
    items.forEach(task => used.add(task.id));
    return { ...group, items: sortTasks(items) };
  }).filter(group => group.items.length);
}

function renderPlanner() {
  let tasks = state.tasks.filter(task => plannerCourse === "all" || task.courseId === plannerCourse);
  if (plannerView === "open") tasks = tasks.filter(task => !task.completed);
  if (plannerView === "today") tasks = tasks.filter(task => task.due && task.due <= dateKey() && !task.completed);
  if (plannerView === "week") tasks = tasks.filter(task => task.due >= dateKey() && task.due <= addDays(7) && !task.completed);
  if (plannerView === "done") tasks = tasks.filter(task => task.completed);
  const groups = plannerGroups(tasks);
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><span class="eyebrow">Plan without the clutter</span><h1>Planner</h1><p>Keep the next action visible and everything else out of your head.</p></div><button class="button button-dark" data-open-task>+ Add task</button></div>
    <div class="planner-toolbar"><div class="segmented">${[["open","Open"],["today","Today"],["week","Next 7 days"],["done","Completed"]].map(([value,label]) => `<button class="segment ${plannerView === value ? "active" : ""}" data-planner-view="${value}">${label}</button>`).join("")}</div><select class="filter-select" id="planner-course" aria-label="Filter by class"><option value="all">All classes</option>${state.courses.map(course => `<option value="${course.id}" ${plannerCourse === course.id ? "selected" : ""}>${e(course.name)}</option>`).join("")}</select></div>
    ${groups.length ? groups.map(group => `<article class="card planner-group"><div class="planner-group-title"><h2>${group.label}</h2><span>${group.items.length} ${group.items.length === 1 ? "item" : "items"}</span></div>${taskRows(group.items, true)}</article>`).join("") : '<article class="card empty-state"><span class="empty-icon">✓</span><h3>This view is clear</h3><p>Change the filter or add a new task.</p></article>'}
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
    <div class="page-heading"><div><span class="eyebrow">One thing at a time</span><h1>Focus</h1><p>Pick a task, start the clock, and give it your full attention.</p></div></div>
    <div class="focus-layout">
      <article class="card timer-card"><div class="timer-inner">
        <div class="timer-modes">${[["focus","Focus · 25"],["deep","Deep work · 50"],["break","Break · 5"]].map(([value,label]) => `<button class="timer-mode ${timer.mode === value ? "active" : ""}" data-timer-mode="${value}">${label}</button>`).join("")}</div>
        <div class="timer-ring" id="timer-ring"><div class="timer-display"><strong id="timer-time">${timerText()}</strong><span id="timer-label">${timer.running ? "Stay with it" : "Ready when you are"}</span></div></div>
        <div class="timer-controls"><button class="button button-dark" id="timer-start" data-timer-start>${timer.running ? "Pause" : timer.remaining < timer.total ? "Resume" : "Start session"}</button><button class="button button-quiet" data-timer-reset>Reset</button></div>
        <select class="focus-task-select" id="focus-task" aria-label="Task for this focus session"><option value="">General focus</option>${open.map(task => `<option value="${task.id}">${e(task.title)} · ${e(courseFor(task.courseId).name)}</option>`).join("")}</select>
      </div></article>
      <aside class="focus-side">
        <article class="card stat-card"><span class="eyebrow">Focused today</span><strong class="big-stat">${totalToday}<small> min</small></strong><span class="stat-caption">${totalToday >= 50 ? "Strong work." : "A session is a good start."}</span></article>
        <article class="card stat-card"><span class="eyebrow">Current streak</span><strong class="big-stat">${streak()}<small> days</small></strong><span class="stat-caption">5+ minutes counts</span></article>
        <article class="card"><div class="card-header"><div><h3>Recent sessions</h3><p>Your last focused blocks</p></div></div><div class="session-list">${state.sessions.length ? state.sessions.slice().sort((a,b) => parseDate(b.date) - parseDate(a.date)).slice(0,5).map(session => `<div class="session-item"><span class="session-icon">${icons.clock}</span><div><strong>${e(session.label || "General focus")}</strong><span>${relativeDate(session.date)}</span></div><span class="session-minutes">${session.minutes} min</span></div>`).join("") : '<div class="empty-state"><p>Your finished sessions appear here.</p></div>'}</div></article>
      </aside>
    </div>
  </section>`;
  updateTimerDisplay();
}

function scheduleText(course) {
  const days = [...new Set((course.schedule || []).map(slot => slot.day))];
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (days.length === 5 && days.every(day => day >= 1 && day <= 5)) return "Weekdays";
  return days.map(day => labels[day]).join(", ") || "No schedule";
}

function renderClasses() {
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div><span class="eyebrow">Your school day</span><h1>Classes</h1><p>Add the details you know now; change them whenever your schedule changes.</p></div><button class="button button-dark" data-add-class>+ Add class</button></div>
    ${state.courses.length ? `<div class="classes-grid">${state.courses.map(course => {
      const tasks = sortTasks(state.tasks.filter(task => task.courseId === course.id && !task.completed));
      const slot = course.schedule?.[0];
      const details = [course.teacher, course.room].filter(Boolean).map(e).join(" · ");
      return `<article class="card class-card"><div class="class-color" style="--class-bg:${course.color}"><span class="eyebrow">${tasks.length} open ${tasks.length === 1 ? "item" : "items"}</span><h2>${e(course.name)}</h2><p>${details || "No teacher or room added"}</p></div><div class="class-details"><div class="class-detail-row"><span>Schedule</span><strong>${scheduleText(course)}${slot ? ` · ${formatTime(slot.start)}` : ""}</strong></div><div class="class-detail-row"><span>Next due</span><strong>${tasks[0] ? `${relativeDate(tasks[0].due)} · ${e(tasks[0].title)}` : "All clear"}</strong></div><div style="display:flex;align-items:center;justify-content:space-between;margin-top:15px"><button class="text-link" data-course-work="${course.id}">View class work →</button><div style="display:flex"><button class="mini-action" data-edit-class="${course.id}" aria-label="Edit ${e(course.name)}">✎</button><button class="mini-action" data-delete-class="${course.id}" aria-label="Delete ${e(course.name)}">${icons.trash}</button></div></div></div></article>`;
    }).join("")}</div>` : '<article class="card empty-state"><span class="empty-icon">＋</span><h3>Add your first class</h3><p>Your assignments and schedule will organize around it.</p><button class="button button-dark" data-add-class style="margin-top:16px">Add class</button></article>'}
  </section>`;
}

function renderSync() {
  if (HOSTED) {
    app.innerHTML = `<section class="page">
      <div class="page-heading"><div class="sync-intro"><span class="eyebrow">Available anywhere</span><h1>Cloud sync</h1><p>Your planner is protected by your private Daymark sync key. The trusted Mac imports school data; this browser receives the normalized assignments.</p></div><button class="button button-quiet" data-cloud-refresh>Refresh now</button></div>
      <div class="sync-grid">
        ${cloudProviderCard("google", "G", "Google Classroom")}
        ${cloudProviderCard("blackbaud", "B", "My Oak Grove · Blackbaud")}
        <article class="card integration-card"><div class="integration-top"><span class="integration-logo">☁</span><span class="status-pill connected">Connected</span></div><h2>Daymark cloud</h2><p>This device saves planner changes to your private Vercel storage. School passwords and provider cookies never leave your Mac.</p><button class="button button-quiet" data-cloud-disconnect>Change sync key</button></article>
        <article class="card integration-card"><div class="integration-top"><span class="integration-logo">↕</span><span class="status-pill">Backup</span></div><h2>Export or restore</h2><p>Keep a portable JSON backup, or restore one and send it to your cloud workspace.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="button button-dark" data-export>Export data</button><button class="button button-quiet" data-import>Import backup</button></div></article>
        <article class="card integration-card"><div class="integration-top"><span class="integration-logo">⌫</span><span class="status-pill">All devices</span></div><h2>Clear assignments & history</h2><p>Remove every task and focus session from Daymark while keeping your class setup and profile.</p><button class="button button-quiet danger-link" data-clear-work>Clear work data</button></article>
        <aside class="card privacy-card"><span class="integration-logo">${icons.shield}</span><div><h3>Your school credentials are not in Vercel.</h3><p>The Mac helper keeps Google and Blackbaud sessions in .data/scraper-profile and uploads only classes, assignment details, and sync timestamps.</p></div></aside>
      </div>
    </section>`;
    return;
  }
  app.innerHTML = `<section class="page">
    <div class="page-heading"><div class="sync-intro"><span class="eyebrow">Bring school into focus</span><h1>Browser import</h1><p>Sign in through a dedicated browser window, then Daymark reads the assignments shown to your student account. Repeated imports update existing work instead of duplicating it.</p></div></div>
    <div class="sync-grid">
      ${integrationCard("google", "G", "Google Classroom", "Read assignments from Classroom’s To-do views using a separate browser profile where you sign in normally.")}
      ${integrationCard("blackbaud", "B", "My Oak Grove · Blackbaud", "Read assignments currently shown in My Day → Assignment Center using your signed-in browser session.")}
      <article class="card integration-card"><div class="integration-top"><span class="integration-logo">↕</span><span class="status-pill">Works now</span></div><h2>Backup & transfer</h2><p>Export your local workspace as JSON or restore a previous Daymark backup on this device.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="button button-dark" data-export>Export data</button><button class="button button-quiet" data-import>Import backup</button></div></article>
      <article class="card integration-card"><div class="integration-top"><span class="integration-logo">⌫</span><span class="status-pill">Local data</span></div><h2>Clear assignments & history</h2><p>Remove every task and focus session while keeping your class setup and profile.</p><button class="button button-quiet danger-link" data-clear-work>Clear work data</button></article>
      <aside class="card privacy-card"><span class="integration-logo">${icons.shield}</span><div><h3>Passwords stay on the official sign-in pages.</h3><p>Daymark stores the dedicated browser session locally in .data/scraper-profile. It never asks for, receives, logs, or saves your Google or Blackbaud password.</p></div></aside>
    </div>
  </section>`;
  refreshSyncStatus();
}

function cloudProviderCard(provider, mark, title) {
  const result = state.sync?.[syncStateKeys[provider]];
  const connected = Number.isFinite(Date.parse(result?.lastSyncedAt || ""));
  return `<article class="card integration-card"><div class="integration-top"><span class="integration-logo ${provider}">${mark}</span><span class="status-pill ${connected ? "connected" : ""}">${connected ? "Synced by Mac" : "Waiting for Mac"}</span></div><h2>${title}</h2><p>${connected ? lastSyncText(provider) : "Run the Daymark helper on your trusted Mac once to send this service’s assignments to the cloud."}</p></article>`;
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
  return `Last result: ${Number(result.imported || 0)} new, ${checked} existing. Synced ${new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`;
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
  detail.textContent = `${provider === "blackbaud" ? "Daymark reads your signed-in Assignment Center. " : "Daymark checks Assigned, Missing, and Done views. "}${lastSyncText(provider)}`;
}

async function readSyncStatus() {
  if (HOSTED) throw new Error("School imports run on your trusted Mac.");
  const response = await fetch("/api/status", { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error("The Daymark sync server is not running. Start it with npm start.");
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
      showToast(counts.imported ? `${counts.imported} new ${counts.imported === 1 ? "assignment" : "assignments"}; ${existing} existing checked or updated.` : `No duplicates added; ${existing} assignments checked.`);
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
  return ["dashboard", "calendar", "planner", "focus", "classes", "sync"].includes(value) ? value : "dashboard";
}

function render() {
  const page = currentPage();
  document.querySelectorAll(".nav-item[data-page]").forEach(item => item.classList.toggle("active", item.dataset.page === page));
  document.querySelector("#planner-count").textContent = state.tasks.filter(task => !task.completed).length;
  document.querySelector(".profile-button strong").textContent = state.profile.name || "Your workspace";
  document.querySelector(".avatar").textContent = (state.profile.name || "S").trim()[0].toUpperCase();
  document.querySelector("#topbar-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  ({ dashboard: renderDashboard, calendar: renderCalendar, planner: renderPlanner, focus: renderFocus, classes: renderClasses, sync: renderSync })[page]();
  app.focus({ preventScroll: true });
}

function timerText() {
  const minutes = Math.floor(timer.remaining / 60);
  const seconds = timer.remaining % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  const display = document.querySelector("#timer-time");
  const ring = document.querySelector("#timer-ring");
  const label = document.querySelector("#timer-label");
  const button = document.querySelector("#timer-start");
  if (display) display.textContent = timerText();
  if (ring) ring.style.setProperty("--progress", `${(1 - timer.remaining / timer.total) * 360}deg`);
  if (label) label.textContent = timer.running ? (timer.mode === "break" ? "Take a real break" : "Stay with it") : "Ready when you are";
  if (button) button.textContent = timer.running ? "Pause" : timer.remaining < timer.total ? "Resume" : "Start session";
  document.title = timer.running ? `${timerText()} · Daymark` : "Daymark — School planner";
}

function tickTimer() {
  if (!timer.running) return;
  timer.remaining = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000));
  updateTimerDisplay();
  if (timer.remaining > 0) return;
  timer.running = false;
  clearInterval(timer.interval);
  if (timer.mode !== "break") {
    const taskId = document.querySelector("#focus-task")?.value;
    const task = state.tasks.find(item => item.id === taskId);
    state.sessions.push({ id: crypto.randomUUID(), date: dateKey(), minutes: Math.round(timer.total / 60), label: task?.title || "General focus" });
    save();
  }
  showToast(timer.mode === "break" ? "Break complete. Ready for another round?" : "Focus session complete. Nice work.");
  render();
}

function toggleTimer() {
  if (timer.running) {
    timer.remaining = Math.max(0, Math.ceil((timer.deadline - Date.now()) / 1000));
    timer.running = false;
    clearInterval(timer.interval);
  } else {
    if (!timer.remaining) timer.remaining = timer.total;
    timer.running = true;
    timer.deadline = Date.now() + timer.remaining * 1000;
    timer.interval = setInterval(tickTimer, 250);
  }
  updateTimerDisplay();
}

function setTimerMode(mode) {
  clearInterval(timer.interval);
  const minutes = { focus: 25, deep: 50, break: 5 }[mode];
  Object.assign(timer, { mode, total: minutes * 60, remaining: minutes * 60, running: false, deadline: 0 });
  renderFocus();
}

function openTaskModal() {
  const select = document.querySelector("#task-course");
  select.innerHTML = state.courses.map(course => `<option value="${course.id}">${e(course.name)}</option>`).join("") + '<option value="personal">Personal</option>';
  document.querySelector("#task-date").value = addDays(1);
  taskModal.showModal();
  setTimeout(() => document.querySelector("#task-title").focus(), 50);
}

function openClassModal(id = "") {
  const form = document.querySelector("#class-form");
  form.reset();
  document.querySelector("#class-id").value = id;
  document.querySelector("#class-modal-title").textContent = id ? "Edit class" : "Add a class";
  document.querySelector("#class-color").value = ["#ddd5f4", "#f2d6a2", "#d9e8c7", "#cae8d7", "#f3d6dc", "#cfe1f4"][state.courses.length % 6];
  if (id) {
    const course = state.courses.find(item => item.id === id);
    if (!course) return;
    document.querySelector("#class-name").value = course.name;
    document.querySelector("#class-teacher").value = course.teacher;
    document.querySelector("#class-room").value = course.room;
    document.querySelector("#class-color").value = course.color;
    document.querySelector("#class-start").value = course.schedule[0]?.start || "";
    document.querySelector("#class-end").value = course.schedule[0]?.end || "";
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
  const editClass = event.target.closest("[data-edit-class]");
  if (editClass) openClassModal(editClass.dataset.editClass);
  const deleteClass = event.target.closest("[data-delete-class]");
  if (deleteClass) {
    const course = state.courses.find(item => item.id === deleteClass.dataset.deleteClass);
    const taskCount = state.tasks.filter(task => task.courseId === course?.id).length;
    if (taskCount) showToast(`Move or delete ${taskCount} linked ${taskCount === 1 ? "task" : "tasks"} first.`);
    else if (course && confirm(`Delete ${course.name}?`)) { tombstone("courses", course); state.courses = state.courses.filter(item => item.id !== course.id); save(); renderClasses(); showToast("Class deleted."); }
  }

  const timerMode = event.target.closest("[data-timer-mode]");
  if (timerMode) setTimerMode(timerMode.dataset.timerMode);
  if (event.target.closest("[data-timer-start]")) toggleTimer();
  if (event.target.closest("[data-timer-reset]")) { clearInterval(timer.interval); timer.running = false; timer.remaining = timer.total; updateTimerDisplay(); }

  if (event.target.closest("[data-export]")) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: `daymark-backup-${dateKey()}.json` });
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
  const toggle = event.target.closest("[data-toggle-task]");
  if (toggle) {
    const task = state.tasks.find(item => item.id === toggle.dataset.toggleTask);
    if (task) { task.completed = toggle.checked; save(); render(); showToast(toggle.checked ? "Task completed." : "Task reopened."); }
  }
  if (event.target.id === "planner-course") { plannerCourse = event.target.value; renderPlanner(); }
});

document.querySelector("#task-form").addEventListener("submit", event => {
  event.preventDefault();
  if (event.submitter?.value === "cancel") return taskModal.close();
  const data = new FormData(event.currentTarget);
  state.tasks.push({ id: crypto.randomUUID(), title: data.get("title").trim(), courseId: data.get("course"), due: data.get("date"), time: data.get("time") || "23:59", type: data.get("type"), estimate: Number(data.get("estimate")), priority: data.get("priority"), completed: false });
  save(); event.currentTarget.reset(); taskModal.close(); render(); showToast("Task added to your plan.");
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

document.querySelector("#cloud-form").addEventListener("submit", async event => {
  event.preventDefault();
  const key = new FormData(event.currentTarget).get("key").trim();
  if (key.length < 32) return showCloudSignIn("Use the 43-character Daymark sync key created during deployment.");
  cloud.key = key;
  cloud.revision = null;
  cloud.ready = true;
  cloud.dirty = false;
  document.querySelector("#cloud-key-error").textContent = "Connecting…";
  if (await pullCloud()) {
    localStorage.setItem(CLOUD_KEY_STORE, key);
    cloudModal.close();
    showToast("Daymark cloud connected.");
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
  const course = { id, name, teacher: data.get("teacher").trim(), room: data.get("room").trim(), color: data.get("color"), schedule: days.map(day => ({ day, start, end })), ...(existing >= 0 && state.courses[existing].sources ? { sources: state.courses[existing].sources } : {}) };
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
  } catch (_) { showToast("That file is not a valid Daymark backup."); }
  event.target.value = "";
});

window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { tickTimer(); autoSync(); } });
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
if (!location.hash) history.replaceState(null, "", "#dashboard");
render();
if (HOSTED && !cloud.key) showCloudSignIn();
else setTimeout(autoSync, 1_500);
setInterval(autoSync, HOSTED ? 60_000 : 15 * 60_000);
