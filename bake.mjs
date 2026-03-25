import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = (p) => resolve(__dirname, p);

// Read built assets
const css = readFileSync(r("dist/assets/index-uHvLm8fr.css"), "utf-8");
const js = readFileSync(r("dist/assets/index-BK5l8Uk6.js"), "utf-8");

// Read all data files
const dataFiles = {
  uciCsv: readFileSync(r("public/data/uci_courses.csv"), "utf-8"),
  ucbCsv: readFileSync(r("public/data/ucb_courses.csv"), "utf-8"),
  ucb6Raw: readFileSync(r("public/data/ucb_6.txt"), "utf-8"),
  uclaCsv: readFileSync(r("public/data/ucla_courses.csv"), "utf-8"),
  uclaApi: readFileSync(r("public/data/ucla_courses_api_all_blocks.csv"), "utf-8"),
  uciRaw: readFileSync(r("public/data/uci.txt"), "utf-8"),
  ucbRaw: readFileSync(r("public/data/ei.txt"), "utf-8"),
};

// Escape for embedding in a script tag (handle </script> and backticks)
function escapeForScript(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/<\/script>/gi, "<\\/script>");
}

// Build inline data block
const dataEntries = Object.entries(dataFiles)
  .map(([key, val]) => `  ${key}: \`${escapeForScript(val)}\``)
  .join(",\n");

const dataScript = `window.__INLINE_DATA__ = {\n${dataEntries}\n};`;

// Assemble single HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Course Grid Dashboard</title>
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <script>${dataScript}</script>
  <script type="module">${js}</script>
</body>
</html>`;

const outPath = r("course_dashboard_standalone.html");
writeFileSync(outPath, html, "utf-8");

const sizeKB = (Buffer.byteLength(html, "utf-8") / 1024).toFixed(1);
console.log(`✅ Baked to: ${outPath} (${sizeKB} KB)`);
