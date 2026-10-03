import { expect, test, type Locator, type Page } from "@playwright/test";
import { BACK, expectNoSeriousA11yViolations } from "./helpers";

// Seed ids from docs/v2/contracts/fixtures/work-entries.json.
const COAST = "30000000-0000-4000-8000-000000000001";
const CMS_SCAFFOLD = "30000000-0000-4000-8000-000000000024";
const SPRING = "30000000-0000-4000-8000-000000000037";
const SOFTBOX = "20000000-0000-4000-8000-000000000008";
const FORBIDDEN_WORDS = ["PATCH", "sortOrder", "origin", "(string)"];
/** A 1×1 PNG; the mock accepts any image/png body. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4+P//fwAJ0APXJRfBXgAAAABJRU5ErkJggg==", "base64");

/** Drags `source` onto `target` with the mouse in small steps (dnd-kit starts after 8px of movement). */
async function drag(page: Page, source: Locator, target: Locator) {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
}

test.describe("W2 Back media and views", () => {
  test("B-S4 AC-MEDIA-01 the cover picker uploads a file and uses it without leaving the editor", async ({ page }) => {
    await page.goto(`${BACK}/entries/album/${COAST}?mockUser=seed-operator-album`);
    await page.getByRole("button", { name: "更換封面" }).click();
    const picker = page.getByTestId("media-picker");
    await expect(picker.getByTestId("picker-option")).toHaveCount(8);
    await expectNoSeriousA11yViolations(page);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.getByTestId("picker-option").evaluateAll((cells) => cells.every((cell) => cell.scrollWidth <= cell.clientWidth))).toBe(true);
    await picker.getByTestId("media-tab-upload").click();
    await picker.getByTestId("media-upload-input").setInputFiles({ name: "pier.png", mimeType: "image/png", buffer: PNG });
    await expect(picker).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/entries/album/${COAST}`);
    await expect(page.getByTestId("group-media").getByText("pier.png")).toBeVisible();
    await page.getByTestId("save-bar-save").click();
    await expect(page.getByText("已儲存")).toBeVisible();
  });

  test("C-08 G-09 album.composer: dragging a photo reorders with one batch write", async ({ page }) => {
    await page.goto(`${BACK}/views/album.composer?album=${COAST}&mockUser=seed-operator-album`);
    const photos = page.getByTestId("composer-photo");
    await expect(photos.locator("strong")).toHaveText(["Harbour wall", "Late sun", "Concrete edge", "Salt air", "Window light", "Last ferry"]);
    const batch = page.waitForRequest((r) => r.url().endsWith("/api/v1/entries:batch-patch"));
    await drag(page, photos.nth(0), photos.nth(2));
    const items = (await batch).postDataJSON().items;
    expect(items).toHaveLength(3);
    expect(items.map((item: { payload: unknown }) => item.payload)).toEqual([{ sortOrder: 10 }, { sortOrder: 20 }, { sortOrder: 30 }]);
    expect(items.every((item: { version: number }) => Number.isInteger(item.version) && item.version > 0)).toBe(true);
    await expect(photos.locator("strong")).toHaveText(["Late sun", "Concrete edge", "Harbour wall", "Salt air", "Window light", "Last ferry"]);
    await expect(page.getByText("已更新順序")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/views/album.composer");
  });

  test("B-S5 album.composer uploads several photos into the album", async ({ page }) => {
    await page.goto(`${BACK}/views/album.composer?album=${COAST}&mockUser=seed-operator-album`);
    await expect(page.getByTestId("composer-photo")).toHaveCount(6);
    await page.getByTestId("composer-upload-input").setInputFiles([
      { name: "dock.png", mimeType: "image/png", buffer: PNG },
      { name: "pier.png", mimeType: "image/png", buffer: PNG },
    ]);
    await expect(page.getByText("已加入 2 張相片")).toBeVisible();
    await expect(page.getByTestId("composer-photo").locator("strong")).toHaveText([
      "Harbour wall", "Late sun", "Concrete edge", "Salt air", "Window light", "Last ferry", "dock", "pier",
    ]);
  });

  test("V2-AC-12 projects.board: a drag moves the card; a failed move puts it back with a toast", async ({ page }) => {
    await page.goto(`${BACK}/views/projects.board?project=${CMS_SCAFFOLD}&mockUser=seed-operator-projects`);
    const card = page.getByTestId("board-card").filter({ hasText: "Kanban DnD" });
    const patch = page.waitForRequest((r) => r.method() === "PATCH" && r.url().includes("/api/v1/entries/"));
    await drag(page, card, page.getByTestId("board-column-in_progress"));
    expect((await patch).postDataJSON()).toEqual({ version: 1, payload: { status: "in_progress" } });
    await expect(page.getByTestId("board-column-in_progress").getByText("Kanban DnD")).toBeVisible();
    await expect(page.getByText("已把「Kanban DnD」移到「進行中」")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/views/projects.board");
    await page.goto(`${BACK}/views/projects.board?project=${CMS_SCAFFOLD}&mockUser=seed-operator-projects&mock=conflict`);
    await drag(page, page.getByTestId("board-card").filter({ hasText: "Kanban DnD" }), page.getByTestId("board-column-done"));
    await expect(page.getByText("沒有移動成功，卡片已回到原本的欄位。")).toBeVisible();
    await expect(page.getByTestId("board-column-ready").getByText("Kanban DnD")).toBeVisible();
    await expect(page.getByTestId("board-column-done").getByText("Kanban DnD")).toHaveCount(0);
  });

  test.describe("in Asia/Taipei", () => {
    test.use({ timezoneId: "Asia/Taipei" });

    test("V2-AC-11 clinic.schedule opens on the local today at 07:30", async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-09-19T23:30:00Z"));
      await page.goto(`${BACK}/views/clinic.schedule?mockUser=seed-operator-clinic`);
      await expect(page.getByTestId("schedule-day")).toHaveText("2026年9月20日 星期日");
      const visit = page.getByTestId("schedule-visit").filter({ hasText: "Leo checkup" });
      await expect(visit.getByTestId("schedule-time")).toHaveText("17:00");
      await expect(visit).toContainText("寵物Leo");
    });
  });

  test.describe("at 390px", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("V2-AC-13 U-03 the board shows one column at a time and no page scrolls sideways", async ({ page }) => {
      await page.goto(`${BACK}/views/projects.board?project=${CMS_SCAFFOLD}&mockUser=seed-operator-projects`);
      await expect(page.getByTestId("board-tab-done")).toBeVisible();
      expect(await page.getByRole("tablist").evaluate((list) => {
        const outer = list.getBoundingClientRect();
        return [...list.querySelectorAll('[role="tab"]')].every((tab) => {
          const rect = tab.getBoundingClientRect();
          return rect.top >= outer.top && rect.bottom <= outer.bottom;
        });
      })).toBe(true);
      await expect(page.getByTestId("board-column-backlog")).toBeVisible();
      for (const status of ["ready", "in_progress", "in_review", "done"]) await expect(page.getByTestId(`board-column-${status}`)).toBeHidden();
      await page.getByTestId("board-tab-done").click();
      await expect(page.getByTestId("board-column-done")).toBeVisible();
      await expect(page.getByTestId("board-column-backlog")).toBeHidden();
      for (const path of ["/", "/entries/album", `/entries/album/${COAST}`, "/views/projects.board", `/views/album.composer?album=${COAST}`, "/views/clinic.schedule", "/media"]) {
        await page.goto(`${BACK}${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByTestId("query-loading")).toHaveCount(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  });

  for (const [name, path, user] of [
    ["Back media library", "/media", "seed-operator-album"],
    ["Back media details", `/media/${SOFTBOX}`, "seed-operator-album"],
    ["Back preview", `/entries/note/${SPRING}/preview`, "mock-operator-notes"],
    ["Back history", `/entries/note/${SPRING}/history`, "mock-operator-notes"],
    ["Back composer", `/views/album.composer?album=${COAST}`, "seed-operator-album"],
    ["Back schedule", "/views/clinic.schedule?date=2026-03-01", "seed-operator-clinic"],
  ] as const) {
    test(`V2-AC-14 V2-AC-15 ${name}: axe clean and no engineering words`, async ({ page }) => {
      await page.goto(`${BACK}${path}${path.includes("?") ? "&" : "?"}mockUser=${user}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("query-loading")).toHaveCount(0);
      await expectNoSeriousA11yViolations(page);
      const text = await page.locator("body").innerText();
      expect(FORBIDDEN_WORDS.filter((word) => text.includes(word))).toEqual([]);
    });
  }
});
