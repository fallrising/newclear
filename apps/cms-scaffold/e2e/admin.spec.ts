import { expect, test } from "@playwright/test";
import { ADMIN, BACK, expectHeading, login } from "./helpers";

test.describe("W5 real Admin", () => {
  test.describe.configure({ mode: "serial" });

  test("W5 real Admin overview types and principals", async ({ page }) => {
    await login(page, ADMIN, "seed-admin");
    await expectHeading(page, "總覽");
    await expect(page.getByText("類型啟停、角色與使用者、審計與儲存。日常編輯請用 Back office。", { exact: true })).toBeVisible();
    await page.getByTestId("nav-types").click(); await expectHeading(page, "內容類型");
    await expect(page.getByTestId("index-row").filter({ hasText: "album" })).toBeVisible();
    await page.getByTestId("nav-principals").click(); await expectHeading(page, "使用者");
    await expect(page.getByTestId("index-row").filter({ hasText: "seed-admin" })).toBeVisible();
    await expect(page.getByTestId("nav-audit")).toBeVisible();
    await expect(page.getByRole("link", { name: "專案看板", exact: true })).toHaveCount(0);
    // Preserve the prior cross-surface navigation isolation regression.
    await login(page, BACK, "seed-admin"); await expectHeading(page, "作業台");
    await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "內容類型", exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "設定", exact: true })).toHaveCount(0);
  });

  test("W5 real Admin audit list and detail", async ({ page }) => {
    await login(page, ADMIN, "seed-admin");
    await page.goto(`${ADMIN}/audit`); await expectHeading(page, "審計");
    await page.getByTestId("index-row").first().getByRole("link").first().click();
    await expect(page.getByTestId("audit-detail-json")).toBeVisible();
    expect(JSON.parse(await page.getByTestId("audit-detail-json").innerText())).toBeDefined();
  });

  test("W5 real Admin operator is forbidden", async ({ page }) => {
    await login(page, ADMIN, "seed-operator-album");
    await expect(page.getByRole("alert")).toContainText("這個帳號不能使用這個作業台。");
    for (const id of ["nav-types", "nav-principals", "nav-audit"]) await expect(page.getByTestId(id)).toHaveCount(0);
  });
});
