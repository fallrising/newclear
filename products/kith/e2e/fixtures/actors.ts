import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import type { TestAccount } from "./accounts.ts";
import type { Recorder } from "../harness/recorder.ts";
import type { WsChaos } from "../harness/ws-chaos.ts";

// Multi-user helpers (docs/v2/milestones/W1.md §5.1.4).

export async function loginViaUi(page: Page, account: TestAccount): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-handle").fill(account.handle);
  await page.getByTestId("login-password").fill(account.password);
  await page.getByTestId("login-submit").click();
  await page.getByTestId("app-shell").waitFor({ state: "visible" });
}

export async function openActor(opts: {
  browser: Browser;
  info: TestInfo;
  recorder: Recorder;
  account: TestAccount;
  actor: string;
  chaos?: WsChaos;
}): Promise<{ context: BrowserContext; page: Page }> {
  const use = opts.info.project.use;
  const context = await opts.browser.newContext({
    baseURL: process.env.KITH_E2E_BASE_URL,
    viewport: use.viewport,
    locale: use.locale,
    timezoneId: use.timezoneId,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
  });
  const page = await context.newPage();
  opts.recorder.watch(page, opts.actor);
  if (opts.chaos) await opts.chaos.attach(page);
  await loginViaUi(page, opts.account);
  return { context, page };
}

export async function sendViaComposer(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (coarse) await page.getByTestId("composer-send").click();
  else await page.getByTestId("composer-input").press("Enter");
}

export function uniqueText(label: string): string {
  return label + " " + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}
