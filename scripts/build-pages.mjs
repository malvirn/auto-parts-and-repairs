import { cp, mkdir, readdir, rm, copyFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "dist");
const allowedExtensions = new Set([
  ".html", ".js", ".mjs", ".css", ".json", ".webmanifest",
  ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff",
  ".woff2", ".ttf", ".otf", ".pdf"
]);

async function copyPublicTree(relativePath) {
  const source = path.join(root, relativePath);
  const destination = path.join(out, relativePath);
  let info;
  try { info = await stat(source); } catch { return; }
  if (!info.isDirectory()) return;
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyPublicTree(path.join(relativePath, entry.name));
    } else if (allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
    }
  }
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of [
  "index.html", "login.html", "portal.html", "portal.css",
  "manifest.webmanifest", "sw.js", "_headers"
]) {
  await copyFile(path.join(root, file), path.join(out, file));
}

for (const directory of [
  "assets", "css", "js", "pages", "icons", "img", "document-templates"
]) {
  await copyPublicTree(directory);
}

for (const required of ["index.html", "login.html"]) {
  await stat(path.join(out, required));
}

console.log("Cloudflare Pages output prepared in dist/ (frontend allowlist only).");
