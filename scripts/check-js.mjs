import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const files = readdirSync("js").filter((file) => file.endsWith(".js")).sort();
const tempDir = mkdtempSync(join(tmpdir(), "centric-js-check-"));
let failed = 0;

try {
  for (const file of files) {
    const modulePath = join(tempDir, file.replace(/\.js$/, ".mjs"));
    copyFileSync(join("js", file), modulePath);
    const result = spawnSync(process.execPath, ["--check", modulePath], { encoding: "utf8" });
    if (result.status !== 0) {
      failed += 1;
      process.stderr.write("\n" + file + "\n" + (result.stderr || result.stdout || "Syntax check failed") + "\n");
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Syntax OK: " + files.length + " JavaScript modules checked as ES modules.");
}
