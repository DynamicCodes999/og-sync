const CLOUD_URL = String(process.env.DAYMARK_CLOUD_URL || "").replace(/\/$/, "");
const SYNC_KEY = process.env.DAYMARK_SYNC_KEY || "";
const ASSIGNMENT_API_KEY = process.env.OGSYNC_API_KEY || SYNC_KEY;

export function cloudConfigured() {
  return /^https:\/\//.test(CLOUD_URL) && SYNC_KEY.length >= 32;
}

export async function pushImport(payload) {
  if (!cloudConfigured()) return { configured: false };
  const response = await fetch(`${CLOUD_URL}/api/state`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${SYNC_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ payload }),
    signal: AbortSignal.timeout(20_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Cloud push failed with HTTP ${response.status}`);
  return { configured: true, counts: result.counts, revision: result.revision, state: result.state };
}

export async function pushAssignmentCache(state) {
  if (!cloudConfigured() || ASSIGNMENT_API_KEY.length < 32 || !state?.tasks || !state?.courses) return;
  const courses = new Map(state.courses.map(course => [course.id, course.name]));
  const assignments = state.tasks.map(task => ({
    title: task.title,
    class: courses.get(task.courseId) || "Personal",
    due: task.due || "",
    status: task.completed ? "completed" : "open"
  }));
  const response = await fetch(`${CLOUD_URL}/api/assignments/sync`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-OGSync-API-Key": ASSIGNMENT_API_KEY },
    body: JSON.stringify({ assignments }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Assignment cache returned HTTP ${response.status}`);
}
