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

function resourceKind(url) {
  return /(?:docs|drive)\.google\.com|\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|rtf|zip)(?:[?#]|$)/i.test(url) ? "file" : "link";
}

function resources(items = []) {
  return items.map(item => ({ name: item.name, url: item.url, kind: item.kind || resourceKind(item.url) }));
}

export async function pushAssignmentCache(state, payload) {
  if (!cloudConfigured() || ASSIGNMENT_API_KEY.length < 32 || !state?.tasks || !state?.courses) return;
  const courses = new Map(state.courses.map(course => [course.id, course]));
  const assignments = state.tasks.map(task => {
    const course = courses.get(task.courseId);
    return {
      title: task.title,
      class: course?.name || "Personal",
      teacher: course?.teacher || "",
      room: course?.room || "",
      due: task.due || "",
      time: task.time || "",
      status: task.completed ? "completed" : "open",
      type: task.type || "Assignment",
      priority: task.priority || "normal",
      estimatedMinutes: task.estimate || 0,
      url: task.url || "",
      description: task.description || "",
      teacherInstructions: task.teacherInstructions || task.description || "",
      notes: task.notes || "",
      resources: resources(task.attachments)
    };
  });
  const body = { assignments };
  if (Array.isArray(payload?.materials)) body.materials = payload.materials.map(item => ({
    title: item.title,
    class: item.class,
    description: item.description || "",
    url: item.url || "",
    resources: resources(item.resources)
  }));
  const response = await fetch(`${CLOUD_URL}/api/assignments/sync`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-OGSync-API-Key": ASSIGNMENT_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Assignment cache returned HTTP ${response.status}`);
}
