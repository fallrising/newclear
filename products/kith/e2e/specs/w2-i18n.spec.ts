import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import { note, shot } from "../harness/evidence.ts";

const RAW_KEY = /\b(app|auth|home|rooms?|room|timeline|composer|md|error|settings|console|user|notFound)\.[a-zA-Z_]+(\.[a-zA-Z_]+)*\b/;

async function expectLive(page: Page): Promise<void> {
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByTestId("room-connection")).toHaveCount(0);
  await expect(page.getByTestId("room-offline-strip")).toHaveCount(0);
}

test(
  "E2E-W2-06 switching language and theme updates every string and date",
  { tag: ["@W2", "@mobile"] },
  async ({ page }, info) => {
    const from = info.project.name === "desktop" ? "zh-TW" : "en";
    const to = from === "zh-TW" ? "en" : "zh-TW";
    const sendText = (locale: string): string => (locale === "zh-TW" ? "送出" : "Send");
    const createdText = (locale: string): string => (locale === "zh-TW" ? "2026年9月1日" : "September 1, 2026");
    const todayText = (locale: string): string => (locale === "zh-TW" ? "今天" : "Today");

    async function clickMenu(id: string): Promise<void> {
      if (info.project.name === "mobile") await page.goto("/");
      await page.getByTestId("user-menu").click();
      await page.getByTestId(id).click();
    }

    await page.clock.setFixedTime(new Date("2026-09-22T12:00:00+08:00"));
    await loginViaUi(page, ACCOUNTS.ada);
    await page.goto("/r/lobby");
    await expectLive(page);
    await expect(page.getByTestId("timeline-start")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", from);
    await expect(page.getByTestId("composer-send")).toHaveText(sendText(from));
    await expect(page.getByTestId("timeline-start")).toContainText(createdText(from));
    await shot(page, info, "01-from");

    await clickMenu("user-menu-lang-" + to);
    await page.goto("/r/lobby");
    await expectLive(page);
    await expect(page.locator("html")).toHaveAttribute("lang", to);
    await expect(page.getByTestId("composer-send")).toHaveText(sendText(to));
    await expect(page.getByTestId("timeline-start")).toContainText(createdText(to));
    await expect(page.locator('[data-testid="date-divider"][data-date="2026-09-22"]')).toHaveText(todayText(to));
    await shot(page, info, "02-to");

    await page.reload();
    await expectLive(page);
    await expect(page.locator("html")).toHaveAttribute("lang", to);

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(RAW_KEY);
    note(info, "no raw copy keys visible after switching");

    await clickMenu("user-menu-theme-dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(23, 20, 17)");
    await shot(page, info, "03-dark");

    await clickMenu("user-menu-theme-system");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);

    await clickMenu("user-menu-lang-" + from);
    await expect(page.locator("html")).toHaveAttribute("lang", from);
  },
);
