import { expect, test } from "@playwright/test";
import { ADMIN, BACK, computed, expectNoSeriousA11yViolations, FRONT } from "./helpers";

test.describe("W0 shell pages", () => {
  test("V2-AC-01 Back: @cms/ui classes are generated and the page title uses the token size", async ({ page }) => {
    await page.goto(`${BACK}/entries/album?mockUser=seed-operator-album`);
    await expect(page.getByRole("heading", { level: 1, name: "album" })).toBeVisible();
    expect(await computed(page, "h1", "font-size")).toBe("20px");
    expect(await computed(page, "h1", "font-weight")).toBe("650");
    expect(await computed(page, "header", "background-color")).toBe("rgb(255, 255, 255)");
    expect(await computed(page, "body", "background-color")).toBe("rgb(241, 241, 241)");
    await expect(page).toHaveTitle("album · CMS 作業台");
  });

  test("V2-AC-01 Admin: cards have border and radius, the accent bar is drawn", async ({ page }) => {
    await page.goto(`${ADMIN}/types?mockUser=seed-admin`);
    await expect(page.getByTestId("type-album")).toBeVisible();
    expect(await computed(page, "[data-slot=card]", "border-top-width")).toBe("1px");
    expect(await computed(page, "[data-slot=card]", "border-top-left-radius")).toBe("12px");
    expect(await computed(page, "[data-testid=admin-accent]", "background-color")).toBe("rgb(138, 63, 252)");
    expect(await computed(page, "[data-testid=admin-accent]", "height")).toBe("4px");
  });

  test("V2-AC-01 Front: the album site uses its dark scheme and the Front title size", async ({ page }) => {
    await page.goto(`${FRONT}/album`);
    await expect(page.getByText("Coast Light 2026")).toBeVisible();
    expect(await computed(page, "[data-site=album]", "background-color")).toBe("rgb(17, 17, 17)");
    expect(await computed(page, "h1", "font-size")).toBe("32px");
    await expect(page).toHaveTitle("相簿 · 相簿");
  });

  for (const [name, url] of [
    ["Front selector", `${FRONT}/`],
    ["Front album", `${FRONT}/album`],
    ["Front login", `${FRONT}/login`],
    ["Back sign-in", `${BACK}/sign-in`],
    ["Back home", `${BACK}/?mockUser=seed-operator-album`],
    ["Back entries", `${BACK}/entries/album?mockUser=seed-operator-album`],
    ["Admin login", `${ADMIN}/login`],
    ["Admin home", `${ADMIN}/?mockUser=seed-admin`],
    ["Admin types", `${ADMIN}/types?mockUser=seed-admin`],
  ] as const) {
    test(`V2-AC-14 axe: ${name}`, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("query-loading")).toHaveCount(0);
      await expectNoSeriousA11yViolations(page);
    });
  }

  test("S-01 AC-13 Front login ignores an external next", async ({ page }) => {
    await page.goto(`${FRONT}/login?next=${encodeURIComponent("https://evil.example/steal")}`);
    await page.getByLabel("帳號").fill("seed-member-clinic");
    await page.getByLabel("密碼").fill("any-password");
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(`${FRONT}/`);
  });

  test("S-02 Back and Admin login forms start empty", async ({ page }) => {
    await page.goto(`${BACK}/sign-in`);
    await expect(page.getByLabel("帳號")).toHaveValue("");
    await page.goto(`${ADMIN}/login`);
    await expect(page.getByLabel("帳號")).toHaveValue("");
  });

  test("C-17 Back: anonymous deep link → sign in → back to the same page", async ({ page }) => {
    await page.goto(`${BACK}/entries/photo`);
    await expect(page).toHaveURL(`${BACK}/sign-in?returnTo=%2Fentries%2Fphoto`);
    await page.getByLabel("帳號").fill("seed-operator-album");
    await page.getByLabel("密碼").fill("any-password");
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(`${BACK}/entries/photo`);
    await expect(page.getByRole("heading", { level: 1, name: "photo" })).toBeVisible();
  });

  test("E-01 AppFrame moves the side navigation into a sheet below 1024px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BACK}/?mockUser=seed-operator-album`);
    await expect(page.getByTestId("nav-open")).toBeVisible();
    await expect(page.locator("aside")).toBeHidden();
    await page.getByTestId("nav-open").click();
    await page.getByRole("dialog").getByRole("link", { name: "album" }).click();
    await expect(page).toHaveURL(`${BACK}/entries/album`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });

  test("C-02 W0-FM23 ?mock=slow shows a skeleton first, then data, never the empty copy", async ({ page }) => {
    await page.goto(`${FRONT}/projects?mock=slow`);
    await expect(page.getByTestId("query-loading")).toBeVisible();
    await expect(page.getByText("還沒有公開專案")).toHaveCount(0);
    await expect(page.getByText("CMS Scaffold").first()).toBeVisible({ timeout: 5_000 });
  });
});
