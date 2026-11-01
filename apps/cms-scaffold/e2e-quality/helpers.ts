import { expect, type Page } from "@playwright/test";
import type { PageCase, PrepareName, Ready } from "./pages";

export function urlFor(c: PageCase): string {
  const origins = { front: "http://127.0.0.1:5173", back: "http://127.0.0.1:5174", admin: "http://127.0.0.1:5175" };
  const url = new URL(c.path, origins[c.surface]);
  if (c.mockUser !== null) url.searchParams.set("mockUser", c.mockUser);
  return url.href;
}
export async function waitReady(page: Page, ready: Ready): Promise<void> {
  if (ready.kind === "testId") await expect(page.getByTestId(ready.value)).toBeVisible();
  else await expect(page.getByRole(ready.role, { level: ready.level, ...(ready.name ? { name: ready.name, exact: true } : {}) })).toBeVisible();
}
export async function settle(page: Page): Promise<void> {
  await expect(page.getByTestId("query-loading")).toHaveCount(0);
  await expect(page.getByTestId("index-row-loading")).toHaveCount(0);
  await page.evaluate(async () => { await document.fonts.ready; });
  await expect.poll(() => page.locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
}
export async function openCase(page: Page, c: PageCase, viewport: "desktop" | "mobile"): Promise<void> {
  await page.setViewportSize(viewport === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  await page.goto(urlFor(c));
  await waitReady(page, c.ready);
  await settle(page);
}
export const prepares: Record<PrepareName, (page: Page) => Promise<void>> = {
  async frontMobileMenu(page) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("site-nav-open").click();
    await expect(page.getByTestId("site-nav-sheet")).toBeVisible();
  },
  async frontLightbox(page) {
    await expect(page.getByTestId("photo-tile")).toHaveCount(6);
    await page.getByTestId("photo-tile").nth(1).click();
    await expect(page.getByTestId("lightbox")).toBeVisible();
  },
  async backMediaPicker(page) {
    await page.getByTestId("field-cover-pick").click();
    await expect(page.getByTestId("media-picker")).toBeVisible();
    await expect(page.getByTestId("picker-loading")).toHaveCount(0);
  },
  async backConflictDialog(page) {
    const url = new URL(page.url()); url.searchParams.set("mock", "conflict");
    await page.goto(url.href);
    await page.getByLabel(/^標題/).fill("Studio renamed");
    await page.getByTestId("save-bar-save").click();
    await expect(page.getByTestId("conflict-dialog")).toBeVisible();
  },
  async backLeaveDialog(page) {
    await page.getByLabel(/^標題/).fill("Studio renamed");
    await page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "Photos", exact: true }).click();
    await expect(page.getByTestId("leave-dialog")).toBeVisible();
  },
  async adminConfirmDialog(page) {
    await page.getByTestId("type-toggle").click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible();
  },
  async adminTemporaryPassword(page) {
    await page.getByTestId("new-username").fill("clinic.op");
    await page.getByTestId("role-operator").click();
    for (const type of ["owner", "pet", "vet", "visit"]) await page.getByTestId(`role-operator-type-${type}`).click();
    await page.getByTestId("new-submit").click();
    await expect(page.getByTestId("temp-password")).toBeVisible();
  },
  async adminMemberLinkDialog(page) {
    await page.getByTestId("member-edit").click();
    await expect(page.getByTestId("member-dialog")).toBeVisible();
  },
};
