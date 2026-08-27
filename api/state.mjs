import { timingSafeEqual } from "node:crypto";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { defaultState, importPayload, normalizeState, validState } from "../cloud-core.mjs";

const STATE_PATH = "daymark/state.json";
const MAX_BODY = 1_000_000;

function headers() {
  return {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function send(res, status, value) {
  res.writeHead(status, headers());
  res.end(JSON.stringify(value));
}

function authorized(req) {
  const expected = process.env.DAYMARK_SYNC_KEY || "";
  const supplied = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
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

async function readStored() {
  const result = await get(STATE_PATH, { access: "private", useCache: false });
  if (!result) return { state: defaultState(), revision: null };
  if (result.statusCode !== 200 || !result.stream) throw new Error("Could not read cloud state");
  const parsed = JSON.parse(await new Response(result.stream).text());
  if (!validState(parsed)) throw new Error("Cloud state failed validation");
  return { state: normalizeState(parsed), revision: result.blob.etag.replace(/^W\//, "") };
}

async function writeStored(state, revision) {
  const options = {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
    ...(revision ? { ifMatch: revision } : { allowOverwrite: false })
  };
  const result = await put(STATE_PATH, JSON.stringify(state), options);
  return result.etag;
}

async function conflict(res) {
  const latest = await readStored();
  return send(res, 409, { error: "Cloud state changed on another device", ...latest });
}

export default async function handler(req, res) {
  if (!authorized(req)) return send(res, 401, { error: "Invalid Daymark sync key" });
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return send(res, 503, { error: "Cloud storage is not configured" });

  try {
    if (req.method === "GET") return send(res, 200, await readStored());

    if (req.method === "PUT") {
      const body = await readBody(req);
      if (!validState(body?.state)) return send(res, 400, { error: "Invalid Daymark state" });
      const current = await readStored();
      if ((body.revision || null) !== current.revision) return send(res, 409, { error: "Cloud state changed on another device", ...current });
      const next = normalizeState(body.state);
      try {
        const revision = await writeStored(next, current.revision);
        return send(res, 200, { state: next, revision });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || !current.revision) return conflict(res);
        throw error;
      }
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const payload = body?.payload || body;
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = await readStored();
        const { state, counts } = importPayload(current.state, payload);
        try {
          const revision = await writeStored(state, current.revision);
          return send(res, 200, { state, revision, counts });
        } catch (error) {
          if (!(error instanceof BlobPreconditionFailedError) && current.revision) throw error;
        }
      }
      return send(res, 409, { error: "Cloud state is busy; retry shortly" });
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return send(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("Daymark state API:", error);
    return send(res, error.status || 500, { error: error.status ? error.message : "Cloud state request failed" });
  }
}
