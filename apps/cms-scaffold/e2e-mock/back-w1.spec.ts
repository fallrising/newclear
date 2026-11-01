import { expect, test } from "@playwright/test";
import { BACK, expectNoSeriousA11yViolations } from "./helpers";

// Seed ids from docs/v2/contracts/fixtures/work-entries.json.
const LENS_NOTES = "30000000-0000-4000-8000-000000000036";
const BUY_FILM = "30000000-0000-4000-8000-000000000035";
const STUDIO = "30000000-0000-4000-8000-000000000008";
const COAST = "30000000-0000-4000-8000-000000000001";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const FORBIDDEN_WORDS = ["PATCH", "sortOrder", "origin", "(string)"];

test.describe("W1 Back core", () => {
  test("V2-AC-10 a notes-only operator sees only Notes; list and editor work", async ({ page }) => {
    await page.goto(`${BACK}/?mockUser=mock-operator-notes`);
    const nav = page.getByRole("navigation", { name: "主要導覽" });
    await expect(nav.getByRole("link")).toHaveText(["首頁", "Notes", "媒體庫"]);
    await nav.getByRole("link", { name: "Notes" }).click();
    await page.getByRole("link", { name: "Buy film" }).click();
    await expect(page.getByLabel(/^標題/)).toHaveValue("Buy film");
  });

  test("V2-AC-05 each field type has its control and no raw UUID is visible", async ({ page }) => {
    await page.goto(`${BACK}/entries/note/${LENS_NOTES}?mockUser=mock-operator-notes`);
    await expect(page.getByLabel(/^標題/)).toHaveValue("Lens notes");
    // Shared field styles must be compiled into the app, keeping Markdown usable as a multiline editor.
    await expect(page.locator("#field-body")).toHaveCSS("min-height", "128px");
    await expect(page.getByTestId("field-category-radio")).toBeVisible();
    await expect(page.getByTestId("field-color-select")).toBeVisible();
    await expect(page.getByTestId("field-dueAt-date")).toBeVisible();
    await expect(page.getByRole("switch")).toBeVisible();
    await expect(page.getByTestId("card-relations").getByText("Buy film")).toBeVisible();
    await expect(page.getByTestId("query-loading")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(UUID);
  });

  test("V2-AC-07 draft: 發布 is the primary action and there is no 下架; published unchanged: no primary action", async ({ page }) => {
    await page.goto(`${BACK}/entries/note/${BUY_FILM}?mockUser=mock-operator-notes`);
    await expect(page.getByTestId("details-publish")).toHaveText("發布");
    await expect(page.getByTestId("details-unpublish")).toHaveCount(0);
    await page.goto(`${BACK}/entries/note/${LENS_NOTES}`);
    await expect(page.getByTestId("details-unpublish")).toBeVisible();
    await expect(page.getByTestId("details-publish")).toHaveCount(0);
  });

  test("V2-AC-08 unsaved changes: the side nav asks first; closing the tab triggers beforeunload", async ({ page }) => {
    await page.goto(`${BACK}/entries/album/${STUDIO}?mockUser=seed-operator-album`);
    await page.getByLabel(/^標題/).fill("Studio renamed");
    await expect(page.getByTestId("save-bar")).toBeVisible();
    await page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "Photos" }).click();
    await expect(page.getByTestId("leave-dialog")).toBeVisible();
    await page.getByTestId("leave-stay").click();
    await expect(page.getByLabel(/^標題/)).toHaveValue("Studio renamed");
    const dialog = page.waitForEvent("dialog");
    await page.close({ runBeforeUnload: true });
    expect((await dialog).type()).toBe("beforeunload");
  });

  test("V2-AC-09 a conflicting save opens the dialog and keeps the typed value", async ({ page }) => {
    // The mock database lives in each tab, so ?mock=conflict stands in for the second tab's earlier save.
    await page.goto(`${BACK}/entries/album/${STUDIO}?mockUser=seed-operator-album&mock=conflict`);
    await page.getByLabel(/^標題/).fill("Studio renamed");
    await page.getByTestId("save-bar-save").click();
    await expect(page.getByTestId("conflict-dialog")).toBeVisible();
    await page.getByTestId("conflict-keep").click();
    await expect(page.getByLabel(/^標題/)).toHaveValue("Studio renamed");
  });

  for (const [name, path, user] of [
    ["Back index", "/entries/photo", "seed-operator-album"],
    ["Back details", `/entries/album/${COAST}`, "seed-operator-album"],
    ["Back new entry", "/entries/note/new", "mock-operator-notes"],
    ["Back forbidden", "/entries/visit", "seed-editor-album"],
    ["Back board", "/views/projects.board", "seed-operator-projects"],
  ] as const) {
    test(`V2-AC-14 V2-AC-15 ${name}: axe clean and no engineering words`, async ({ page }) => {
      await page.goto(`${BACK}${path}?mockUser=${user}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("query-loading")).toHaveCount(0);
      await expect(page.getByTestId("index-row-loading")).toHaveCount(0);
      await expectNoSeriousA11yViolations(page);
      const text = await page.locator("body").innerText();
      expect(FORBIDDEN_WORDS.filter((word) => text.includes(word))).toEqual([]);
    });
  }
});
