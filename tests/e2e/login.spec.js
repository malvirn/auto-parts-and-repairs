import { test, expect } from "@playwright/test";

test.describe("Centric Auto Mobile public entry", () => {
  test("login page loads with the expected sign-in controls", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));

    await page.goto("/login.html");
    await expect(page).toHaveTitle(/Centric Auto Mobile.*Sign In/i);
    await expect(page.getByRole("heading", { name: /Welcome Back to Centric/i })).toBeVisible();
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.locator("#login-password")).toBeVisible();
    await expect(page.locator("#login-submit")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("password visibility toggle works", async ({ page }) => {
    await page.goto("/login.html");
    const password = page.locator("#login-password");
    const toggle = page.locator("#toggle-password");

    await expect(password).toHaveAttribute("type", "password");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("unauthenticated dashboard entry sends the visitor to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login(?:\.html)?(?:[?#].*)?$/);
    await expect(page.getByRole("heading", { name: /Welcome Back to Centric/i })).toBeVisible();
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.locator("#login-password")).toBeVisible();
  });
});
