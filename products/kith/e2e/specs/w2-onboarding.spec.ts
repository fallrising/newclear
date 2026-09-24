import type { Browser, Page, TestInfo } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi } from "../fixtures/actors.ts";
import type { Recorder } from "../harness/recorder.ts";
import { note, shot } from "../harness/evidence.ts";

async function freshPage(browser: Browser, info: TestInfo, recorder: Recorder, actor: string): Promise<Page> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: process.env.KITH_E2E_BASE_URL,
    viewport: use.viewport,
    locale: use.locale,
    timezoneId: use.timezoneId,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
  });
  const page = await context.newPage();
  recorder.watch(page, actor);
  return page;
}

test(
  "E2E-W2-01 operator onboards a new person into a new room",
  { tag: ["@W2"] },
  async ({ page, browser, recorder }, info) => {
    test.setTimeout(180_000);
    const rand = Date.now().toString(36);
    const handle = `fern_${rand}`;
    const slug = `w2-family-${rand}`;
    const roomName = `W2 家庭 ${rand}`;

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await loginViaUi(page, ACCOUNTS.ada);
    await page.goto("/");

    await expect(page.getByTestId("home-guide-room")).toBeVisible();
    await expect(page.getByTestId("home-guide-people")).toBeVisible();
    await expect(page.getByTestId("console-link")).toBeVisible();
    await shot(page, info, "01-guide");

    await page.getByTestId("home-guide-room").click();
    await page.getByTestId("room-create-name").fill(roomName);
    await expect(page.getByTestId("room-create-slug")).toHaveValue(`w2-${rand}`);
    await page.getByTestId("room-create-slug").fill(slug);
    await page.getByTestId("room-create-submit").click();
    await page.waitForURL((u) => u.pathname === "/r/" + slug);
    await expect(page.getByTestId("room-title")).toHaveText(roomName);
    await expect(page.getByTestId("timeline-empty")).toBeVisible();
    await shot(page, info, "02-room-created");

    await page.getByTestId("room-create-open").click();
    await page.getByTestId("room-create-name").fill("x");
    await page.getByTestId("room-create-slug").fill(slug);
    await page.getByTestId("room-create-submit").click();
    await expect(page.getByTestId("room-create-slug-error")).toBeVisible();
    await expect(page.getByTestId("room-create-dialog")).toBeVisible();
    await page.getByTestId("room-create-cancel").click();

    await page.goto("/console/people");
    await page.getByTestId("people-add").click();
    await page.getByTestId("person-create-handle").fill(handle);
    await page.getByTestId("person-create-display-name").fill(`Fern ${rand}`);
    const pw = await page.getByTestId("person-create-password").inputValue();
    expect(pw).toHaveLength(16);
    await page.getByTestId("person-create-submit").click();
    await expect(page.getByTestId("person-created")).toBeVisible();
    await expect(page.getByTestId("person-created-handle")).toHaveText(handle);
    await expect(page.getByTestId("person-created-password")).toHaveText(pw);
    await shot(page, info, "03-person-created");

    await page.getByTestId("person-created-copy").click();
    await expect(page.getByTestId("person-created-copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("handle: " + handle + "\npassword: " + pw);

    await page.getByTestId("person-created-done").click();
    await expect(page.getByTestId("person-created")).toHaveCount(0);
    await expect(page.locator(`[data-testid="people-row"][data-handle="${handle}"]`).getByTestId("people-badge-must-change")).toBeVisible();
    note(info, "initial password shown once and person must change it");

    const fp = await freshPage(browser, info, recorder, "fern");
    try {
      await fp.goto("/login");
      await fp.getByTestId("login-handle").fill(handle);
      await fp.getByTestId("login-password").fill(pw);
      await fp.getByTestId("login-submit").click();
      await fp.waitForURL(/\/settings$/);
      await expect(fp.getByTestId("settings-force-banner")).toBeVisible();
      await expect(fp.getByTestId("settings-profile-form")).toHaveCount(0);
      await shot(fp, info, "04-fern-forced");

      const next = `fern-new-pass-${rand}`;
      await fp.getByTestId("settings-old-password").fill(pw);
      await fp.getByTestId("settings-new-password").fill(next);
      await fp.getByTestId("settings-confirm-password").fill(next);
      await fp.getByTestId("settings-password-save").click();
      await fp.waitForURL((u) => u.pathname === "/");
      await expect(fp.getByTestId("home-no-rooms")).toBeVisible();
      await expect(fp.getByTestId("home-no-rooms")).toContainText("Ada Lin");
      note(info, "forced first-login password change works");
      await shot(fp, info, "05-fern-no-rooms");

      await page.goto("/console/rooms");
      const roomRow = page.locator(`[data-testid="console-room-row"][data-slug="${slug}"]`);
      await roomRow.getByTestId("console-room-invite").click();
      await page.getByTestId("invite-query").fill(handle);
      const option = page.locator(`[data-testid="invite-option"][data-handle="${handle}"]`);
      await expect(option).toBeVisible();
      await option.click();
      await page.getByTestId("invite-submit").click();
      await expect(page.getByTestId("invite-done")).toBeVisible();
      await expect(roomRow).toContainText("2");
      await shot(page, info, "06-invited");

      await fp.reload();
      await expect(fp.locator(`[data-testid="room-list-item"][data-slug="${slug}"]`)).toBeVisible();
      note(info, "invited person sees the room after reload");
      await shot(fp, info, "07-fern-sees-room");
    } finally {
      await fp.context().close();
    }

    const stale = await freshPage(browser, info, recorder, "fern-stale");
    try {
      await stale.goto("/login");
      await stale.getByTestId("login-handle").fill(handle);
      await stale.getByTestId("login-password").fill(pw);
      const login = stale.waitForResponse((res) => res.url().endsWith("/api/auth/login"));
      await stale.getByTestId("login-submit").click();
      expect((await login).status()).toBe(401);
    } finally {
      await stale.context().close();
    }
  },
);
