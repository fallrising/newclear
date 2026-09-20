import { expect, test } from "@playwright/test";
import { BACK, expectHeading, login } from "./helpers";

test.describe("Back office", () => {
  test("operator can open album composer", async ({ page }) => {
    await login(page, BACK, "seed-operator-album");
    await expectHeading(page, "作業台");
    await expect(page.getByRole("navigation").getByRole("link", { name: "相簿編排" })).toBeVisible();
    await expect(page.getByRole("link", { name: "內容類型" })).toHaveCount(0);
    await page.getByRole("navigation").getByRole("link", { name: "相簿編排" }).click();
    await expectHeading(page, "相簿編排");
    await page.getByLabel("相簿").selectOption({ label: "Coast Light 2026" });
    await expect(page.getByText("Harbour wall", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "上移" }).first()).toBeVisible();
  });

  test("operator can open clinic schedule and projects board", async ({ page }) => {
    await login(page, BACK, "seed-operator-clinic");
    await page.getByRole("navigation").getByRole("link", { name: "當日行程" }).click();
    await expectHeading(page, "當日行程");
    await expect(page.getByLabel("日期")).toBeVisible();
  });

  test("projects board patches status without a boards API", async ({ page }) => {
    const publishCalls: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/publish")) {
        publishCalls.push(request.url());
      }
    });
    await login(page, BACK, "seed-operator-projects");
    await page.getByRole("navigation").getByRole("link", { name: "看板" }).click();
    await expectHeading(page, "看板");
    await page.getByLabel("專案").selectOption({ label: "CMS Scaffold" });
    await expect(page.getByText("Write album pack")).toBeVisible();
    expect(publishCalls).toEqual([]);
  });

  test("editor does not see Publish on an album editor", async ({ page }) => {
    await login(page, BACK, "seed-editor-album");
    await page.getByRole("navigation").getByRole("link", { name: "album", exact: true }).click();
    const first = page.locator("ul a").first();
    await first.click();
    await expect(page.getByRole("button", { name: "儲存草稿" })).toBeVisible();
    await expect(page.getByRole("button", { name: "發布" })).toHaveCount(0);
  });

  test("member cannot enter Back work routes", async ({ page }) => {
    await login(page, BACK, "seed-member-clinic");
    await expect(page.getByText("這個帳號不能進 Back office。")).toBeVisible();
    await expect(page.getByRole("heading", { name: "作業台" })).toHaveCount(0);
  });
});
