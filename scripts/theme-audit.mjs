#!/usr/bin/env node
/**
 * Centric theme regression audit.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4173 node scripts/theme-audit.mjs
 *   STORAGE_STATE=./playwright/.auth/user.json BASE_URL=... node scripts/theme-audit.mjs
 *
 * Install the runner once with: npm install --save-dev playwright
 * Then install Chromium with: npx playwright install chromium
 */
import { chromium } from "playwright";
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const baseUrl = process.env.BASE_URL;
if (!baseUrl) {
  console.error("Set BASE_URL to the running Centric app URL.");
  process.exit(2);
}
const storageState = process.env.STORAGE_STATE;
if (storageState && !existsSync(storageState)) {
  console.error("STORAGE_STATE does not exist: " + storageState);
  process.exit(2);
}
function htmlFiles(dir = ".") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    if (!entry.isFile() || !entry.name.endsWith(".html")) return [];
    if (path === "_checklist-parse-check.html") return [];
    return [relative(".", path).replaceAll("\\", "/")];
  });
}
const pages = htmlFiles().sort();
const viewports = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "desktop-1440", width: 1440, height: 900 },
];
const failures = [];
const warnings = [];
let checked = 0;
const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ["light", "dark"]) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        ...(storageState ? { storageState } : {}),
      });
      await context.addInitScript((selectedTheme) => {
        try {
          if (!localStorage.getItem("apr-theme")) localStorage.setItem("apr-theme", selectedTheme);
          document.documentElement.setAttribute("data-theme", localStorage.getItem("apr-theme") || selectedTheme);
          window.__centricThemeAtStart = document.documentElement.getAttribute("data-theme");
        } catch {
          document.documentElement.setAttribute("data-theme", selectedTheme);
          window.__centricThemeAtStart = selectedTheme;
        }
      }, theme);
      let toggleTested = false;
      const page = await context.newPage();
      page.on("pageerror", (error) => failures.push(theme + "/" + viewport.name + " page error: " + error.message));
      page.on("console", (message) => {
        if (message.type() === "error") failures.push(theme + "/" + viewport.name + " console error: " + message.text());
      });
      for (const file of pages) {
        const url = new URL(file, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/").href;
        try {
          if (page.url() !== "about:blank") {
            await page.evaluate((selectedTheme) => localStorage.setItem("apr-theme", selectedTheme), theme);
          }
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(150);
          const result = await page.evaluate(() => ({
            theme: document.documentElement.getAttribute("data-theme") || "unset",
            initialTheme: window.__centricThemeAtStart || "unset",
            stored: localStorage.getItem("apr-theme"),
            path: location.pathname,
            width: document.documentElement.scrollWidth,
            viewport: document.documentElement.clientWidth,
            title: document.title,
            tokenStylesheet: [...document.styleSheets].some((sheet) => (sheet.href || "").includes("theme-tokens.css")),
          }));
          checked++;
          if (result.theme !== theme) {
            failures.push(file + " expected " + theme + " theme but found " + result.theme);
          }
          if (result.initialTheme !== theme) {
            failures.push(file + " did not receive " + theme + " before page styles painted");
          }
          if (result.width > result.viewport + 1) {
            warnings.push(file + " horizontal overflow at " + viewport.name + " (" + result.width + " > " + result.viewport + ")");
          }
          if (!result.tokenStylesheet) {
            failures.push(file + " did not load css/theme-tokens.css");
          }
          if (result.path.endsWith("/login.html") && !file.endsWith("login.html")) {
            warnings.push(file + " redirected to login. Supply STORAGE_STATE to audit authenticated pages.");
          }
          // Verify the real theme toggle and its saved preference once per viewport/theme.
          if (!toggleTested) {
            const toggle = page.locator(".theme-toggle").first();
            if (await toggle.isVisible().catch(() => false) && await toggle.isEnabled().catch(() => false)) {
              const expectedAfterToggle = theme === "dark" ? "light" : "dark";
              await toggle.click();
              const toggled = await page.evaluate(() => ({
                theme: document.documentElement.getAttribute("data-theme"),
                stored: localStorage.getItem("apr-theme"),
              }));
              if (toggled.theme !== expectedAfterToggle || toggled.stored !== expectedAfterToggle) {
                failures.push(file + " theme toggle did not update the page and saved preference");
              }
              await page.reload({ waitUntil: "domcontentloaded" });
              const persistedToggle = await page.evaluate(() => ({
                theme: document.documentElement.getAttribute("data-theme"),
                stored: localStorage.getItem("apr-theme"),
              }));
              if (persistedToggle.theme !== expectedAfterToggle || persistedToggle.stored !== expectedAfterToggle) {
                failures.push(file + " theme toggle preference did not survive reload");
              }
              toggleTested = true;
              await page.evaluate((selectedTheme) => localStorage.setItem("apr-theme", selectedTheme), theme);
            }
          }
          // Exercise common menu and popup launchers without submitting forms.
          const launchers = page.locator('button[aria-haspopup], [data-bs-toggle="dropdown"], [data-bs-toggle="modal"], [data-menu-toggle], [data-modal-target], [data-open-modal], .modal-trigger, .hdr-menu-btn, .menu-toggle, .filter-more-btn, .dropdown-toggle');
          const count = Math.min(await launchers.count(), 3);
          for (let i = 0; i < count; i++) {
            const item = launchers.nth(i);
            if (await item.isVisible().catch(() => false) && await item.isEnabled().catch(() => false)) {
              await item.click({ timeout: 1500 }).catch(() => {});
              await page.keyboard.press("Escape").catch(() => {});
            }
          }
        } catch (error) {
          failures.push(file + " navigation/audit failed: " + error.message);
        }
      }
      if (!toggleTested) warnings.push("No visible .theme-toggle found for " + theme + "/" + viewport.name + "; provide authenticated STORAGE_STATE to test the dashboard toggle.");
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log("Theme pages checked: " + checked);
console.log("Warnings: " + warnings.length);
for (const warning of warnings) console.log("WARN " + warning);
console.log("Failures: " + failures.length);
for (const failure of failures) console.error("FAIL " + failure);
if (failures.length) process.exitCode = 1;
