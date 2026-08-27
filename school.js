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

  return { rotationForDate, gradeSummary, scoreNeeded };
});
