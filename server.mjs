import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { extname, join } from "node:path";
import { cloudConfigured, pushImport } from "./cloud-bridge.mjs";
import { closeScraper, inspectScraper, openScraper, runScraper, scraperStatus } from "./scraper.mjs";

const ROOT = new URL(".", import.meta.url).pathname;
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const BASE = new URL(BASE_URL);
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(BASE.hostname);
const STATIC_FILES = new Set(["index.html", "styles.css", "app.js", "sync.js", "school.js", "icon.svg", "manifest.webmanifest", "sw.js"]);
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const AUTO_SYNC_MINUTES = Number(process.env.DAYMARK_AUTO_SYNC_MINUTES || 15);
const cloudActivity = { configured: cloudConfigured(), running: false, lastAttemptAt: "", lastSuccessAt: "", lastError: "" };

if (!IS_LOCAL && BASE.protocol !== "https:") throw new Error("BASE_URL must use HTTPS outside localhost");
if (!IS_LOCAL && !process.env.DAYMARK_PASSWORD) throw new Error("DAYMARK_PASSWORD is required outside localhost");

function securityHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

function authorized(req) {
  if (!process.env.DAYMARK_PASSWORD) return true;
  const encoded = String(req.headers.authorization || "").match(/^Basic\s+(.+)$/i)?.[1];
  if (!encoded) return false;
  let decoded = "";
  try { decoded = Buffer.from(encoded, "base64").toString("utf8"); } catch { return false; }
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  const expectedUsername = process.env.DAYMARK_USERNAME || "daymark";
  const supplied = createHash("sha256").update(`${decoded.slice(0, colon)}\0${decoded.slice(colon + 1)}`).digest();
  const expected = createHash("sha256").update(`${expectedUsername}\0${process.env.DAYMARK_PASSWORD}`).digest();
  return timingSafeEqual(supplied, expected);
}

function askForAuthorization(res) {
  res.writeHead(401, { ...securityHeaders("text/plain; charset=utf-8"), "WWW-Authenticate": 'Basic realm="Daymark", charset="UTF-8"' });
  res.end("Daymark sign-in required");
}

function sendJson(res, status, value) {
  res.writeHead(status, securityHeaders());
  res.end(JSON.stringify(value));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === BASE.origin;
}

async function serveStatic(res, pathname) {
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!STATIC_FILES.has(file)) return false;
  try {
    const body = await readFile(join(ROOT, file));
    const cache = file === "index.html" || file === "sw.js" ? "no-cache" : "public, max-age=3600";
    res.writeHead(200, { ...securityHeaders(MIME[extname(file)] || "application/octet-stream"), "Cache-Control": cache });
    res.end(body);
  } catch { sendJson(res, 404, { error: "Not found" }); }
  return true;
}

async function scrapeAndPush(provider, options) {
  const payload = await runScraper(provider, options);
  try {
    const cloud = await pushImport(payload);
    return { ...payload, cloud };
  } catch (error) {
    return { ...payload, cloud: { configured: true, error: error.message } };
  }
}

async function runBackgroundSync() {
  if (!cloudActivity.configured || cloudActivity.running) return;
  cloudActivity.running = true;
  cloudActivity.lastAttemptAt = new Date().toISOString();
  cloudActivity.lastError = "";
  try {
    for (const provider of ["google", "blackbaud"]) {
      await openScraper(provider, { foreground: false });
      const result = await scrapeAndPush(provider, { foreground: false });
      if (result.cloud?.error) throw new Error(`${provider}: ${result.cloud.error}`);
    }
    cloudActivity.lastSuccessAt = new Date().toISOString();
  } catch (error) {
    cloudActivity.lastError = error.message;
    console.error("Daymark background sync:", error.message);
  } finally {
    cloudActivity.running = false;
  }
}

async function handle(req, res) {
  const url = new URL(req.url, BASE_URL);
  if (!authorized(req)) return askForAuthorization(res);
  if (req.method === "GET" && await serveStatic(res, url.pathname)) return;
  if (req.method === "GET" && url.pathname === "/api/status") return sendJson(res, 200, { scraper: scraperStatus(), cloud: cloudActivity });
  const inspectProvider = url.pathname.match(/^\/api\/scrape\/inspect\/(google|blackbaud)$/)?.[1];
  if (req.method === "GET" && inspectProvider) {
    try { return sendJson(res, 200, await inspectScraper(inspectProvider)); }
    catch (error) { return sendJson(res, 409, { error: error.message }); }
  }
  if (req.method === "POST" && !sameOrigin(req)) return sendJson(res, 403, { error: "Origin not allowed" });
  const openProvider = url.pathname.match(/^\/api\/scrape\/open\/(google|blackbaud)$/)?.[1];
  if (req.method === "POST" && openProvider) {
    try { return sendJson(res, 200, await openScraper(openProvider)); }
    catch (error) { return sendJson(res, 500, { error: error.message }); }
  }
  const syncProvider = url.pathname.match(/^\/api\/sync\/(google|blackbaud)$/)?.[1];
  if (req.method === "POST" && syncProvider) {
    try { return sendJson(res, 200, await scrapeAndPush(syncProvider)); }
    catch (error) { return sendJson(res, 502, { error: error.message }); }
  }
  sendJson(res, 404, { error: "Not found" });
}

const server = createServer((req, res) => handle(req, res).catch(error => {
  console.error(error);
  if (!res.headersSent) sendJson(res, 500, { error: "Internal server error" });
  else res.end();
}));

server.listen(PORT, HOST, () => {
  console.log(`Daymark running at ${BASE_URL}`);
  if (cloudActivity.configured && Number.isFinite(AUTO_SYNC_MINUTES) && AUTO_SYNC_MINUTES >= 5) {
    setTimeout(runBackgroundSync, 5_000).unref();
    setInterval(runBackgroundSync, AUTO_SYNC_MINUTES * 60_000).unref();
    console.log(`Cloud bridge enabled; syncing every ${AUTO_SYNC_MINUTES} minutes.`);
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  await closeScraper();
  server.close(() => process.exit(0));
});
