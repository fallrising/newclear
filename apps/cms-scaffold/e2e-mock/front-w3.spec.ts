import { expect, test } from "@playwright/test";
import { computed, expectNoSeriousA11yViolations, FRONT } from "./helpers";

const CANONICAL = 'link[rel="canonical"]';

test.describe("W3 Front public site", () => {
  test("AC-02 V2-AC-04 album → photo wall → lightbox (keyboard, ?photo=) → photo page, public API only", async ({ page }) => {
    const api: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) api.push(`${url.pathname}${url.search}`);
    });
    await page.goto(`${FRONT}/album`);
    await page.getByTestId("album-card").filter({ hasText: "Coast Light 2026" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Coast Light 2026" })).toBeVisible();
    await expect(page.getByTestId("photo-tile")).toHaveCount(6);
    const openingTile = page.getByTestId("photo-tile").nth(1);
    await openingTile.focus();
    await page.keyboard.press("Enter");
    const box = page.getByTestId("lightbox");
    await expect(box).toBeVisible();
    await expect(page).toHaveURL(`${FRONT}/album/albums/coast-light-2026?photo=coast-sun`);
    await expect(box.getByTestId("lightbox-image")).toHaveAttribute("src", /\/file\/web$/);
    expect(await computed(page, "[data-testid=lightbox-title]", "font-size")).toBe("22px");
    expect(await computed(page, "[data-testid=lightbox]", "background-color")).toBe("rgb(17, 17, 17)");
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/\?photo=coast-concrete$/);
    await expect(box.getByTestId("lightbox-counter")).toHaveText("3 / 6");
    await page.keyboard.press("ArrowLeft");
    await expect(box.getByTestId("lightbox-counter")).toHaveText("2 / 6");
    await page.keyboard.press("ArrowRight");
    await expect(box.getByTestId("lightbox-counter")).toHaveText("3 / 6");
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
    await expect(page).toHaveURL(`${FRONT}/album/albums/coast-light-2026`);
    await expect(openingTile).toBeFocused();
    await page.goto(`${FRONT}/album/photos/coast-sun`);
    const image = page.getByTestId("photo-image");
    await expect(image).toHaveAttribute("src", /\/api\/v1\/public\/media\/.+\/file\/web$/);
    await expect(image).toHaveAttribute("width", "64");
    await expect(image).toHaveAttribute("height", "64");
    expect(api.length).toBeGreaterThan(0);
    expect(api.filter((path) => !path.startsWith("/api/v1/public/"))).toEqual([]);
    expect(api.filter((path) => /previewToken|publicationState|includeDraft/.test(path))).toEqual([]);
  });

  test("F-S2 the lightbox blank background closes it while image and controls clicks stay open", async ({ page }) => {
    await page.goto(`${FRONT}/album/albums/coast-light-2026`);
    const openingTile = page.getByTestId("photo-tile").nth(1);
    await openingTile.click();
    const box = page.getByTestId("lightbox");
    await expect(box).toBeVisible();
    await box.getByTestId("lightbox-image").click();
    await expect(box).toBeVisible();
    await box.getByTestId("lightbox-next").click();
    await expect(box.getByTestId("lightbox-counter")).toHaveText("3 / 6");
    await expect(box).toBeVisible();
    // Click empty space in the image container, well away from the centered image and controls.
    const background = box.getByTestId("lightbox-image").locator("..");
    await background.click({ position: { x: 8, y: 8 } });
    await expect(box).toBeHidden();
    await expect(page).toHaveURL(`${FRONT}/album/albums/coast-light-2026`);
    await expect(openingTile).toBeFocused();
    // Direct links have no opening click: closing restores focus to the linked photo's tile.
    await page.goto(`${FRONT}/album/albums/coast-light-2026?photo=coast-sun`);
    await expect(box).toBeVisible();
    await box.getByTestId("lightbox-close").click();
    await expect(box).toBeHidden();
    await expect(page).toHaveURL(`${FRONT}/album/albums/coast-light-2026`);
    await expect(page.getByTestId("photo-tile").nth(1)).toBeFocused();
  });

  test("V2-AC-02 C-02 a slow list shows only the skeleton for the first second, never the empty copy", async ({ page }) => {
    await page.goto(`${FRONT}/album/albums?mock=slow`);
    await expect(page.getByTestId("query-loading").first()).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("query-loading").first()).toBeVisible();
    await expect(page.getByText("還沒有公開相簿")).toHaveCount(0);
    await expect(page.getByTestId("album-card").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("還沒有公開相簿")).toHaveCount(0);
  });

  test("V2-AC-03 C-03 a 500 on a detail page shows ErrorPublic with retry, not NotFoundPublic", async ({ page }) => {
    await page.goto(`${FRONT}/clinic/vets/james-carter?mock=error500`);
    await expect(page.getByRole("heading", { level: 1, name: "暫時無法載入" })).toBeVisible();
    await expect(page.getByTestId("error-retry")).toBeVisible();
    await expect(page.getByTestId("not-found-public")).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test("AC-07 AC-17 an unpublished album with ?preview= is NotFoundPublic (noindex); a published one gets a canonical URL without the query", async ({ page }) => {
    await page.goto(`${FRONT}/album/albums/private-studio?preview=abc`);
    await expect(page.getByRole("heading", { level: 1, name: "找不到這個頁面" })).toBeVisible();
    await expect(page).toHaveURL(`${FRONT}/album/albums/private-studio?preview=abc`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow");
    await expect(page.locator(CANONICAL)).toHaveCount(0);
    await page.goto(`${FRONT}/album/albums/coast-light-2026?preview=abc`);
    await expect(page.getByRole("heading", { level: 1, name: "Coast Light 2026" })).toBeVisible();
    await expect(page).toHaveTitle("Coast Light 2026 · 相簿");
    await expect(page.locator(CANONICAL)).toHaveAttribute("href", `${FRONT}/album/albums/coast-light-2026`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index,follow");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/file\/web$/);
  });

  test("C-04 an unknown path stays on its URL and shows NotFoundPublic", async ({ page }) => {
    await page.goto(`${FRONT}/clinic/vets/nobody/extra`);
    await expect(page.getByTestId("not-found-public")).toBeVisible();
    await expect(page).toHaveURL(`${FRONT}/clinic/vets/nobody/extra`);
    await expect(page.getByRole("link", { name: "回到診所首頁" })).toBeVisible();
  });

  test("V2-AC-01 Front: the clinic site uses its warm scheme; the title uses the Front size", async ({ page }) => {
    await page.goto(`${FRONT}/clinic`);
    await expect(page.getByRole("heading", { level: 1, name: "Cedar Pet Clinic" })).toBeVisible();
    expect(await computed(page, "[data-site=clinic]", "background-color")).toBe("rgb(247, 244, 238)");
    expect(await computed(page, "h1", "font-size")).toBe("32px");
    await expect(page).toHaveTitle("診所");
  });

  test("U-03 at 390px the navigation is a sheet and no page scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${FRONT}/album`);
    await expect(page.getByTestId("site-nav")).toBeHidden();
    await page.getByTestId("site-nav-open").click();
    await expect(page.getByTestId("site-nav-sheet")).toBeVisible();
    // The sheet is portalled out of the site root; it must still use the gallery-dark text colour.
    expect(await computed(page, "[data-testid=site-nav-sheet] a", "color")).toBe("rgb(242, 242, 242)");
    await page.getByRole("dialog").getByRole("link", { name: "相簿" }).click();
    await expect(page).toHaveURL(`${FRONT}/album/albums`);
    await expect(page.getByRole("dialog")).toBeHidden();
    for (const path of ["/", "/album/albums", "/album/albums/coast-light-2026", "/album/photos/coast-sun", "/clinic", "/clinic/vets/james-carter", "/projects/cms-scaffold"]) {
      await page.goto(`${FRONT}${path}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("query-loading")).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBe(0);
    }
  });

  for (const [name, path] of [
    ["album list", "/album/albums"],
    ["album detail", "/album/albums/coast-light-2026"],
    ["photo page", "/album/photos/coast-sun"],
    ["clinic home", "/clinic"],
    ["vet list", "/clinic/vets"],
    ["vet page", "/clinic/vets/james-carter"],
    ["projects home", "/projects"],
    ["project page", "/projects/cms-scaffold"],
    ["milestone list", "/projects/cms-scaffold/milestones"],
    ["milestone page", "/projects/cms-scaffold/milestones/m1-specs"],
    ["not found", "/album/albums/secret"],
    ["empty list", "/projects?mock=empty"],
  ] as const) {
    test(`V2-AC-14 axe: Front ${name}`, async ({ page }) => {
      await page.goto(`${FRONT}${path}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("query-loading")).toHaveCount(0);
      await expectNoSeriousA11yViolations(page);
    });
  }

  test("V2-AC-14 axe: Front mobile menu open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${FRONT}/projects`);
    await expect(page.getByTestId("project-card").first()).toBeVisible();
    await page.getByTestId("site-nav-open").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
