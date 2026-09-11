import { cp, mkdir } from "node:fs/promises";

const files = ["index.html", "styles.css", "app.js", "sync.js", "school.js", "OG_Sync.svg", "manifest.webmanifest", "sw.js"];
await mkdir("dist", { recursive: true });
await Promise.all(files.map(file => cp(file, `dist/${file}`)));
