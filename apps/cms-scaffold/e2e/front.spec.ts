import { expect, test } from "@playwright/test";
import { FRONT, expectHeading } from "./helpers";

test.describe("Front office", () => {
  test("album index shows published public albums only", async ({ page }) => {
    await page.goto(`${FRONT}/album`);
    await expectHeading(page, "相簿");
    await expect(page.getByRole("heading", { name: "Coast Light 2026" })).toBeVisible();
    await expect(page.getByText("Unlisted proof")).toHaveCount(0);
    await expect(page.getByText("Studio (unpublished)")).toHaveCount(0);
  });

  test("album wall shows ordered published photos", async ({ page }) => {
    await page.goto(`${FRONT}/album/albums/coast-light-2026`);
    await expectHeading(page, "Coast Light 2026");
    await expect(page.getByText("Tide against the harbour wall.")).toBeVisible();
    await page.locator('a[href*="/album/photos/"]').first().click();
    await expect(page.getByRole("img")).toBeVisible();
  });

  test("draft album URL is a not-found state", async ({ page }) => {
    await page.goto(`${FRONT}/album/albums/private-studio`);
    await expectHeading(page, "找不到相簿");
    await expect(page.getByText(/尚未發布/)).toBeVisible();
    await expect(page.getByText("publicationState")).toHaveCount(0);
  });

  test("unlisted album is reachable by slug", async ({ page }) => {
    await page.goto(`${FRONT}/album/albums/unlisted-proof`);
    await expectHeading(page, "Unlisted proof");
  });

  test("clinic shows published profile and vets, not draft Douglas", async ({ page }) => {
    await page.goto(`${FRONT}/clinic`);
    await expectHeading(page, "Cedar Pet Clinic");
    await expect(page.getByRole("heading", { name: "James Carter" })).toBeVisible();
    await expect(page.getByText("Linda Douglas")).toHaveCount(0);
  });

  test("projects list hides private and draft", async ({ page }) => {
    await page.goto(`${FRONT}/projects`);
    await expect(page.getByRole("heading", { name: "CMS Scaffold" })).toBeVisible();
    await expect(page.getByText("Internal Ops")).toHaveCount(0);
    await expect(page.getByText("Draft Lab")).toHaveCount(0);
    await page.getByRole("link", { name: /CMS Scaffold/ }).click();
    await expect(page.getByText("M1 Specs")).toBeVisible();
  });
});
