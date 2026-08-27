import { execFileSync } from "node:child_process";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const label = "app.daymark.sync";
const agents = join(homedir(), "Library", "LaunchAgents");
const plist = join(agents, `${label}.plist`);
const domain = `gui/${process.getuid()}`;
const service = `${domain}/${label}`;
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function launchctl(...args) {
  execFileSync("launchctl", args, { stdio: "ignore" });
}

if (process.argv.includes("--uninstall")) {
  try { launchctl("bootout", service); } catch {}
  try { await unlink(plist); } catch {}
  console.log("Daymark Mac helper removed.");
  process.exit(0);
}

await mkdir(agents, { recursive: true });
await mkdir(join(root, ".data"), { recursive: true, mode: 0o700 });
const document = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${escape(process.execPath)}</string>
    <string>--env-file-if-exists=.env</string>
    <string>--env-file-if-exists=.env.local</string>
    <string>${escape(join(root, "server.mjs"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${escape(root)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>${escape(join(root, ".data", "helper.log"))}</string>
  <key>StandardErrorPath</key><string>${escape(join(root, ".data", "helper-error.log"))}</string>
</dict></plist>
`;
await writeFile(plist, document, { mode: 0o600 });
await chmod(plist, 0o600);
try {
  launchctl("bootout", service);
  await new Promise(resolve => setTimeout(resolve, 500));
} catch {}
launchctl("bootstrap", domain, plist);
launchctl("enable", service);
console.log("Daymark Mac helper installed and running. It will start automatically when you sign in to this Mac.");
