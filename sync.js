(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DaymarkSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COLORS = ["#ddd5f4", "#f2d6a2", "#d9e8c7", "#cae8d7", "#f3d6dc", "#cfe1f4"];

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\bii\b/g, "2")
      .replace(/\bi\b/g, "1")
      .replace(/\bcivilization\b/g, "civ")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function decodeEntities(value) {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return String(value || "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity[0] !== "#") return named[entity.toLowerCase()] || match;
      const code = Number.parseInt(entity[1].toLowerCase() === "x" ? entity.slice(2) : entity.slice(1), entity[1].toLowerCase() === "x" ? 16 : 10);
      return Number.isInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
  }

  function classKey(value) {
    return normalizeText(value)
      .replace(/\b(period|section|block)\s*[a-z0-9-]+\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalKey(title, courseId, due) {
    return `${normalizeText(title)}|${courseId}|${due || "no-date"}`;
  }

  function sourceMatch(item, provider, id) {
    return (item.sources || []).some(source => source.provider === provider && source.id === id);
  }

  function sourceKey(provider, id) {
    return `${provider}:${id}`;
  }

  function sourceWasDeleted(state, provider, id) {
    return Boolean(state.tombstones?.sources?.[sourceKey(provider, id)]);
  }

  function addSource(item, source) {
    item.sources ||= [];
    if (!sourceMatch(item, source.provider, source.id)) item.sources.push(source);
  }

  function ensureCourse(state, remote, provider, idFactory) {
    const sourceId = String(remote.sourceId || remote.id || remote.name);
    let course = state.courses.find(item => sourceMatch(item, provider, sourceId));
    if (!course) {
      const key = classKey(remote.name);
      course = state.courses.find(item => classKey(item.name) === key);
    }
    if (!course) {
      course = {
        id: `course-${idFactory()}`,
        name: String(remote.name || "Imported class").trim().slice(0, 80),
        teacher: "",
        room: "",
        color: COLORS[state.courses.length % COLORS.length],
        schedule: [],
        sources: []
      };
      state.courses.push(course);
    }
    addSource(course, { provider, id: sourceId });
    return course;
  }

  function cleanAssignment(remote, course, provider, syncedAt) {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(remote.due || "") ? remote.due : "";
    const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(remote.time || "") ? remote.time : "23:59";
    const teacherInstructions = String(remote.description || "").slice(0, 10000);
    const attachments = Array.isArray(remote.attachments) ? remote.attachments.slice(0, 20).filter(item => item && /^[\w-]{1,64}$/.test(item.id || "") && String(item.name || "").length <= 120 && /^https:\/\//.test(item.url || "")).map(item => ({ id: item.id, name: String(item.name), url: item.url })) : [];
    return {
      title: decodeEntities(remote.title || "Untitled assignment").trim().slice(0, 100),
      courseId: course.id,
      due,
      time,
      type: String(remote.type || "Assignment").trim().slice(0, 30),
      estimate: 25,
      priority: /test|exam|project/i.test(remote.type || "") ? "high" : "normal",
      completed: Boolean(remote.completed),
      url: /^https:\/\//.test(remote.url || "") ? remote.url : "",
      ...(teacherInstructions ? { teacherInstructions } : {}),
      ...(attachments.length ? { attachments } : {}),
      syncedAt
    };
  }

  function cleanGrade(remote, course, syncedAt) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(remote.date || "") ? remote.date : "";
    return {
      courseId: course.id,
      title: decodeEntities(remote.title || "Untitled grade").trim().slice(0, 100),
      score: Number(remote.score),
      pointsPossible: Number(remote.pointsPossible),
      date,
      type: String(remote.type || "Assignment").trim().slice(0, 30),
      syncedAt
    };
  }

  function mergeImported(state, payload, idFactory = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12)) {
    if (!payload || !/^[a-z0-9-]{1,30}$/.test(payload.provider || "") || !Array.isArray(payload.courses) || !Array.isArray(payload.assignments)) throw new Error("Invalid sync payload");
    const provider = payload.provider;
    const syncedAt = payload.syncedAt || new Date().toISOString();
    const grades = Array.isArray(payload.grades) ? payload.grades : [];
    const courseGrades = Array.isArray(payload.courseGrades) ? payload.courseGrades : [];
    state.gradeItems ||= [];
    state.courseGrades ||= {};
    const courseBySource = new Map();
    const counts = { imported: 0, updated: 0, merged: 0, coursesAdded: 0, gradesImported: 0, gradesUpdated: 0 };

    for (const remote of payload.courses) {
      if (!remote || !String(remote.name || "").trim()) continue;
      const before = state.courses.length;
      const course = ensureCourse(state, remote, provider, idFactory);
      courseBySource.set(String(remote.sourceId || remote.id || remote.name), course);
      if (state.courses.length > before) counts.coursesAdded++;
    }

    for (const remote of payload.assignments) {
      const sourceId = String(remote?.sourceId || "");
      if (!sourceId || !String(remote.title || "").trim()) continue;
      if (sourceWasDeleted(state, provider, sourceId)) continue;
      let course = courseBySource.get(String(remote.courseSourceId || ""));
      if (!course) course = ensureCourse(state, { sourceId: remote.courseSourceId || remote.courseName, name: remote.courseName || "Imported class" }, provider, idFactory);
      const next = cleanAssignment(remote, course, provider, syncedAt);
      let task = state.tasks.find(item => sourceMatch(item, provider, sourceId));
      let matchedByContent = false;
      if (!task) {
        const key = canonicalKey(next.title, next.courseId, next.due);
        task = state.tasks.find(item => canonicalKey(item.title, item.courseId, item.due) === key);
        matchedByContent = Boolean(task);
      }
      if (task) {
        const attachments = next.attachments || [];
        delete next.attachments;
        const wasCompleted = task.completed;
        Object.assign(task, next, { completed: wasCompleted || next.completed });
        task.attachments ||= [];
        for (const attachment of attachments) {
          const existing = task.attachments.find(item => item.url === attachment.url);
          if (existing) Object.assign(existing, attachment);
          else if (task.attachments.length < 20) task.attachments.push(attachment);
        }
        addSource(task, { provider, id: sourceId });
        counts[matchedByContent ? "merged" : "updated"]++;
      } else {
        state.tasks.push({ id: idFactory(), ...next, sources: [{ provider, id: sourceId }] });
        counts.imported++;
      }
    }

    for (const remote of grades) {
      const sourceId = String(remote?.sourceId || "");
      const score = Number(remote?.score);
      const possible = Number(remote?.pointsPossible);
      if (!sourceId || !String(remote.title || "").trim() || !Number.isFinite(score) || score < 0 || !(possible > 0)) continue;
      let course = courseBySource.get(String(remote.courseSourceId || ""));
      if (!course) course = ensureCourse(state, { sourceId: remote.courseSourceId || remote.courseName, name: remote.courseName || remote.course || "Imported class" }, provider, idFactory);
      const next = cleanGrade(remote, course, syncedAt);
      let item = state.gradeItems.find(grade => sourceMatch(grade, provider, sourceId));
      if (!item) item = state.gradeItems.find(grade => grade.courseId === course.id && normalizeText(grade.title) === normalizeText(next.title) && (grade.date || "") === next.date);
      if (item) {
        Object.assign(item, next);
        addSource(item, { provider, id: sourceId });
        counts.gradesUpdated++;
      } else {
        state.gradeItems.push({ id: `grade-${idFactory()}`, ...next, sources: [{ provider, id: sourceId }] });
        counts.gradesImported++;
      }
    }

    const refreshedCourses = new Set(courseGrades.map(remote => courseBySource.get(String(remote.courseSourceId || ""))?.id).filter(Boolean));
    const currentGradeSources = new Set(grades.map(remote => sourceKey(provider, String(remote.sourceId || ""))));
    state.gradeItems = state.gradeItems.filter(item => {
      if (!refreshedCourses.has(item.courseId)) return true;
      const providerSources = (item.sources || []).filter(source => source.provider === provider);
      return !providerSources.length || providerSources.some(source => currentGradeSources.has(sourceKey(source.provider, source.id)));
    });

    for (const remote of courseGrades) {
      const percent = Number(remote?.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 200) continue;
      let course = courseBySource.get(String(remote.courseSourceId || ""));
      if (!course) course = ensureCourse(state, { sourceId: remote.courseSourceId || remote.course, name: remote.course || "Imported class" }, provider, idFactory);
      state.courseGrades[course.id] = {
        percent: Math.round(percent * 100) / 100,
        period: String(remote.period || "Current marking period").slice(0, 80),
        calculationMethod: Number(remote.calculationMethod) || 0,
        provider,
        syncedAt
      };
    }

    state.sync ||= {};
    state.sync[provider] = { lastSyncedAt: syncedAt, ...counts };
    return counts;
  }

  function migrateState(state) {
    const rejectedSource = sourceKey("blackbaud", "4b261956b94e2c1ea180");
    const before = state.tasks.length;
    state.tasks = state.tasks.filter(task => !(task.sources || []).some(source => sourceKey(source.provider, source.id) === rejectedSource));
    if (before !== state.tasks.length) {
      state.tombstones ||= {};
      state.tombstones.sources ||= {};
      state.tombstones.sources[rejectedSource] = new Date().toISOString();
    }
    let changed = before - state.tasks.length;
    for (const task of state.tasks) {
      if (typeof task.title !== "string") continue;
      const title = decodeEntities(task.title);
      if (title !== task.title) { task.title = title; changed++; }
    }
    return changed;
  }

  return { normalizeText, classKey, canonicalKey, mergeImported, migrateState, sourceKey };
});
