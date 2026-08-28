(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DaymarkSchool = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function parseDate(key) {
    const [year, month, day] = String(key || "").split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function rotationForDate(settings, key) {
    const labels = settings?.rotationLabels || [];
    if (labels.length < 2 || !settings.anchorDate || !key) return "";
    const anchor = parseDate(settings.anchorDate);
    const target = parseDate(key);
    if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(target.getTime())) return "";
    let offset = 0;
    const direction = target >= anchor ? 1 : -1;
    const cursor = new Date(anchor);
    while ((direction > 0 && cursor < target) || (direction < 0 && cursor > target)) {
      cursor.setDate(cursor.getDate() + direction);
      if (cursor.getDay() !== 0 && cursor.getDay() !== 6) offset += direction;
    }
    return labels[((offset % labels.length) + labels.length) % labels.length];
  }

  function gradeSummary(items) {
    const earned = items.reduce((sum, item) => sum + Number(item.score), 0);
    const possible = items.reduce((sum, item) => sum + Number(item.pointsPossible), 0);
    return { earned, possible, percent: possible ? earned / possible * 100 : null };
  }

  function scoreNeeded(items, targetPercent, futurePoints) {
    const { earned, possible } = gradeSummary(items);
    const target = Number(targetPercent);
    const future = Number(futurePoints);
    if (!(target >= 0 && target <= 100) || !(future > 0)) return null;
    const points = target / 100 * (possible + future) - earned;
    return { points, percent: points / future * 100, possible: points <= future };
  }

  function isAssessment(task) {
    return /\b(test|quiz|exam|midterm|final|assessment)\b/i.test(`${task?.type || ""} ${task?.title || ""}`);
  }

  function normalizeFocusPlan(plan = {}) {
    const number = (value, fallback, min, max) => {
      const parsed = Math.round(Number(value));
      return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    };
    return {
      work: number(plan.work, 25, 1, 180),
      break: number(plan.break, 5, 1, 60),
      blocks: number(plan.blocks, 1, 1, 8)
    };
  }

  function nextFocusPhase(phase, block, blocks) {
    if (phase === "work") return { phase: "break", block, complete: false };
    if (block < blocks) return { phase: "work", block: block + 1, complete: false };
    return { phase: "work", block: 1, complete: true };
  }

  function isSyncedMissingWork(task, today) {
    return Boolean(!task?.completed && task.due && task.due < today && task.sources?.some(source => source.provider === "google" || source.provider === "blackbaud"));
  }

  return { rotationForDate, gradeSummary, scoreNeeded, isAssessment, normalizeFocusPlan, nextFocusPhase, isSyncedMissingWork };
});
