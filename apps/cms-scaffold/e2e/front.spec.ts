import { expect, test } from "@playwright/test";
import { FRONT, expectHeading, login } from "./helpers";

test.describe("W5 real Front", () => {
  test.describe.configure({ mode: "serial" });

  test("W5 real Front selector and three public sites", async ({ page }) => {
    await page.goto(FRONT);
    await expect(page.getByTestId("selector-card")).toHaveCount(3);
    for (const site of ["album", "clinic", "projects"]) {
      await expect(page.getByTestId("selector-card").filter({ hasText: site === "album" ? "個人相簿" : site === "clinic" ? "寵物診所" : "專案" })).toHaveAttribute("href", `/${site}`);
    }
    for (const [path, title] of [["/album", "相簿"], ["/clinic", "Cedar Pet Clinic"], ["/projects", "專案"]]) {
      await page.goto(`${FRONT}${path}`); await expectHeading(page, title);
    }
    // Preserve the previous public-list and direct unlisted-slug regressions.
    await page.goto(`${FRONT}/album/albums`);
    await expect(page.getByTestId("album-card").filter({ hasText: "Coast Light 2026" })).toBeVisible();
    await expect(page.getByText("Unlisted proof")).toHaveCount(0);
    await expect(page.getByText("Studio (unpublished)")).toHaveCount(0);
    await page.goto(`${FRONT}/album/albums/unlisted-proof`); await expectHeading(page, "Unlisted proof");
  });

  test("W5 real Front album wall uses web image and dimensions", async ({ page }) => {
    await page.goto(`${FRONT}/album/albums/coast-light-2026`);
    await expectHeading(page, "Coast Light 2026");
    await expect(page.getByTestId("photo-tile")).toHaveCount(6);
    await page.getByTestId("photo-tile").nth(1).click();
    const image = page.getByTestId("lightbox-image");
    await expect(image).toHaveAttribute("src", /\/file\/web$/);
    await expect(image).toHaveAttribute("width", /^[1-9]\d*$/);
    await expect(image).toHaveAttribute("height", /^[1-9]\d*$/);
    await page.getByTestId("lightbox-close").click();
    await page.goto(`${FRONT}/album/photos/coast-harbour`);
    await expect(page.getByText("Tide against the harbour wall.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("photo-image")).toBeVisible();
  });

  test("W5 real Front draft is NotFoundPublic without engineering copy", async ({ page }) => {
    await page.goto(`${FRONT}/album/albums/private-studio`);
    await expect(page.getByTestId("not-found-public")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("publicationState");
  });

  test("W5 real Front clinic vets hide draft", async ({ page }) => {
    await page.goto(`${FRONT}/clinic/vets`);
    await expect(page.getByTestId("vet-card").filter({ hasText: "James Carter" })).toBeVisible();
    await expect(page.getByText("Linda Douglas")).toHaveCount(0);
  });

  test("W5 real Front projects hide private and expose milestones", async ({ page }) => {
    await page.goto(`${FRONT}/projects`);
    await expect(page.getByTestId("project-card").filter({ hasText: "CMS Scaffold" })).toBeVisible();
    await expect(page.getByText("Internal Ops")).toHaveCount(0);
    await expect(page.getByText("Draft Lab")).toHaveCount(0);
    await page.goto(`${FRONT}/projects/cms-scaffold/milestones`);
    await expect(page.getByText("M1 Specs", { exact: true })).toBeVisible();
    await expect(page.getByText("Internal Ops")).toHaveCount(0);
    await expect(page.getByText("Draft Lab")).toHaveCount(0);
  });

  test("W5 real Front member login opens owned dashboard", async ({ page }) => {
    await login(page, FRONT, "seed-member-clinic");
    await page.goto(`${FRONT}/clinic/me`);
    await expect(page.getByTestId("member-home")).toBeVisible();
    await expect(page.getByTestId("member-pets").getByText("Leo", { exact: true })).toBeVisible();
    await expect(page.getByTestId("member-pets").getByText("Mochi", { exact: true })).toBeVisible();
    await expect(page.getByText("Basil", { exact: true })).toHaveCount(0);
  });
});
