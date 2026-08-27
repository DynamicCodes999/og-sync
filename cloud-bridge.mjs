const CLOUD_URL = String(process.env.DAYMARK_CLOUD_URL || "").replace(/\/$/, "");
const SYNC_KEY = process.env.DAYMARK_SYNC_KEY || "";

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
  return { configured: true, counts: result.counts, revision: result.revision };
}
