import { expect, test } from "@playwright/test";
import { ADMIN, BACK, expectHeading, login } from "./helpers";

test.describe("Admin center", () => {
  test("admin sees types and users, not a writing bench", async ({ page }) => {
    await login(page, ADMIN, "seed-admin");
    await expectHeading(page, "治理台");
    await expect(page.getByText(/日常編輯請用 Back office/)).toBeVisible();
    await page.getByRole("link", { name: "類型" }).click();
    await expectHeading(page, "內容類型");
    await expect(page.getByText("album", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "使用者" }).click();
    await expectHeading(page, "使用者");
    await expect(page.getByText(/seed-admin · Platform admin/)).toBeVisible();
    await expect(page.getByRole("link", { name: "看板" })).toHaveCount(0);
  });

  test("operator cannot use Admin governance routes", async ({ page }) => {
    await login(page, ADMIN, "seed-operator-album");
    await expect(page.getByText("這個帳號不能進 Admin center。")).toBeVisible();
  });

  test("admin login on Back does not show Admin navigation", async ({ page }) => {
    await login(page, BACK, "seed-admin");
    await expectHeading(page, "作業台");
    await expect(page.getByRole("link", { name: "類型" })).toHaveCount(0);
    await expect(page.getByText("系統設定")).toHaveCount(0);
  });
});
