import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { note, saveFile } from "../harness/evidence.ts";
import { E2E_DIR } from "../harness/paths.ts";

if (process.env.KITH_VISUAL_GATE === "1") {
// Separate local gate: default suite cannot adopt/update visual baselines implicitly.
test.beforeEach(async ({ context, browser }) => {
  const pkg = JSON.parse(readFileSync(join(E2E_DIR, "node_modules/@playwright/test/package.json"), "utf8")) as { version: string };
  expect(pkg.version).toBe("1.56.1");
  expect(browser.version()).toBe("141.0.7390.37");
  await context.route("**/*", async (route) => {
    const request = new URL(route.request().url());
    if (request.origin === new URL(process.env.KITH_E2E_BASE_URL!).origin) await route.continue();
    else await route.abort("blockedbyclient");
  });
  await context.addInitScript(() => localStorage.setItem("kith.theme", "light"));
});

async function compare(page: Page, subject: Locator, name: string, info: TestInfo): Promise<void> {
  await expect(subject).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  expect(await page.evaluate(() => document.fonts.check('16px "Figtree Variable"'))).toBe(true);
  if (process.env.KITH_VISUAL_PROBE === "1" && name === "login") {
    await subject.evaluate((element) => { (element as HTMLElement).style.border = "12px solid rgb(255, 0, 255)"; });
    note(info, "controlled visible 12px magenta login border injected; expected pixel mismatch");
  }
  // Also retain the current scene on GREEN: compare PNGs are attached natively on RED.
  saveFile(info, "current.png", await subject.screenshot({ animations: "disabled", caret: "hide" }));
  await expect(subject).toHaveScreenshot(name + ".png", { animations: "disabled", caret: "hide", threshold: 0, maxDiffPixels: 0 });
  note(info, "zero-tolerance pixel comparison: " + name);
}

test("E2E-VIS-01 login form", { tag: ["@visual"] }, async ({ page }, info) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-handle")).toHaveValue("");
  await expect(page.getByTestId("login-password")).toHaveValue("");
  await expect(page.getByTestId("login-submit")).toBeDisabled();
  await compare(page, page.getByTestId("login-page"), "login", info);
});

test("E2E-VIS-02 operator home empty panel", { tag: ["@visual"] }, async ({ page }, info) => {
  await loginViaUi(page, ACCOUNTS.ada);
  await page.goto("/");
  await expect(page.getByTestId("home-greeting")).toContainText("Ada");
  await expect(page.getByTestId("home-guide-room")).toBeVisible();
  await expect(page.getByTestId("home-guide-people")).toBeVisible();
  await compare(page, page.getByTestId("home-empty"), "home-empty", info);
});

test("E2E-VIS-03 console people list", { tag: ["@visual"] }, async ({ page }, info) => {
  await loginViaUi(page, ACCOUNTS.ada);
  await page.goto("/console/people");
  await expect(page.getByTestId("people-row")).toHaveCount(4);
  expect(await page.getByTestId("people-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-handle")))).toEqual(["ada", "ben", "chen", "dora"]);
  await expect(page.getByTestId("people-badge-disabled")).toHaveCount(1);
  await compare(page, page.getByTestId("people-list"), "people-list", info);
});

}
