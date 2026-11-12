import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

function collectJavaScript(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScript(fullPath);
    return entry.isFile() && entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

const files = collectJavaScript("js").sort();
const tempDir = mkdtempSync(join(tmpdir(), "centric-js-check-"));
let failed = 0;

try {
  for (const file of files) {
    const relativePath = relative("js", file).replace(/\\.js$/, ".mjs");
    const modulePath = join(tempDir, relativePath);
    mkdirSync(dirname(modulePath), { recursive: true });
    copyFileSync(file, modulePath);
    const result = spawnSync(process.execPath, ["--check", modulePath], { encoding: "utf8" });
    if (result.status !== 0) {
      failed += 1;
      process.stderr.write("\\n" + file + "\\n" + (result.stderr || result.stdout || "Syntax check failed") + "\\n");
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  process.stderr.write("Syntax errors in " + failed + " JavaScript module(s).\\n");
  process.exitCode = 1;
} else {
  console.log("Syntax OK: " + files.length + " JavaScript modules checked as ES modules.");
}
