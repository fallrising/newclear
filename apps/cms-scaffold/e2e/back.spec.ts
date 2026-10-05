import { expect, test } from "@playwright/test";
import { BACK, expectHeading, login } from "./helpers";

test.describe("W5 real Back", () => {
  test.describe.configure({ mode: "serial" });

  test("W5 real Back album operator opens index and editor", async ({ page }) => {
    await login(page, BACK, "seed-operator-album");
    await page.goto(`${BACK}/entries/album`);
    await expectHeading(page, "Albums");
    await page.getByTestId("index-row").filter({ hasText: "Studio (unpublished)" }).getByRole("link").first().click();
    await expect(page.getByLabel(/^標題/)).toHaveValue("Studio (unpublished)");
    await expect(page.getByTestId("page-header").getByTestId("status-badge")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "內容類型", exact: true })).toHaveCount(0);
    // Preserve the prior editor permission regression using the v2 save bar.
    await login(page, BACK, "seed-editor-album");
    await page.goto(`${BACK}/entries/album`);
    await page.getByTestId("index-row").filter({ hasText: "Studio (unpublished)" }).getByRole("link").first().click();
    await expect(page.getByTestId("details-publish")).toHaveCount(0);
    await page.getByLabel(/^標題/).fill("Studio editor draft");
    await expect(page.getByTestId("save-bar-save")).toBeVisible();
  });

  test("W5 real Back album composer loads ordered photos", async ({ page }) => {
    await login(page, BACK, "seed-operator-album");
    await page.goto(`${BACK}/views/album.composer`);
    await page.getByLabel("相簿", { exact: true }).click();
    await page.getByRole("option", { name: "Coast Light 2026", exact: true }).click();
    await expect(page.getByTestId("composer-photo").locator("strong")).toHaveText(["Harbour wall", "Late sun", "Concrete edge", "Salt air", "Window light", "Last ferry"]);
  });

  test("W5 real Back clinic schedule uses local date", async ({ page }) => {
    await login(page, BACK, "seed-operator-clinic");
    await page.goto(`${BACK}/views/clinic.schedule`);
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    await expect(page.getByLabel("日期", { exact: true })).toHaveValue(today);
    await page.getByLabel("日期", { exact: true }).fill("2026-09-20");
    await expect(page.getByTestId("schedule-visit").filter({ hasText: "Leo checkup" })).toBeVisible();
    await expect(page.getByTestId("schedule-visit").filter({ hasText: "Leo checkup" }).getByTestId("schedule-time")).toHaveText("17:00");
  });

  test("W5 real Back projects board changes no publication state", async ({ page }) => {
    await login(page, BACK, "seed-operator-projects");
    await page.goto(`${BACK}/views/projects.board`);
    await page.getByLabel("專案", { exact: true }).click();
    await page.getByRole("option", { name: "CMS Scaffold", exact: true }).click();
    await expect(page.getByTestId("board-card").filter({ hasText: "Write album pack" })).toBeVisible();
    const mutations: { method: string; path: string; body: Record<string, unknown> }[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/v1/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) mutations.push({ method: request.method(), path, body: request.postDataJSON() as Record<string, unknown> });
    });
    const card = page.getByTestId("board-card").filter({ hasText: "Kanban DnD" });
    const target = page.getByTestId("board-column-in_progress");
    const from = await card.boundingBox(); const to = await target.boundingBox();
    expect(from).not.toBeNull(); expect(to).not.toBeNull();
    const patched = page.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname.startsWith("/api/v1/entries/"));
    await page.mouse.move(from!.x + from!.width / 2, from!.y + 20);
    await page.mouse.down();
    await page.mouse.move(from!.x + from!.width / 2 + 12, from!.y + 20, { steps: 4 });
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 15 });
    await page.mouse.up();
    expect((await patched).ok()).toBe(true);
    await expect(target.getByText("Kanban DnD", { exact: true })).toBeVisible();
    expect(mutations).toHaveLength(1);
    expect(mutations[0].method).toBe("PATCH");
    expect(mutations[0].path).toMatch(/^\/api\/v1\/entries\/[^/]+$/);
    expect(mutations[0].body.payload).toEqual({ status: "in_progress" });
    expect(JSON.stringify(mutations)).not.toMatch(/\/boards|\/publish|publicationState/);
  });

  test("W5 real Back member is forbidden", async ({ page }) => {
    await login(page, BACK, "seed-member-clinic");
    await expect(page.getByRole("alert")).toContainText("這個帳號不能使用這個作業台。");
    await expect(page.getByRole("heading", { level: 1, name: "作業台", exact: true })).toHaveCount(0);
  });
});
