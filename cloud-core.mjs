import DaymarkSync from "./sync.js";

const MAX_ITEMS = 5000;
const DEFAULT_COURSES = [
  ["algebra-2", "Algebra 2", "#ddd5f4"],
  ["english-10", "English 10", "#f2d6a2"],
  ["the-church", "The Church", "#d9e8c7"],
  ["chemistry", "Chemistry", "#cae8d7"],
  ["german-1", "German 1", "#f3d6dc"],
  ["western-civ", "Western Civ", "#cfe1f4"],
  ["band", "Band", "#d7dded"]
];

export function defaultState() {
  return {
    profile: { name: "" },
    courses: DEFAULT_COURSES.map(([id, name, color]) => ({ id, name, teacher: "", room: "", color, schedule: [] })),
    tasks: [],
    sessions: [],
    sync: {},
    tombstones: { tasks: {}, courses: {}, sessions: {}, sources: {} }
  };
}

function validMap(value, limit = MAX_ITEMS) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= limit && Object.entries(value).every(([key, time]) => key.length <= 300 && Number.isFinite(Date.parse(time)));
}

export function validState(data) {
  const id = value => typeof value === "string" && /^[\w-]{1,64}$/.test(value);
  const text = (value, max) => typeof value === "string" && value.length <= max;
  const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00`));
  const time = value => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const sources = value => value === undefined || (Array.isArray(value) && value.length <= 10 && value.every(source => source && /^[a-z0-9-]{1,30}$/.test(source.provider) && text(source.id, 200)));
  if (!data || !text(data.profile?.name, 30) || !Array.isArray(data.courses) || data.courses.length > 30 || !Array.isArray(data.tasks) || data.tasks.length > MAX_ITEMS || !Array.isArray(data.sessions) || data.sessions.length > MAX_ITEMS) return false;
  if (!data.courses.every(course => id(course.id) && text(course.name, 80) && text(course.teacher, 80) && text(course.room, 40) && /^#[0-9a-f]{6}$/i.test(course.color) && sources(course.sources) && Array.isArray(course.schedule) && course.schedule.length <= 20 && course.schedule.every(slot => Number.isInteger(slot.day) && slot.day >= 0 && slot.day <= 6 && time(slot.start) && time(slot.end)))) return false;
  const courseIds = new Set(data.courses.map(course => course.id));
  if (!data.tasks.every(task => id(task.id) && text(task.title, 100) && (courseIds.has(task.courseId) || task.courseId === "personal") && (task.due === "" || date(task.due)) && time(task.time) && text(task.type, 30) && Number.isFinite(task.estimate) && task.estimate >= 0 && task.estimate <= 1440 && ["low", "normal", "high"].includes(task.priority) && typeof task.completed === "boolean" && sources(task.sources) && (task.url === undefined || task.url === "" || (text(task.url, 2000) && /^https:\/\//.test(task.url))) && (task.description === undefined || text(task.description, 5000)))) return false;
  if (!data.sessions.every(session => id(session.id) && date(session.date) && Number.isFinite(session.minutes) && session.minutes >= 0 && session.minutes <= 1440 && text(session.label, 100))) return false;
  if (data.sync !== undefined && (!data.sync || typeof data.sync !== "object" || Array.isArray(data.sync) || Object.keys(data.sync).length > 20)) return false;
  if (data.tombstones !== undefined && (!data.tombstones || !["tasks", "courses", "sessions", "sources"].every(key => validMap(data.tombstones[key] || {})))) return false;
  return true;
}

export function normalizeState(input) {
  const state = structuredClone(input);
  state.sync ||= {};
  state.tombstones ||= {};
  for (const key of ["tasks", "courses", "sessions", "sources"]) state.tombstones[key] ||= {};
  DaymarkSync.migrateState(state);
  applyTombstones(state);
  return state;
}

function newestMap(first = {}, second = {}) {
  const result = { ...first };
  for (const [key, value] of Object.entries(second)) {
    if (!result[key] || Date.parse(value) > Date.parse(result[key])) result[key] = value;
  }
  return result;
}

function mergeById(remote, local) {
  const result = new Map(remote.map(item => [item.id, structuredClone(item)]));
  for (const item of local) result.set(item.id, structuredClone(item));
  return [...result.values()];
}

function applyTombstones(state) {
  const deleted = state.tombstones;
  state.tasks = state.tasks.filter(task => !deleted.tasks[task.id] && !(task.sources || []).some(source => deleted.sources[DaymarkSync.sourceKey(source.provider, source.id)]));
  state.sessions = state.sessions.filter(session => !deleted.sessions[session.id]);
  const referenced = new Set(state.tasks.map(task => task.courseId));
  state.courses = state.courses.filter(course => !deleted.courses[course.id] || referenced.has(course.id));
}

export function mergeForConflict(remoteInput, localInput) {
  const remote = normalizeState(remoteInput);
  const local = normalizeState(localInput);
  const merged = {
    profile: structuredClone(local.profile),
    courses: mergeById(remote.courses, local.courses),
    tasks: mergeById(remote.tasks, local.tasks),
    sessions: mergeById(remote.sessions, local.sessions),
    sync: { ...remote.sync, ...local.sync },
    tombstones: {}
  };
  for (const key of ["tasks", "courses", "sessions", "sources"]) merged.tombstones[key] = newestMap(remote.tombstones[key], local.tombstones[key]);
  applyTombstones(merged);
  return merged;
}

export function importPayload(stateInput, payload, idFactory) {
  const state = normalizeState(stateInput);
  const counts = DaymarkSync.mergeImported(state, payload, idFactory);
  if (!validState(state)) throw new Error("Import produced an invalid state");
  return { state, counts };
}
