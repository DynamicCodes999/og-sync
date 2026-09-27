import { timingSafeEqual } from "node:crypto";
import { get, put } from "@vercel/blob";

const CACHE_PATH = "og-sync/assignments.json";
const MAX_BODY = 1_000_000;
const MAX_ASSIGNMENTS = 5_000;

function send(res, status, value) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(value));
}

function suppliedKey(req) {
  const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  const header = req.headers["x-ogsync-api-key"];
  const query = new URL(req.url, "https://og-sync.invalid").searchParams;
  return String(header || bearer || query.get("key") || query.get("apiKey") || "");
}

function authorized(req) {
  const expected = process.env.OGSYNC_API_KEY || "";
  const supplied = suppliedKey(req);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  // Equal-length, constant-time comparison avoids leaking useful key details.
  return expected.length >= 32 && left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

export function normalizeAssignments(input) {
  if (!Array.isArray(input) || input.length > MAX_ASSIGNMENTS) throw Object.assign(new Error("Invalid assignments"), { status: 400 });
  return input.map(item => {
    const title = String(item?.title || "").trim();
    const className = String(item?.class || "").trim();
    const due = String(item?.due || "").trim();
    const status = String(item?.status || "").trim();
    if (!title || title.length > 200 || !className || className.length > 100 || due.length > 40 || !["open", "completed"].includes(status)) throw Object.assign(new Error("Invalid assignment"), { status: 400 });
    return { title, class: className, due, status };
  });
}

async function readCache() {
  // A fixed private Blob path gives this single-user cache durable overwrite semantics.
  const result = await get(CACHE_PATH, { access: "private", useCache: false });
  if (!result) return { lastSynced: null, assignments: [] };
  if (result.statusCode !== 200 || !result.stream) throw new Error("Could not read assignment cache");
  return JSON.parse(await new Response(result.stream).text());
}

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Invalid OG Sync API key" });
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return send(res, 503, { error: "Cloud storage is not configured" });

  try {
    if (req.method === "GET") return send(res, 200, await readCache());
    if (req.method === "POST") {
      const body = await readBody(req);
      const cache = { lastSynced: new Date().toISOString(), assignments: normalizeAssignments(body?.assignments ?? body) };
      await put(CACHE_PATH, JSON.stringify(cache), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
      return send(res, 200, cache);
    }
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("OG Sync assignment cache:", error);
    return send(res, error.status || 500, { error: error.status ? error.message : "Assignment cache request failed" });
  }
}
